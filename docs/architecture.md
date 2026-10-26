# Architecture

Four layers, one direction of data flow. The shape is the product's main defensive property: every
decision is made once, and nothing downstream can disagree with what came before it.

## The four layers

| Layer | Responsibility | Determinism |
|---|---|---|
| **Targets** | Resolve what exists: repository root, workspace importers, CI files, editor files, machine | Only I/O |
| **Collectors** | Run one declared probe per fact and cache it: `pnpm --version`, effective config, `git ls-files`, bounded file reads | Only I/O, bounded |
| **Rules** | One pure function per rule: `(ctx) → Finding[]` | Pure |
| **Report** | Aggregate, sort, decide the verdict, render human or JSON | Pure |

## Data flow

```text
                    funky-secure scan --scope repo|machine|all
                                   |
                          +--------+--------+
                          v                 v
                   Targets/Collectors   Policy (preset + overrides)
                          |                 |
                          +--------+--------+
                                   v
                          Rule engine (pure)
                                   v
                          Report (pure)
                          findings + verdict
                          /              \
                    human render      json render
                          |                 |
                    exit 0 | 1 | 2  <-------+
```

A command never talks to a rule directly. `scan` resolves targets, resolves policy, runs the engine
and renders the result. `init` runs the same collection once and derives a plan from the same
report, which is why the plan and the report cannot describe different repositories.

## Invariants

- **A rule never performs I/O.** It receives a resolved context; when a fact it needs is absent it
  returns `skip` with a reason. This is what makes the rules testable without fixtures on disk.
- **A collector is declared, not discovered.** The probe list is closed (RFC 12.1); adding one is a
  reviewed change, not an incidental import. Probes are cached per run and never retried.
- **The verdict is computed once**, in the report layer, from effective severities and `--fail-on` —
  never inside a rule, never inside a renderer.
- **Provenance is stated, never inferred.** The report says which file the preset came from and
  whether the repository itself declares the quarantine key; it never attributes an effective pnpm
  value to the project or to the machine, because the effective configuration reports no origin
  (RFC 9.4, E2). Both renderings read the one object `scan` resolved.
- **The renderers never compute.** Human and JSON read the same report object, so they cannot
  disagree; a passing finding is serialized away only because the report already counted it.
- **The machine is read-only, permanently.** No probe writes an environment variable, a global
  config or a store.
- **There are two write paths, and both are plans.** `init --apply` writes only through
  `applyPlan`, `migrate --apply` removes only through its step-4 function, and each writes only to
  the closed target catalog, after printing the absolute path and digest of the exact bytes, and
  after the same three refusals: uncommitted target, unreadable tree, unusable branch. Nothing else
  in the product writes a byte.

## Module map

Every file below exists on disk; `tests/drift.test.js` fails if this page mentions a module that does
not.

| Module | Responsibility |
|---|---|
| `src/cli.js` | argv parsing, flag applicability, command dispatch, `--help`, exit-code mapping |
| `src/commands/scan.js` | `scan`: one collection, one rendering |
| `src/commands/init.js` | `init`: same collection, derived plan, `--apply` |
| `src/commands/migrate.js` | `migrate`: the five-step RFC 11.3 plan, step-4 refusals |
| `src/commands/explain.js` | `explain`: one rule in depth, or the catalog list |
| `src/lib/config.js` | config discovery and validation (RFC 9) |
| `src/lib/engine.js` | runs the active catalog over the context and normalizes findings |
| `src/lib/errors.js` | `ConfigError` and `UsageError`, the exit-2 vocabulary |
| `src/lib/git.js` | read-only git helpers; every helper returns `null` when git cannot answer |
| `src/lib/lockfile.js` | bounded `pnpm-lock.yaml` reader for `exact-versions` (RFC 8.2 R5) |
| `src/lib/managed-block.js` | marker-based block read/replace for `init --apply` (RFC 11.2) |
| `src/lib/paths.js` | write-target validation: containment, basename, symlink escape (RFC 11.5) |
| `src/lib/plan.js` | plan items, both plan renderings, and the only write function |
| `src/lib/policy.js` | presets, overrides, precedence, quarantine floor (RFC 9) |
| `src/lib/probes.js` | the closed probe list, process spawning, the per-run collector |
| `src/lib/render-human.js` | human report rendering (RFC 10.3) |
| `src/lib/render-json.js` | deterministic JSON report rendering (RFC 10.2) |
| `src/lib/report.js` | aggregation, ordering, summary and the verdict (RFC 10) |
| `src/lib/scan.js` | the one collection: targets, policy, context, report |
| `src/lib/targets.js` | target resolution and the context a rule receives (RFC 7.1) |
| `src/lib/tool.js` | the package identity every document carries |
| `src/lib/workflows.js` | structural `jobs -> steps` workflow reader for R8 and R9 (RFC 8.2) |
| `src/lib/writers.js` | the five `init` writes: quarantine block, gitignore block, pin, strict preset (RFC 11.2) |
| `src/rules/index.js` | the catalog: catalog order is report order |
| `scripts/gen-golden.js` | regenerates `tests/golden/*.json` with a deterministic collector (RFC 15.2) |
| `scripts/check-pr-policy.js` | the issue link, single `type:*` label and branch-name gate (RFC 17 aside, `CONTRIBUTING.md`) |
| `scripts/release-guard.js` | the tag/version check and the packed-file check of RFC 17.3-17.4 |

One module per rule lives next to the catalog; a rule is pure and exports `id`, `title`, `scope`,
`targets`, `friction`, `severity`, `docs` and `detect(ctx)` — plus `plan(ctx)`, when the rule can fix
what it reported.

## Testing gates

Four gates run on every push (RFC 15, `node --test`):

- **Rule tests** — one test per rule for its question, its false-positive boundary and its `skip`
  path, against a plain context object; no test mocks `node:fs`.
- **The drift gate** (`tests/drift.test.js`, RFC 13.2) — a catalog rule without a
  `docs/rules/<id>.md` page, a page declaring an id the catalog lacks, a flag missing from `--help`
  or `docs/cli.md`, an architecture module that does not exist, a README table that disagrees with
  the catalog's severities, or a missing decision number all fail here.
- **The golden gate** (`scripts/gen-golden.js` plus the same drift file, RFC 15.2) — for each declared
  fixture repository, one committed JSON report under `tests/golden/`. The test regenerates each
  report in memory with the same deterministic collector the script uses (fixture files, `main` as the
  branch, `tracked.txt` as the index, the fixture's own `.gitignore`, no pnpm version, no clock, no
  network) and compares it byte for byte. A difference fails and says to run
  `node scripts/gen-golden.js`. Goldens are reviewed as diffs and never hand-edited.
- **The self-scan** (`tests/self.test.js`, RFC 15.4) — the real CLI over this repository with the real
  collector must exit `0` at `--fail-on warn`, print no `✖`, and its JSON report must have
  `summary.verdict === 'pass'` with every finding a `skip` that declares its reason. A rule that
  cannot pass on this repository is not releasable.

## Where a change belongs

- A new fact from the outside world → a declared probe in the collector, then a target in
  `src/lib/targets.js`. Never a `fs` call inside a rule.
- A new rule → its own module, registered in `src/rules/index.js`, with a docs page, a unit test and
  a fixture. The drift gate ties all four together.
- A new output field → `src/lib/report.js` and the two renderers, in that order.
- A new write → the plan layer and the closed target catalog. A command never writes by itself.
