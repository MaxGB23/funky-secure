# RFC: funky-secure as a supply-chain auditor and initializer

> **STATUS: PROPOSED — revision 2 (v1.1). Decisions taken; implementation not started.**
>
> **Revision 2** closes the findings of the pre-implementation review. The closed probe list gains the
> git reads that `init` and `migrate` need; the lockfile and workflow readers get an explicit bounded
> scope; `quarantine` stops claiming an origin it cannot observe; the `init` write table, the report
> contract and the output examples are made self-consistent; and the environment evidence of
> Appendix C is marked stale. Section 19 lists every change of this revision.
>
> **Identity:** `funky-secure` is the single name for the public repository, the npm package and
> the executable. No version suffix (`v2`, `v3`) appears in any of them. It is an independent
> package that does not live inside `funky-cli` and does not depend on it.
>
> **Artifacts:** there is no artifact directory. `funky-secure` reads the repository it is run in
> and writes nothing unless a command is explicitly asked to apply a plan. Its own repository
> carries `docs/`, `rfcs/` and `odd/tasks/`, following `funky-forge`.
>
> **Supersedes:** `docs/funky-ai/feature-secure.md` (RFC of the old `funky secure`) and
> `docs/funky-ai/secure.md` (its user documentation), both in `MaxGB23/funky-ai`. Where they
> conflict, this RFC wins. The old documents stay in `funky-ai` as a historical record; nothing
> in that repository is edited by this work.
>
> **Scope:** the dependency and CI supply-chain product known as `funky-secure`. It does not
> change `funky-ai`, its `funky-cli` commands, its rules (`secops.md`), or its memory provider.
> The legacy `funky secure` command in `funky-cli` is left untouched and unreferenced (section 17).
>
> **Language:** the product, CLI output, rule ids, file names, tests and documentation are English.
> Verbatim user decisions quoted in Appendix A keep their original language.
>
> **Non-goals:** a vulnerability scanner, a firewall, a package-proxy, a shim that blocks a package
> manager, a hosted service, or a runtime that mutates the user's machine.

---

## Table of contents

1. [Context](#1-context)
2. [Problems with the current design](#2-problems-with-the-current-design)
3. [Goals and non-goals](#3-goals-and-non-goals)
4. [Design principles](#4-design-principles)
5. [Target architecture](#5-target-architecture)
6. [Identity and naming](#6-identity-and-naming)
7. [Scope model and targets](#7-scope-model-and-targets)
8. [Rule catalog v0.1 (the nine)](#8-rule-catalog-v01-the-nine)
9. [Policy model](#9-policy-model)
10. [Report contract](#10-report-contract)
11. [Command contracts](#11-command-contracts)
12. [Machine scope contract](#12-machine-scope-contract)
13. [Help, documentation and the drift gate](#13-help-documentation-and-the-drift-gate)
14. [Repository and package layout](#14-repository-and-package-layout)
15. [Testing and validation plan](#15-testing-and-validation-plan)
16. [Implementation plan](#16-implementation-plan)
17. [Relationship with funky-ai](#17-relationship-with-funky-ai)
18. [Risks](#18-risks)
19. [Resolved design questions](#19-resolved-design-questions)
20. [Acceptance criteria](#20-acceptance-criteria)
- [Appendix A — Decision log](#appendix-a--decision-log)
- [Appendix B — Evidence of current defects](#appendix-b--evidence-of-current-defects)
- [Appendix C — Observed environment evidence](#appendix-c--observed-environment-evidence)
- [Appendix D — Output examples](#appendix-d--output-examples)

---

## 1. Context

### 1.1 The problem this product answers

In 2026 the realistic supply-chain attack against a working developer does not steal source code.
It steals **the credentials that live on the machine**: npm tokens, GitHub PATs, cloud keys, SSH
keys, payment and messaging tokens. The delivery mechanism is the install path, in the window
`npm audit` cannot see: by the time you audit, the lifecycle script already ran. The public
campaigns of 2026 (ChainDrop / Shai-Hulud and its successors) shipped `preinstall` scripts in
hundreds of packages and also injected editor hooks into `.vscode/tasks.json` and
`.claude/settings.json`, which execute when a repository is opened.

Two things follow, and they define this product:

1. **The defenses that matter are mostly configuration, not code.** They live in the repository
   (which package manager, which lockfile, which age policy, which ignore rules, which CI pins) and
   on the machine (which pnpm, which global age policy).
2. **A defense nobody verifies is a defense that silently stopped working.** A `pnpm-workspace.yaml`
   that used to have `minimumReleaseAge` and no longer does looks exactly like a hardened one.

So the product is an **auditor**: it answers "is this project, and this machine, configured the way
we decided", with evidence, deterministically, and in a form a human and a CI job can both consume.
Initialization exists because a diagnosis that cannot be acted on is only half useful.

### 1.2 What the previous version shipped

`funky-ai/funky-cli@4.9.1` ships `funky secure` with three subcommands. The implementation is 881
lines of production code in four files plus 995 lines of tests (66 tests, all green at the time of
this RFC):

| File | Lines | Responsibility |
|---|---|---|
| `src/commands/secure.js` | 336 | Probes, I/O, prompts, exit codes for `doctor`/`init`/`check` |
| `src/utils/secureDomain.js` | 313 | `diagnose`, `evaluate`, AGENTS.md block, packageManager pin, config parsing |
| `src/utils/secureYaml.js` | 144 | Seed of seven keys, posture selection, idempotent YAML merge |
| `src/utils/secureSnapshot.js` | 88 | sha256 baseline of editor hooks, local state file |

The verdict on it, argued in section 2, is that it is **not wrong, it is mispriced**: it writes more
than it needs to, duplicates what the package manager already does, and mixes a read-only gate with
state mutation. Its own repository does not satisfy its own standard.

### 1.3 What changed since it was designed

Four facts invalidate the assumptions of the old design:

1. **pnpm now ships the age quarantine by default.** On pnpm 11+ `minimumReleaseAge` has a non-zero
   default, so "nothing protects you" is no longer the baseline; the question becomes "is the value
   high enough for our policy". The old design seeded 4320 minutes as if the default were zero.
2. **pnpm now ships an explicit build-approval flow.** `approve-builds` / `onlyBuiltDependencies` /
   `allowBuilds` are the manager's own answer to lifecycle scripts. A CLI that seeds its own
   `allowBuilds: []` and `ignoreScripts: true` competes with that flow instead of using it.
3. **Behavior settings moved out of `.npmrc`.** In pnpm 10/11 behavior configuration is read from
   `pnpm-workspace.yaml` (per repository) or the pnpm global config; `.npmrc` is for registry and
   auth. Any design that assumed `.npmrc` is the surface is outdated.
4. **The audits that matter moved to CI and to the machine.** Two of the highest-value controls are
   now "Actions pinned by commit SHA" and "the machine runs one pnpm installation with an age
   policy", and neither is a repository file the old design ever looked at.

---

## 2. Problems with the current design

Each problem is stated as a property of the old code, with the file that proves it, and the design
rule in section 4 that removes it.

### 2.1 Two commands, one engine

`doctor` builds findings through `diagnose()` (`secureDomain.js:151`) and exits 0 always. `check`
builds violations through `evaluate()` (`secureDomain.js:249`) and exits 1. Both read the same
inputs: pnpm probes, `package.json`, git-tracked `.env` files, the state file, the seeds. The
functions diverged in wording, not in detection. Two outputs for one truth means two places to keep
correct, and it is why the free-text findings and the violation codes do not share identifiers.

*Removed by:* one engine, one finding model, one report, and `--fail-on` to choose the gate
threshold (section 10.5).

### 2.2 It duplicates defaults of the package manager

`STANDARD_KEYS` (`secureYaml.js:5`) seeds seven keys on every repository:
`ignoreScripts`, `minimumReleaseAge`, `engineStrict`, `blockExoticSubdeps`, `trustPolicy`,
`verifyStoreIntegrity`, `allowBuilds`. With pnpm 11's defaults in place, at least the age policy is
already active unless explicitly disabled; `allowBuilds: []` re-states a deny-by-default that the
manager already enforces through `approve-builds`. Appendix C shows the author's machine reporting
`minimumReleaseAge: 4320` and `ignoreScripts: true` as **effective** configuration before
`funky-secure` ever writes anything.

*Removed by:* section 4.1 — a value the manager already provides is reported, never written.

### 2.3 It seeds a posture that fights legitimate repositories

`ignoreScripts: true` (the `fail-silent` posture) also blocks the root package's `preinstall` and
`prepare`, which is exactly how `husky` and `lint-staged` install their hooks. The old RFC
documented this as "minimum adaptation under your own consent or risk". In practice it is the
classic trap: a rule that breaks a common, legitimate setup is a rule people disable, and a disabled
rule protects nobody. The old design even had to introduce a second posture (`fail-fast`) to route
around it, plus a warning about approval fatigue (`secure.js` step 6), which is a signal that the
seed was doing the manager's job badly.

*Removed by:* section 4.1 and section 4.2 — the tool does not choose a lifecycle-script posture for
you; it reports the one in effect, and v0.1 ships no write path for it at all.

### 2.4 A gate that mutates state

`funky secure check --rebaseline` (`secure.js:274`) writes a fresh state file during what is
otherwise a read-only CI gate. A CI job that runs it silently forgives its own drift, and the tool's
own documentation advertises it as an exit-code contract. The gate and the mutator must be separate
commands.

*Removed by:* section 11 — `scan` never writes; `init` writes only what it names, and nothing
re-baselines implicitly.

### 2.5 Exit code 1 means two different things

`pnpm-probe`/`git-probe` failures are pushed into the same `violations` array as policy violations
(`secure.js:250-265`), so a missing binary is indistinguishable from an insecure repository, and
both exit 1. A CI consumer cannot tell "fix your repository" from "fix your runner".

*Removed by:* section 10.4 — `0` pass, `1` policy violation, `2` tool/runtime failure.

### 2.6 The hook baseline is inert where it matters most

`buildBaseline`/`compareBaseline` (`secureSnapshot.js:30,78`) hash two editor files into
`.funky/secure-state.json`, which `init` adds to `.gitignore`. Consequences: a fresh clone has no
baseline, `check` therefore reports no drift, and CI can never detect an injected hook — the one
control aimed at the editor-hook IoC of the 2026 campaigns is precisely the control that can never
fire in CI.

*Removed by:* section 4.4 — v0.1 introduces no local state, and the stateless audit of editor hooks
is deferred to v2 with a design that works on a fresh clone (section 8.3).

### 2.7 It detects floating ranges and never fixes anything

`floatingRanges()` (`secureDomain.js:219`) powers a violation (`floating-ranges`) that `init` never
addresses. A violation with no remediation path is a permanent red CI job, or a rule people turn
off. The old design also tells you nothing about whether the pinned specifier agrees with the
resolved version in the lockfile, which is the failure mode behind "I pinned it and it still drifted".

*Removed by:* section 8.2 rule `exact-versions`, which ships a remediation command and cross-checks
the lockfile.

### 2.8 The tool does not satisfy its own standard

Running `funky secure check` inside `funky-cli` would fail: `funky-cli/pnpm-workspace.yaml` contains
a single, unrelated key (`pmOnFail`), and `funky-cli/package.json` uses `^` ranges for every
dependency. The product was never dogfooded, and that is why the friction in 2.2 and 2.3 was never
felt by its author.

*Removed by:* section 15.4 — the product's own CI runs the product, at the strictest threshold, from
the first commit.

### 2.9 Help and documentation can go stale

`enrichCommandHelp` (`help.js:63`) resolves the command document from `process.cwd()` candidates
(`docs/funky-ai/<name>.md`), so `funky secure --help` prints the full document only when the user
happens to stand in a repository that contains it. In any other repository the help is the bare flag
list. Documentation and CLI are two independent sources of truth, and nothing fails when they
disagree.

*Removed by:* section 13 — the rule catalog is the single source and a CI gate fails on drift.

### 2.10 It promises a product it does not ship

The old RFC specifies `secure audit`, `secure incident <slug>`, `secure approve` and
`secure global`, with live advisory blocklists, incident document generation and IoC scanning. None
of them exists. The shipped product is a config seeder with a linter, documented as if it were an
incident-response tool. The gap is not the missing features — it is the unstated scope.

*Removed by:* section 3 — explicit non-goals and a versioned roadmap with a fixed size per release.

---

## 3. Goals and non-goals

### Goals

- **G1 — Diagnose a repository against a declared policy, with evidence.** Every finding names the
  rule, the target, the file (and line when it applies), the observed value and the expected one.
- **G2 — Diagnose the machine the repository is built on**, read-only: which pnpm answers, which
  version, which effective age policy, which store, how many installations are in `PATH`.
- **G3 — Never write without an explicit apply.** `scan` writes nothing, ever. `init` prints a plan
  by default; `--apply` performs exactly the writes in that plan and nothing else.
- **G4 — Recommend pnpm and offer a migration plan from npm or yarn.** Never a hard block, never an
  automatic destructive change.
- **G5 — Be consumable by CI and by agents.** Stable JSON, three distinct exit codes, deterministic
  ordering, no network, no clock in the deterministic part.
- **G6 — Keep the remediation next to the diagnosis.** Every finding carries either a command or the
  statement that no automatic fix exists, and `explain <rule>` gives the reasoning plus the source.
- **G7 — Stay light.** Nine rules, zero runtime dependencies, no state, no daemon, no prompt.
- **G8 — Never let help or documentation drift from the catalog.** (Section 13.)

### Non-goals

- **N1 — Vulnerability scanning.** No advisory database, no `pnpm audit` wrapper, no CVE verdicts.
  `funky-secure` reports configuration; `pnpm audit` reports advisories. Where a rule recommends an
  audit, it prints the command and stops.
- **N2 — Incident response.** No incident documents, no live blocklists, no IoC feeds. A CLI cannot
  keep up with a list that grows from 11 to 440 packages in hours; that belongs to a human reading
  the advisory feed.
- **N3 — Enforcement.** No shim, no wrapper, no PATH block for `npm`/`yarn`, no interception of
  commands. Six of the author's daily tools update through npm; a block would break them, and a
  bypassable block teaches a false sense of control.
- **N4 — Mutating the machine.** No environment variables, no global config, no `setx`. The machine
  scope is read-only forever.
- **N5 — Package and file-content scanning of `node_modules`.** No content heuristics, no entropy
  checks, no history rewriting, no secret scanning of git history.
- **N6 — Choosing a lifecycle-script posture.** No `ignoreScripts`, no `allowBuilds`, no
  `onlyBuiltDependencies` writes. Reported as state, never imposed.
- **N7 — Being a policy server.** No remote policy distribution, no organization accounts.
- **N8 — Hosting a skill pack** in v0.1. A `skill/` directory may arrive in a later version; it is
  not part of this release.

---

## 4. Design principles

### 4.1 Do not duplicate a default of the package manager

If pnpm already guarantees something, `funky-secure` **reports the effective value** and stops. It
does not re-state the default in repository configuration, because re-stating creates two sources of
truth: the manager's default improves with a new release, the seeded copy does not, and the seeded
copy can be older, weaker or wrong. This is why the seven-key seed disappears from the product.

Concretely: `minimumReleaseAge` is read from the **effective** configuration that pnpm itself
reports, not from a YAML file we parse; `frozen-lockfile` is understood to be the default in CI, so a
workflow that simply runs `pnpm install` is not a finding.

### 4.2 Friction has a price, and the price sets the starting severity

Every rule is classified by what it costs a legitimate repository:

| Friction | Meaning | Starting severity |
|---|---|---|
| **0 — free** | Satisfying it breaks nothing (a pin, a lockfile commit, an ignore entry) | `error` in `baseline` |
| **1 — cheap** | Costs one edit or one command, with no workflow change | `warn` in `baseline`, `error` in `strict` |
| **2 — expensive** | Changes resolution or workflow (exact versions, lifecycle scripts) | `warn` in both presets unless the policy promotes it |

Friction class is the **starting point**, not the law: every rule declares its final severity in
its heading in section 8.2, and every rule that deviates from this table says why in its own entry
(R3, R4, R8). The declared value is normative; the table is the reasoning that produced it.

A rule that fails a repository on its first contact gets uninstalled, and an uninstalled auditor
protects nobody. Severity is a product decision, not a technical one.

### 4.3 Plan before apply, and never overwrite

Every command that can write prints the exact plan (absolute path, operation, resulting content)
and writes only with `--apply`. No write replaces a value that exists and differs: it is reported as
`conflict` and left alone. Idempotency is by marker: the block is located by its markers and its own
content is compared, so a second run produces zero writes without ever rewriting a file because of
a formatting difference elsewhere.

### 4.4 Stateless by preference

State is a liability: it is machine-local, it goes stale, and it cannot be checked on a fresh clone
or in CI. v0.1 therefore keeps **no state at all**. Where a control genuinely needs a baseline (drift
of editor hooks), that control is deferred to v2 with an explicit design that works on a clone
(section 8.3), rather than shipped half-useful.

### 4.5 The machine is read-only, permanently

The machine scope reads and recommends. It never sets an environment variable, never edits a global
config, never installs anything. The reasoning is the same one the old RFC reached: a security tool
that writes to the user's environment adds attack surface to the very thing it protects. The
distinction between "read the machine" and "protect the repository" is the product's spine.

### 4.6 A remediation is actionable or it is absent

A finding carries either an exact command, or an explicit "manual" classification with the rule's
documentation. "Consider reviewing your configuration" is not a finding; it is noise that trains the
reader to skip the output.

### 4.7 One name, one package, zero runtime dependencies

The repository, the npm package and the binary are all `funky-secure`. Runtime dependencies: none.
No YAML parser, no CLI framework, no color library, no HTTP client. Everything the tool needs is
`node:` built-ins plus the repository's own files. This keeps the install surface at zero for a
product whose subject is supply-chain risk, and it keeps the tool runnable in an air-gapped CI.

### 4.8 Help and documentation cannot drift

The rule catalog is data. `--help`, `explain <rule>` and `docs/rules/<id>.md` are three renderings of
the same entries, and a test fails when a rule exists without all three, or when a document declares
an id that the catalog does not contain. (Section 13.)

### 4.9 Determinism: no network, no clock, no locale

Two runs over the same repository state produce byte-identical output. No timestamps in the report
body, no locale-dependent formatting, no sorting that depends on filesystem order, no network call.
The report is a function of the inputs.

---

## 5. Target architecture

Four layers, one direction of data flow:

| Layer | Responsibility | Determinism |
|---|---|---|
| **Targets** | Resolve what exists: repository root, workspace importers, CI files, editor files, machine | Only I/O |
| **Collectors** | Run one probe per fact and cache it: `pnpm --version`, effective config, `git ls-files`, file reads | Only I/O, bounded |
| **Rules** | One pure function per rule: `(ctx) → finding` | Pure |
| **Report** | Aggregate, sort, decide the verdict, render human or JSON | Pure |

```
                    funky-secure scan --scope repo|machine|all
                                   |
                          +--------+--------+
                          v                 v
                   Targets/Collectors   Policy (preset + overrides)
                          |                 |
                          +--------+--------+
                                   v
                          Rule engine (pure)
                           9 rule functions
                                   v
                          Report (pure)
                          findings + verdict
                          /              \
                    human render      json render
                          |                 |
                    exit 0 | 1 | 2  <-------+
```

Rules that keep this from degrading:

- **A rule never performs I/O.** It receives a resolved context; if a fact it needs is absent, it
  returns `skip` with a reason. This is what makes 9 rules testable without fixtures on disk.
- **A collector is declared, not discovered.** The set of probes is a closed list (section 12.1);
  adding a probe is a reviewed change, not an incidental import.
- **The verdict is computed once**, from severities and `--fail-on`, never inside a rule.
- **The renderers never compute.** Human and JSON read the same report object, so they cannot
  disagree.

---

## 6. Identity and naming

### 6.1 Decision: keep `funky-secure`

Considered, and rejected, because the alternative names describe the current capability instead of
the domain, and would have to be renamed again the moment `apply` ships:

| Candidate | Why not |
|---|---|
| `funky-audit` | Names the v0.1 verb. Breaks the day the tool applies a change. |
| `funky-guard` / `funky-shield` | Implies enforcement and blocking, which is an explicit non-goal (N3). |
| `funky-sentry` | Brand collision with an observability vendor; bad for npm search and for trust. |
| `funky-checklist` | Accurate but reductive; it is a policy engine, not a list. |
| `funky-hygiene` | Sounds like formatting; loses the supply-chain framing. |

`funky-secure` reads correctly in both registers the product needs:

```
funky-secure scan                 # auditor: what is wrong
funky-secure init --apply         # initializer: make it right
```

Forge has the same property: `funky-forge` does not mean "estimator", it names the workshop.
`secure` names the workshop.

### 6.2 Naming rules

- Repository: `MaxGB23/funky-secure`.
- npm package: `funky-secure`. Binary: `funky-secure`.
- No version suffix in any identifier. Release line starts at `0.1.0`.
- Rule ids are `kebab-case`, stable, never renamed without an entry in the decision log: tooling and
  configs refer to them.
- Every artifact this product *touches* keeps its upstream name (`pnpm-workspace.yaml`,
  `pnpm-lock.yaml`, `.gitignore`). The product never introduces its own directory, dotfile or state
  file in v0.1. The only files it may create, and only through the plan of section 11.2, are
  `pnpm-workspace.yaml` (W1, when the file is absent) and `funky-secure.config.json` (W4, only with
  `--preset strict --apply`).

---

## 7. Scope model and targets

### 7.1 Targets

A scan does not "walk a repository"; it resolves **targets**, and each rule declares which target
kinds it applies to.

| Target kind | Resolution | Rules that use it |
|---|---|---|
| `machine` | `pnpm --version`, `pnpm config list --json`, `where`/`which pnpm`, `~/.npmrc` | `quarantine` |
| `repo-root` | `git rev-parse --show-toplevel`, else `cwd` | `package-manager-pin`, `lockfile-committed`, `foreign-lockfile`, `quarantine`, `env-not-tracked`, `sensitive-ignored` |
| `importer` | `pnpm-workspace.yaml` `packages:` globs → each `package.json`; plus the root `package.json` | `exact-versions` |
| `ci` | `.github/workflows/*.yml`, `.github/workflows/*.yaml`, `.github/dependabot.yml`, `.github/renovate.json` | `actions-pinned-sha`, `no-bot-auto-merge` |
| `editor` | `.vscode/tasks.json`, `.claude/settings.json` (existence only in v0.1) | none in v0.1 |

Rules that apply to a target kind that does not exist return `skip` with `reason: "no target"`, and a
skipped rule is **not** a pass. The summary counts them separately, because "I did not look" and "I
looked and it was fine" must never print the same.

Importer resolution in v0.1 is intentionally narrow: `pnpm-workspace.yaml` `packages:` entries that
contain `*` are expanded with a single-level glob, and nested globs are reported as
`skip: unsupported-glob` rather than silently ignored. Nine rules do not justify a glob engine; the
report tells the truth instead.

### 7.2 Scope selection

```
funky-secure scan                  # auto: repo if inside git, plus machine (default)
funky-secure scan --scope repo     # repository only (works outside git too)
funky-secure scan --scope machine  # machine only
funky-secure scan --scope all      # repo + machine, explicit
```

`auto` is the default and equals `all`, minus machine rules when a probe is unavailable (reported as
`skip`, never as pass). `--scope repo` inside CI is the supported gate configuration, because a
runner's machine configuration is not the developer's and is outside the contract.

### 7.3 What a scan never does

- Never writes any file, anywhere.
- Never runs a lifecycle script, an install, or a build.
- Never resolves a version (no registry access, no `pnpm view`, no `--dry-run` install).
- Never sends anything over the network.
- Never prints a secret value; tokens are reported as present/absent only (section 12.3).

---

## 8. Rule catalog v0.1 (the nine)

### 8.1 Rule contract

```js
// src/rules/<id>.js
export default {
  id: 'exact-versions',
  title: 'Dependency specifiers are exact',
  scope: ['repo'],
  targets: ['importer'],
  friction: 2,                        // 0 free, 1 cheap, 2 expensive
  severity: { baseline: 'warn', strict: 'error' },
  docs: 'docs/rules/exact-versions.md',
  detect(ctx) {
    // returns Finding[] — pure, no I/O
  },
};
```

`Finding` is the unit of report (section 10.1). A rule returns zero or more findings, each with
`status: 'pass' | 'fail' | 'skip' | 'error'`. A rule that cannot answer (missing fact, malformed
input) returns `error` for itself and never a false `pass`.

Column meanings in the tables below: **friction** per 4.2, **sev** is `baseline` / `strict`,
**fix** is `auto` (an apply path exists), `manual` (exact command), or `none` (report only).

### 8.2 The nine rules

#### R1 — `package-manager-pin` · friction 0 · sev `error`/`error` · fix `auto`

- **Question:** does `package.json` declare the package manager, and does the declaration match the
  pnpm actually answering?
- **Detection:** `package.json` → `packageManager`. `pass` if it equals `pnpm@<active version>`.
  `fail` if absent. `fail` with `conflict` evidence if present but different (npm, yarn, or another
  pnpm version). If `pnpm --version` fails, `skip` — an unverifiable pin is not a wrong pin.
- **Evidence:** declared value, observed value, path of the answering binary.
- **Remediation:** `corepack use pnpm@<version>` (manual) or `init --apply` (auto write).
- **Why it is free:** one line in a file every Node repository has; it makes the accidental use of
  another manager detectable without blocking anything.
- **False positives:** repositories deliberately on another manager. That is not a false positive; it
  is the finding. The override is `off`, and the report says so.

#### R2 — `lockfile-committed` · friction 0 · sev `error`/`error` · fix `none`

- **Question:** is the lockfile present, tracked, and not ignored?
- **Detection:** `pnpm-lock.yaml` exists at the repo root; `git ls-files --error-unmatch` succeeds;
  `git check-ignore` does not match it. Outside git, only existence is checked and the finding says
  so. A lockfile present but not tracked is the failure mode that produces non-reproducible CI.
- **Remediation:** `git add pnpm-lock.yaml` (manual).
- **Note:** the rule deliberately does not check the lockfile's `lockfileVersion` against the
  installed pnpm; that check belongs to pnpm itself on install, and duplicating it would create a
  second, staler source of truth (4.1).

#### R3 — `foreign-lockfile` · friction 0 · sev `warn`/`warn` · fix `manual` (`migrate`)

- **Question:** does another package manager still shape this repository?
- **Detection:** `package-lock.json`, `yarn.lock` or `bun.lock`/`bun.lockb` present at the root.
  Severity is `warn` in both presets: the product recommends pnpm, it does not require it (G4).
  Deviates from the guidance of 4.2, where friction 0 would suggest `error`; G4 wins, and the
deviation is recorded here and in section 9.1.
- **Evidence:** the files found; whether `pnpm-lock.yaml` coexists (the dangerous case, because two
  lockfiles resolve two trees).
- **Remediation:** `funky-secure migrate --from npm --apply` prints or executes the plan (section
  11.3). Two lockfiles present raises the message to `error` level wording while keeping its
  severity, because coexistence is the state that produces "works locally, breaks in CI".

#### R4 — `quarantine` · friction 1 · sev `error`/`error` · fix `manual`

- **Question:** is the effective release-age quarantine at least the policy value?
- **Detection:** read `minimumReleaseAge` from the **effective** configuration reported by
  `pnpm config list --json` (this merges global, workspace and environment, which is exactly the
  number pnpm will apply). Compare against `policy.quarantineMinutes` (default `4320`). Report that
  effective value and, as a reference, the manager's own default, so the reader knows what the
  repository inherited for free. The report does **not** claim where the value came from: the
  effective listing merges its sources and cannot attribute them (E2), and a guessed origin is
  exactly the kind of stale assertion this RFC exists to remove.
- **Evidence:** effective value, policy value, `minimumReleaseAgeExclude` entries if present.
- **Severity:** `error` in both presets, although the friction class is 1. The justification is that
  the cost of satisfying the rule is usually zero for a repository owner — the value is inherited
  from the machine — while a floor that is lower than policy is the highest-value defect this
  auditor can report. The deviation from 4.2 is deliberate and recorded in section 9.1.
- **Remediation:** `init --apply` writes the managed block W1 of section 11.2, which is the only
  project-scoped path the tool can perform. The machine path
  (`pnpm config set minimum-release-age 4320 --location=global`) is printed as a recommendation and
  never executed (4.5). `pnpm config set minimum-release-age 4320 --location=project` is offered as a
  manual alternative **only if** E8 proves that pnpm reads the value from a project `.npmrc`
  (1.3, fact 3); otherwise the managed block is the single remediation and E8's outcome is recorded
  in this rule's documentation.
- **Why it is not friction 0:** a hotfix on a fresh CVE must wait 72 hours or be explicitly excluded.
  That cost is real and it is the point of the quarantine; the rule states the number instead of
  hiding it.

#### R5 — `exact-versions` · friction 2 · sev `warn`/`error` · fix `manual`

- **Question:** are dependency specifiers exact, and does the lockfile agree?
- **Detection:** for every `dependencies`, `devDependencies`, `optionalDependencies`,
  `peerDependencies` entry of every importer: a specifier is floating when it starts with `^`, `~`,
  `>`, `<`, `*`, or equals `latest`, or contains `x`/`X`, or is a git/tarball URL. Exact means a
  literal version, `npm:<pkg>@<version>`, or `workspace:*` for internal packages. Additionally,
  compare the specifier with the resolved specifier in `pnpm-lock.yaml` for the same importer and
  dependency; a disagreement is a separate finding with `code: "lockfile-desync"` (10.1).
- **Lockfile reader scope (v0.1).** The comparison uses `src/lib/lockfile.js`, a bounded indent reader
  that needs no YAML dependency (4.7) and understands only `lockfileVersion`,
  `importers.<path>.specifiers` and
  `importers.<path>.{dependencies,devDependencies,optionalDependencies,peerDependencies}`. Anything
  outside that subset — `catalogs`, `overrides`, `patchedDependencies`, a `snapshots` layout it does
  not recognize — makes the comparison return `skip: unsupported-lockfile-shape`, never a guessed
  finding. One fixture per supported `lockfileVersion` (currently `9.0`) proves the reader, and a
  future major that moves the shape degrades to `skip`.
- **Severity:** `warn` in `baseline`, `error` in `strict` — the user's decision (Appendix A). A
  repository can also split it: `"exact-versions": { "dependencies": "error", "devDependencies": "warn" }`
  is **not** supported in v0.1; it is a v2 extension.
- **Remediation:** `pnpm add --save-exact <pkg>@<version>` per package, which works whatever the
  configuration surfaces are, or — when E8's evidence covers it as well —
  `pnpm config set save-exact true --location=project` plus a re-add of the affected packages
  (manual). No auto fix in v0.1: rewriting a `package.json` range without re-resolving is how you
  desync a lockfile.
- **Evidence:** `file:line` of each specifier, the range, the resolved version.

#### R6 — `env-not-tracked` · friction 0 · sev `error`/`error` · fix `none`

- **Question:** is any environment file committed?
- **Detection:** `git ls-files -z -- ':(glob)**/.env*'`; exclude template names (`.env.example`,
  `.env.sample`, `.env.template`, `.env.dist`, `.env.test.example`). Outside git, `skip`.
- **Evidence:** each tracked path. **No content is read**, and no value is printed (N5).
- **Remediation:** `git rm --cached <path>` (manual) plus a rotation note in the message: removing a
  file from the index does not remove it from history, so the credentials must be rotated. That
  sentence is the whole value of the rule and it is not optional.
- **Relation to R7:** R6 is about git tracking, R7 is about ignore coverage. Both exist because
  "ignored but committed once" and "not committed yet but unignored" are different accidents.

#### R7 — `sensitive-ignored` · friction 0 · sev `error`/`error` · fix `auto`

- **Question:** would this repository ignore the files that must never be committed?
- **Detection:** behavioral, not textual. Feed candidate paths to
  `git check-ignore --no-index --stdin -z` and require a match for: `.env`, `.env.local`,
  `.env.production`, `secrets.pem`, `server.key`, `.npmrc`. Textual presence in `.gitignore` is not
  enough, because a later negation (`!.env`) or a nested ignore file changes the truth. Additionally
  report tracked instances of `*.pem`, `*.key` and a root `.npmrc` containing a literal
  `_authToken=` (presence only, value redacted).
- **Remediation:** `init --apply` appends a managed block (section 11.2) with the missing entries.
  Manual alternative: the exact lines to add are printed.
- **Scope note:** the rule does not demand that `.npmrc` be ignored when the project legitimately
  commits one without tokens; the token check is separate evidence and drives the severity of that
  instance only.

#### R8 — `actions-pinned-sha` · friction 1 · sev `error`/`error` · fix `manual`

- **Question:** can a CI workflow change under you without a commit?
- **Detection:** for each `.github/workflows/*.yaml{,.yml}` line matching `uses:`, parse the
  reference. Accept `owner/repo@<40 hex>`. Flag `@v1`/`@main`/`@<7 hex>`. Accept local `./path`
  actions. Treat `docker://image:tag` as a finding and `docker://image@sha256:...` as a pass. A
  trailing `# vX.Y.Z` comment is preserved as evidence but never trusted.
- **Remediation:** manual, with the exact shape printed:
  `uses: owner/repo@<sha> # vX.Y.Z`, and a pointer to the rule doc explaining how to resolve the SHA
  (`gh api repos/owner/repo/git/refs/tags/vX.Y.Z`) — the tool does not resolve it, because that is a
  network call (4.9).
- **Evidence:** `file:line`, the raw reference, the offending form.

#### R9 — `no-bot-auto-merge` · friction 0 · sev `error`/`error` · fix `none`

- **Question:** can a dependency update reach the default branch without a human reading it?
- **Detection:** two independent signals.
  1. **Configuration:** `.github/dependabot.yml` or `.github/renovate.json` present → `info`
     finding: automated updates exist and must be reviewed manually; v0.1 does not judge the tool,
     only the merge path.
  2. **Merge path:** a minimal workflow reader (`src/lib/workflows.js`, section 14) maps each job to
     its `if:`/`name:` and to its steps, so a step can be attributed to the job that runs it. Flag
     `gh pr merge` with `--auto` or `--merge`, and any `uses:` of a known automerge action, in a job
     whose condition names `dependabot[bot]`/`renovate[bot]`. Flag `pull_request_target` in a job that
     also checks out the PR head (`github.event.pull_request.head.sha` or `refs/pull/`), because that
     combination hands repository secrets to untrusted code. A workflow the reader cannot parse
     (anchors, includes, unexpected nesting) yields `skip: unparseable-workflow` for that file: the
     rule never guesses from a line scan.
- **Reader scope note:** this is the structural read that section 8.3 has in mind. The reader ships in
  v0.1 because R8 and R9 both need it; the deferred workflow rules reuse it instead of growing a
  second parser.
- **Remediation:** none automatic. The message states the rule: an update is merged by a person
  after reading the diff and running the gate.
- **Why it is free:** it costs nothing to not automate a merge, and it removes the only path by
  which a compromised upstream reaches `main` with no human in it. This is the encoded form of the
  author's position that "you can never know whether it is safe without auditing" (Appendix A).

### 8.3 Deferred catalog (v2, nine rules)

Not in v0.1, in this order of expected value:

| id | Question | Why deferred |
|---|---|---|
| `ci-no-safety-overrides` | does CI disable the frozen lockfile or re-enable lifecycle scripts? | pnpm already freezes in CI (4.1); only explicit overrides are interesting, and they are rare |
| `workflow-permissions` | does each workflow declare least-privilege `permissions:`? | needs the shared workflow reader (v0.1) plus a per-job permission matrix, which is the v2 work |
| `pull-request-target` | does a workflow combine `pull_request_target` with PR-head checkout outside automerge? | today folded into R9's evidence; deserves its own message |
| `editor-hooks` | do `.vscode/tasks.json` / `.claude/settings.json` execute anything? | stateless audit, no baseline: list what runs, let the human judge |
| `hook-drift` | did those hooks change since the last approved state? | genuinely needs state; the design must work on a fresh clone before it ships |
| `lifecycle-scripts` | which dependencies have build scripts and what is their approval state? | pnpm's `approve-builds` owns the flow; report-only, and it needs a lockfile reader |
| `trust-policy` | is `trustPolicy: no-downgrade` set? | a free key, but it is a seed, and seeds are what caused 2.2 |
| `block-exotic-subdeps` | are transitive git/tarball dependencies blocked? | same reasoning as `trust-policy` |
| `quarantine-exclusions` | are `minimumReleaseAgeExclude` entries justified and tracked? | needs a decision on where an exemption is recorded |

### 8.4 Why exactly nine

The count is a product constraint, not an accident. Nine rules fit one screen of output on a real
repository, one page of documentation, one test file each, and one release note. Every additional
rule adds a way for the tool to be wrong in public. Nine is also the number that satisfied both
constraints at once: **every rule the author asked for by name** (pnpm recommendation and migration,
the age quarantine, no floating ranges, no automatic dependency merges, Actions pinned by SHA,
sensitive files ignored) **plus the three that make the report trustworthy** (pin, lockfile, exit
codes).

The resolution of the count, recorded explicitly because the approved list named `lockfile-*`
ambiguously:

- `lockfile-*` resolves to **two** rules: `lockfile-committed` (R2) and `foreign-lockfile` (R3).
- `install-frozen` became `ci-no-safety-overrides` and moved to v2, because pnpm freezes by default
  in CI and a rule that fires on `pnpm install` would violate 4.1.
- `hook-drift` moved to v2, because it is the only rule that needs state, and v0.1 is stateless by
  design (4.4).

---

## 9. Policy model

### 9.1 Presets

| Preset | Intent | Effect |
|---|---|---|
| `baseline` (default) | Adoptable anywhere without a fight | Friction-0 rules are `error`; friction 1–2 are `warn` |
| `strict` | The author's own repositories | Friction 0–1 rules are `error`; `exact-versions` is `error` (friction 2, explicitly promoted) |

Declared deviations from that table, all visible in the rule headings of section 8.2:

- **`foreign-lockfile` (R3)** stays `warn` in both presets: G4 says recommend pnpm, not require it.
- **`quarantine` (R4)** stays `error` in both presets: the repository owner rarely pays the cost,
  because the value is inherited from the machine, and a floor below policy is the defect that
  matters most.
- **`actions-pinned-sha` (R8)** is `error` in both presets: pinning a reference is a one-line edit with
  no behavioral cost, so the friction class of the *finding* is not the friction of the *fix*.

Preset resolution order (highest wins):

1. `--preset` on the command line.
2. `preset` in `funky-secure.config.json`.
3. `baseline`.

### 9.2 Overrides and precedence

```json
{
  "preset": "strict",
  "quarantineMinutes": 4320,
  "rules": {
    "exact-versions": "warn",
    "no-bot-auto-merge": "off"
  }
}
```

Precedence, highest first: `--ignore <ids>` → `--only <ids>` → config `rules` → preset default.
Severity values: `off | info | warn | error`. `--fail-on <severity>` decides the verdict, not the
rules (section 10.5).

Severity `off` means the rule is not run: it produces no finding, is not counted in the summary, and
`explain <id>` still documents it, so turning a rule off stays visible in the documentation instead
of disappearing silently.

Rules are **not** silently ignored when mistyped: an unknown id in `rules`, an unknown severity, or
an unknown top-level key is a configuration error → exit `2`, with the offending key named. Silent
config typos are the same class of defect as a stale help text: the user believes something is
enforced when it is not.

### 9.3 Config file discovery

`funky-secure.config.json` at the git toplevel of the current directory, else in the current
directory. Machine scope never reads a repository config. The file is JSON only (no YAML, no JS, no
comments) so there is no parser to depend on and no code execution path.

### 9.4 Quarantine policy and its source

`quarantineMinutes` defaults to `4320` (72 hours), above pnpm's own default, which the report prints
as inherited. The value is policy, not law: a repository with a documented hotfix process may lower
it or list exemptions, and the report shows the effective number so the lowering is visible in review.
`minimumReleaseAgeExclude` entries are reported in the evidence (count and values), so an exemption
is never invisible.

---

## 10. Report contract

### 10.1 Finding

```
{
  rule:       "exact-versions",           // stable id
  status:     "fail" | "pass" | "skip" | "error",
  severity:   "error" | "warn" | "info" | "off",   // effective, after policy
  code:       "lockfile-desync",          // optional, stable within the rule
  scope:      "repo" | "machine",
  target:     "importer",                 // target kind
  path:       "packages/api/package.json",// repo-relative, POSIX separators, no absolute paths
  line:       14,                          // 1-based, omitted when not applicable
  message:    "yaml@^2.9.0 is a floating range",
  evidence:   { specifier: "^2.9.0", resolved: "2.9.0" },
  remediation:{ kind: "manual" | "auto" | "none", command: "pnpm add --save-exact yaml@2.9.0" },
  doc:        "funky-secure explain exact-versions"
}
```

Absolute paths never appear in a report body; they appear only in `--scope machine`'s binary/store
evidence, because there the absolute path *is* the fact. The same holds for a write plan, which is a
separate document (11.2).

`code` is optional and, when present, stable: one rule may produce findings for different reasons
(`exact-versions` → `floating-range`, `lockfile-desync`) and a consumer must be able to tell them
apart without parsing a message. Rule ids are the public contract (6.2); codes are too.

**What is serialized.** `findings[]` carries the `fail`, `skip` and `error` findings only. `pass`
findings are counted in `summary.pass` and never listed: a repository with twelve passing rules does
not print twelve lines of reassurance. A rule set to `off` (9.2) contributes nothing at all — no
finding and no count.

### 10.2 JSON output

```json
{
  "schemaVersion": 1,
  "tool": { "name": "funky-secure", "version": "0.1.0" },
  "scope": "all",
  "policy": { "preset": "baseline", "quarantineMinutes": 4320, "failOn": "error" },
  "targets": [
    { "kind": "machine", "detail": "pnpm 11.5.0" },
    { "kind": "repo-root", "path": "." },
    { "kind": "importer", "path": "." }
  ],
  "summary": { "error": 1, "warn": 2, "info": 0, "pass": 6, "skip": 0, "verdict": "fail" },
  "findings": [ /* Finding[] */ ]
}
```

Determinism rules: no timestamp field; ordering is `scope` (machine, repo) → `target` (root, then
importers sorted by path) → `rule` (catalog order) → `path` → `line`; numbers are integers; strings
are NFC; JSON is 2-space indented with a trailing newline. `--with-timestamp` adds `generatedAt` and
is excluded from golden tests by construction.

`summary` counts every rule verdict exactly once: `error`, `warn` and `info` count the failing
findings by their effective severity; `pass` and `skip` count those statuses. A passing finding is
never counted under its rule's severity, and `info` is a severity, never a rendering of a pass
(Appendix D.1 and D.2 follow this rule). `summary.verdict` is `fail` when at least one finding sits
at or above `policy.failOn`, and `pass` otherwise; with `--fail-on none` the verdict is always `pass`
and `policy.failOn` records `none`.

### 10.3 Human output

Grouped by target, one line per finding, remediation indented under it, and a summary that
distinguishes pass / fail / skip. Passing rules are rolled up into a single `passing` line that names
them, never one line each (10.1); skipped rules keep their own line, with the reason. Color is emitted
only when `stdout` is a TTY and `NO_COLOR` is unset; the plain text is valid on its own
(Appendix D.1).

### 10.4 Exit codes

| Code | Meaning |
|---|---|
| `0` | No finding at or above `--fail-on`. Skips and infos do not fail. |
| `1` | At least one policy violation at or above `--fail-on`. |
| `2` | The tool could not answer: bad usage, unreadable input, malformed config, unavailable required probe under `--strict-probes`. Never used for a policy violation. |

`2` is the fail-closed code. A CI job that only distinguishes zero from non-zero still behaves
correctly, and a job that cares can tell the two apart without parsing text.

### 10.5 `--fail-on`

`--fail-on error` (default) | `warn` | `info` | `none`. `none` is the pure-reporting mode: `init`'s
planning and `explain` use it internally and do not expose the flag (`scan` is the only command that
accepts it, 11.1). The flag changes the verdict only; every finding is always reported.

---

## 11. Command contracts

### 11.1 `scan`

```
funky-secure scan [--scope auto|repo|machine|all] [--preset baseline|strict]
                  [--format human|json] [--fail-on error|warn|info|none]
                  [--only <ids>] [--ignore <ids>] [--strict-probes] [--with-timestamp]
```

- Read-only, always. No file is created, modified or removed, in any scope.
- Default: `--scope auto`, `--format human`, `--fail-on error`, preset from config or `baseline`.
- `--strict-probes`: a required probe that is unavailable becomes `error` (exit `2`) instead of
  `skip`. CI uses it to refuse a green build that measured nothing.
- Output: section 10. Exit: section 10.4.

### 11.2 `init`

```
funky-secure init [--preset baseline|strict] [--apply] [--allow-dirty] [--format human|json]
```

Default is a **plan**: it runs the same scan, derives the writes that would fix the fixable
findings, prints them, and exits `0`. `init` reports, it does not judge: it uses the `--fail-on none`
semantics of section 10.5 internally and does not accept the flag (`scan` is the only command that
does), because a plan is an offer, not a verdict. It exits `2` only when the tool cannot answer
(10.4), never because the plan is non-empty.

With `--apply` it performs exactly these writes, and no others:

| # | Target | Condition | Operation |
|---|---|---|---|
| W1 | `pnpm-workspace.yaml` | effective `minimumReleaseAge` < `policy.quarantineMinutes`, compared as reported and without claiming a source (12.2) | managed block with the policy value |
| W2 | `.gitignore` | `sensitive-ignored` fails | managed block with the missing entries required by R7: `.env`, `.env.*`, `!.env.example`, `!.env.test.example`, `*.pem`, `*.key`, plus `.npmrc` only when the repository does not track a root `.npmrc` without a token |
| W3 | `package.json` | `package-manager-pin` fails **without** conflict | set `packageManager` |
| W4 | `funky-secure.config.json` | `--preset strict` passed | persist `{ "preset": "strict" }` so CI agrees |

It never writes `ignoreScripts`, `allowBuilds`, `onlyBuiltDependencies`, `strictDepBuilds`,
`trustPolicy`, `blockExoticSubdeps`, dependency versions, `.npmrc`, workflows, or anything on the
machine.

`--format json` for `init` and `migrate` prints a **plan document**, not a scan report:
`{ schemaVersion, tool, command, policy, plan: [{ target, operation, path, digest, reason, state }], refused: [] }`.
`path` is absolute and `digest` is the sha256 of the exact bytes to be written, because a write plan
without them cannot be checked (11.5, point 5); absolute paths remain forbidden in the `scan` report
body only (10.1). `state` is `would-write`, `would-skip` (already at policy) or `conflict`.

A repository that gains a `pnpm-workspace.yaml` through W1 becomes a pnpm workspace root. That is a
real semantic change, and the plan item's `reason` states it next to the value being written.

Managed block format (line-based, no YAML parser):

```yaml
# funky-secure:begin (managed block — do not edit by hand)
minimumReleaseAge: 4320
# funky-secure:end
```

Rules for the block:

- Idempotent by marker. Second run: the block content is compared, and identical content means zero
  writes.
- Appended at the end of the file with one blank separator line when absent; only the lines between
  the markers are ever replaced when present.
- Refuses to write (`conflict` finding, no write) when the file already declares the same top-level
  key outside the block. Two sources for one setting is the defect this product exists to report.
- When the file does not exist, `init` creates it **only** for W1; it does not synthesize a
  `packages:` key (the old implementation's silent behavior was correct here and is kept).

Safety rules for `--apply`:

- A target file with uncommitted changes is refused (exit `2`, naming the file) unless
  `--allow-dirty`. A security tool does not mix its edits with a stranger's.
- An empty plan performs zero writes and prints `nothing to apply`.
- Every write is printed before it happens, with its absolute path and a content digest, on the same
  run (no dry-run/apply race).
- `init` never runs an install, never resolves a version, never touches the network.

### 11.3 `migrate`

```
funky-secure migrate [--from npm|yarn|auto] [--apply] [--allow-dirty]
```

Plan steps, printed in order:

1. **Evidence:** which foreign lockfiles and which package manager traces exist (`package.json`
   `packageManager`, `.npmrc` `package-manager` lines, `engines`).
2. **Report-only, no action:** behavior settings in `.npmrc` that pnpm no longer reads (4.1 and 1.3),
   listed by key name so the user moves them to `pnpm-workspace.yaml` or the pnpm global config
   deliberately.
3. **Human step:** create the pnpm lockfile (`pnpm import` for a yarn lockfile, `pnpm install`
   otherwise). This step is never executed by the tool: it resolves and downloads (4.9).
4. **Removal:** the foreign lockfile(s), only after `pnpm-lock.yaml` exists.
5. **CI follow-up:** the workflow lines that need rewriting, quoted by `file:line`, as suggestions.

`--apply` performs step 4 only. It refuses when `pnpm-lock.yaml` is absent (never delete the only
lockfile), when the tree is dirty for those files, or when the current branch is the default branch.
Every refusal is exit `2` with the reason, never a silent no-op. The default branch is read from
`refs/remotes/origin/HEAD` (12.1); a repository without a remote cannot resolve it, and the fallback
is a literal `main`/`master` match, stated as a fallback in the refusal message.

### 11.4 `explain`

```
funky-secure explain <rule-id>
funky-secure explain --list [--format json]
```

Prints, for one rule: id, title, friction class, severity per preset, the question it answers, the
detection in prose, the evidence shape, the remediation, what it deliberately does **not** do, and
the path of its documentation. An unknown id is exit `2`: a mistyped rule id is a configuration bug,
not a user error to be swallowed.

### 11.5 Write-target validation contract (applies to `apply` in v0.2 too)

Every write path in this product, present and future, obeys:

1. **The target comes from a closed catalog**, never from user input, an environment variable, or a
   string built from the repository. `--apply` chooses *whether* to write, never *where*.
2. **Resolved and contained:** the target's `realpath` must sit inside an allowed root (`git
   rev-parse --show-toplevel`, or for machine scope a declared machine root that v0.1 never writes).
   Symlinked paths that resolve outside are refused.
3. **Expected basename:** the resolved file name must match the catalog entry exactly.
4. **Re-validated immediately before the write** (no check-then-write gap).
5. **Printed as an absolute path** with a digest of the exact bytes to be written, in the same run
   that writes them.
6. **Read-only machine facts are still facts:** the store path, cache path, global bin dir and
   global dir are read from the effective configuration and printed as evidence (`--scope machine`),
   never created, never repaired.

The purpose is the one the author named: when `apply` exists, it must be impossible for a bug or a
prompt-injected instruction to redirect a write to an arbitrary path such as the user's store.

### 11.6 What no command does

No command runs an install, a build, a lifecycle script, a network request, a git write command
(`add`, `commit`, `checkout`), or a package-manager write command on the machine. No command modifies
`funky-ai`, `funky-cli`, or any file outside the current repository root.

---

## 12. Machine scope contract

### 12.1 Closed probe list

| Probe | Purpose |
|---|---|
| `pnpm --version` | active version, if it answers |
| `pnpm config list --json` | effective configuration (age policy, store, registry, `ignoreScripts`) |
| `where pnpm` (win32) / `which pnpm` (POSIX) | installations visible in `PATH` |
| `git rev-parse --show-toplevel` | repository root |
| `git ls-files -z` | tracked files |
| `git check-ignore --no-index --stdin -z` | behavioral ignore evaluation |
| `git ls-files --error-unmatch` | tracked-or-not for one path |
| `git status --porcelain -z -- <paths>` | dirty-tree refusal for `init --apply` and `migrate --apply` |
| `git rev-parse --abbrev-ref HEAD` | current branch for `migrate --apply` |
| `git symbolic-ref --short refs/remotes/origin/HEAD` | default branch for `migrate --apply` (may fail: no remote) |
| bounded file reads | `package.json`, `pnpm-workspace.yaml` (existence), `pnpm-lock.yaml` (specifier scan), `.gitignore`, workflows, `~/.npmrc` |

Every probe is spawned with an argument array and **`shell: false`**. On win32, a resolved `.cmd`
shim cannot be spawned without a shell, so the tool either prefers the `.exe` when one exists or
spawns `%ComSpec% /d /s /c` with an explicitly quoted, fully resolved path. This replaces the old
`shell: true` path (`runner.js`), which produced Node's `DEP0190` warning on every run and put a
concatenated command line between the tool and the argument list.

Probes are cached per run. A probe is never retried with different arguments, and the tool never
falls back to a second command to answer the same question: if the declared probe fails, the fact is
unavailable and the rules that need it return `skip` or `error` accordingly.

### 12.2 Version ambiguity is a first-class report

Appendix C records an observed disagreement on the author's machine: `pnpm --version` answered
`11.5.0` from inside a repository that pins `packageManager`, while the effective configuration
reported `userAgent: pnpm/12.3.4`, and `pmOnFail: download` means the pin can download and switch a
version at run time. The machine section therefore reports **both** observations and marks
`machine.versionAmbiguous: true` when they disagree, instead of claiming one number. A single-probe
answer is a guess, and pretending otherwise would be exactly the kind of stale assertion this RFC
exists to remove. That observation no longer reproduces on the same machine (C.1), so the behaviour
is pinned by an injected collector in tests, never by live evidence.

### 12.3 Redaction

Never printed: any value of `_authToken`, `_auth`, `_password`, `//<registry>:_authToken`, or any
environment variable matching `*_TOKEN`, `*_SECRET`, `*_KEY`. Presence is reported as `present` and
the value is replaced by `<redacted>`. A report is safe to paste into an issue.

### 12.4 The machine is never written

No environment variable, no global config file, no `setx`, no `corepack enable`, no `pnpm store`
command. Recommendations name the exact command and the report verifies the *next* run, which is the
only verification loop a read-only tool can honestly offer.

### 12.5 Machine facts that are not rules

`where`/`which pnpm` feeds `machine.installations` — the count and the resolved binary paths — and
`pnpm --version` versus `userAgent` feeds `machine.versionAmbiguous` (12.2). Both are **facts of the
report**, not findings: v0.1 has no rule for duplicated installations (the old design had one, and it
is not among the nine of section 8.2). They are printed in the machine section, they never change the
verdict, and `--fail-on` cannot fail because of them. G2 is satisfied by the facts, not by a rule.

---

## 13. Help, documentation and the drift gate

### 13.1 One source, three renderings

The rule catalog (each `src/rules/<id>.js` plus `src/rules/index.js`) is the only place where a rule's
id, title, friction, severities, remediation and question are written. From it:

| Rendering | Consumer |
|---|---|
| `funky-secure --help` | the terminal; lists commands, flags, and every rule id with its preset severities |
| `funky-secure explain <id>` | the terminal, in depth, for one rule |
| `docs/rules/<id>.md` | the repository, for review and for linking from a PR |

### 13.2 The gate that makes drift impossible

`tests/drift.test.js` fails when any of these is true:

- A rule in the catalog has no `docs/rules/<id>.md`.
- A file in `docs/rules/` declares an id that the catalog does not contain.
- `--help` output does not contain every catalog rule id and every flag parsed by `src/cli.js`.
- A flag parsed by `src/cli.js` is absent from `docs/cli.md`.
- `docs/architecture.md` lists a module that does not exist in `src/`.

CI runs this test on every push. Help text cannot describe a previous release, because it is
generated from the same data the current release executes, and the docs cannot describe a rule that
no longer exists, because the build fails.

### 13.3 `--help` never reflects repository state

`--help` prints the product's contract only. It never reads `package.json`, never prints a detected
preset, never runs a probe. Two people on two machines get the same help text, and it never says
something that was true before the last release.

### 13.4 Documentation set

```
docs/
  concept.md          what the product is, what it refuses to be, the two scopes
  cli.md              every command and flag, exit codes, JSON schema
  architecture.md     the four layers, the data flow, the invariants, the module map
  rules/<id>.md       one page per rule: question, detection, evidence, remediation, limits
  decisions.md        pointer to this RFC and to the decision log
```

`docs/architecture.md` is a required deliverable of the first implementation phase, not a follow-up:
the author's forge convention treats it as part of the product (D-14).

---

## 14. Repository and package layout

```
funky-secure/
├── .github/workflows/ci.yml       # suite, drift gate and self-scan (13.2, 15.4)
├── bin/funky-secure.js            # shebang, imports src/cli.js, sets process.exitCode
├── src/
│   ├── cli.js                     # argv parsing (no framework), command dispatch
│   ├── commands/
│   │   ├── scan.js
│   │   ├── init.js
│   │   ├── migrate.js
│   │   └── explain.js
│   ├── lib/
│   │   ├── targets.js             # target resolution (section 7.1)
│   │   ├── probes.js              # closed probe list (section 12.1)
│   │   ├── git.js                 # git read helpers
│   │   ├── config.js              # config discovery and validation (section 9)
│   │   ├── lockfile.js            # bounded pnpm-lock.yaml reader (R5)
│   │   ├── workflows.js           # minimal workflow reader for R8/R9
│   │   ├── policy.js              # presets, overrides, validation (section 9)
│   │   ├── report.js              # finding aggregation, ordering, verdict
│   │   ├── render-human.js
│   │   ├── render-json.js
│   │   ├── managed-block.js       # marker-based block read/replace
│   │   └── paths.js               # write-target validation (section 11.5)
│   └── rules/
│       ├── index.js               # catalog: id -> module, catalog order
│       └── <id>.js                # one pure rule each (nine in v0.1)
├── docs/                          # section 13.4
├── rfcs/funky-secure-rfc.md       # this document
├── odd/tasks/                     # implementation tasks, one file per phase
├── scripts/gen-golden.js          # regenerates the golden reports (15.2)
├── tests/
│   ├── rules/<id>.test.js
│   ├── golden/                    # expected JSON reports
│   ├── fixtures/                  # read-only repository fixtures per rule
│   ├── cli.test.js                # exit codes, flag parsing, help content
│   └── drift.test.js              # section 13.2
├── package.json                   # zero dependencies, bin, files, engines >= 20.11
├── LICENSE                        # MIT, as funky-forge
└── README.md
```

Deliberate absences: no `src/utils/` dumping ground, no state directory, no `.funky/`, no config
generator, no `dist/`, no build step, no devDependency.

---

## 15. Testing and validation plan

Runner: Node's built-in test runner — `node --test`, with `node:test` and `node:assert` — and no
devDependency at all (4.7). `npm test` runs the suite, `scripts/gen-golden.js` regenerates the
goldens (15.2), and `.github/workflows/ci.yml` runs the suite, the drift gate and the self-scan
(15.4).

### 15.1 Rules are pure, so tests need no filesystem

Each rule is tested with a plain context object: inputs in, findings out. This is the structural fix
for the old suite, where the command tests needed `vi.mock('fs')`, a fake CWD constant table and
`applyMocks`/`applyWrites` helpers (289 lines of test infrastructure for three commands) because
detection and I/O were fused. Target: no test file mocks `node:fs`; only the collector tests touch
disk, and they use read-only copies under `tests/fixtures/`.

### 15.2 Golden reports

For each fixture repository, one golden JSON. A change in severity, ordering, message or evidence
shape fails the golden and must be justified in the commit message. Golden files are generated by a
script and reviewed as diffs; they are never hand-edited.

### 15.3 Differential checks for shared code

When a change touches shared code (the collector, the policy resolver, the renderer), the previous
code is copied to a scratch directory and both versions are run over the same fixtures; any
difference in stdout, stderr or exit code that the change did not intend is a regression and gets a
test.

### 15.4 Dogfooding from the first commit

The product's own CI runs:

```sh
node bin/funky-secure.js scan --scope repo --fail-on warn
```

and a test asserts the self-scan is clean. A rule that cannot pass on this repository is not
releasable, which is the mechanism that prevents the situation described in 2.8.

### 15.5 Empirical validations required before implementation

Blocking. Each one has the exact command and the observation that must be recorded in the phase
notes.

| # | Question | How to answer | If the assumption fails |
|---|---|---|---|
| E1 | What is pnpm's real default `minimumReleaseAge` on the pinned version? | `pnpm config list --json` on a clean config, plus the docs of the pinned major | Report the observed default instead of a documented one; never hardcode it |
| E2 | Does `pnpm config list --json` expose workspace-scoped keys, and can their origin be inferred? | run inside a repo with and without the key in `pnpm-workspace.yaml` | Drop the "origin" field; keep the effective value only |
| E3 | Does `git check-ignore --no-index --stdin -z` honor negations and nested ignore files? | fixture with `.env` then `!.env` | Fall back to textual analysis plus an explicit warning in the finding |
| E4 | Does `git ls-files -z -- ':(glob)**/.env*'` match in subdirectories on win32? | run on a nested fixture | Use a full `git ls-files -z` plus basename filter |
| E5 | Is `frozen-lockfile` really the CI default? | workflow with `CI=true` and a modified lockfile | Promote `ci-no-safety-overrides` into v0.1 and revisit 8.3 |
| E6 | How do multi-line `uses:`, block scalars and `with:` maps appear in the target workflows? | parse this repository's own `.github/workflows/ci.yml` once F0 creates it, plus two copied samples under `tests/fixtures/workflows/` | Narrow the reader to the shapes it can prove and return `skip: unparseable-workflow` for the rest (R9) |
| E7 | Can a `.cmd` shim be spawned on win32 without `shell: true`? | spawn `%ComSpec% /d /s /c` with explicit quoting | Keep `shell: true` for shims only, documented, with a fixed argv |
| E8 | Does pnpm read `minimum-release-age` from a project `.npmrc` (`pnpm config set … --location=project`), or only from `pnpm-workspace.yaml` and the global config (1.3, fact 3)? | fixture with the key in `.npmrc` only: `pnpm config list --json`, then a real install of a fresh package | R4's manual alternative disappears and the managed block (W1) becomes the single remediation |

Every one of these runs inside a fixture under `.tmp/`, inside this repository. A run against another
repository is a manual check with the owner's explicit authorization, never part of the suite
(20.12).

### 15.6 What is deliberately not tested

Network behavior, because there is none. Timing, because nothing is timed. `node_modules` content,
because it is not read. The machine scope on a clean machine, beyond a smoke test that probes fail
closed.

---

## 16. Implementation plan

Six work units, each a reviewable slice with tests and docs. Line counts are expectations, not caps.

### F0 — Skeleton and contracts (no rules)

- Repository, `package.json` (zero deps, `bin`, `files`, `engines`), `LICENSE`, `README`.
- `src/cli.js` with all four commands parsed, every flag wired to a real option, `--help` rendering
  from an empty catalog, exit codes `0/1/2` implemented.
- `src/lib/{report,render-json,render-human,policy,paths}.js` with the report shape of section 10.
- `tests/cli.test.js` covering exit codes and flag parsing; `tests/drift.test.js` active with an
  empty catalog.
- **Acceptance:** `scan` on an empty repository prints a valid empty report in both formats and
  exits `0`; `--help` lists the four commands; the drift test runs.

### F1 — Rules, one commit each

Nine tasks, in dependency order: `lockfile-committed` → `package-manager-pin` → `foreign-lockfile`
→ `quarantine` → `env-not-tracked` → `sensitive-ignored` → `exact-versions` → `actions-pinned-sha`
→ `no-bot-auto-merge`. Each ships the rule, its unit tests, its fixture when it needs one, its
`docs/rules/<id>.md`, and its golden report.

**Acceptance per rule:** one test for the rule's own question, one for its false-positive boundary
(the case it must not flag), one for its `skip` path, and the drift gate green.

### F2 — `init`

Plan generation, writes W1–W3, W4 for the strict preset, managed-block idempotency, dirty-tree
refusal, and the "nothing to apply" path.

**Acceptance:** a fixture already at policy is a no-op; a fixture below policy gets exactly one block
written; a second `--apply` performs zero writes; a dirty tree exits `2`; `--apply` on a compliant
repository writes nothing.

### F3 — `migrate`

Plan generation per section 11.3, `--apply` for lockfile removal only, all three refusals.

**Acceptance:** an npm fixture produces a five-step plan naming the real files; `--apply` without a
pnpm lockfile refuses with exit `2` and removes nothing; `--apply` with a pnpm lockfile removes the
foreign lockfile and nothing else.

### F4 — Documentation, dogfooding and release

`docs/concept.md`, `docs/cli.md`, `docs/architecture.md`, `docs/decisions.md`; the self-scan job in
CI; `README` with install, first scan, and the explicit statement of what the product does not do.

**Acceptance:** drift gate green, self-scan clean at `--fail-on warn`, `0.1.0` packable
(`npm pack --dry-run` lists only `bin`, `src`, `docs`, `README`, `LICENSE`).

### F5 — v2 backlog intake

The nine deferred rules of section 8.3, ordered by expected value, starting with `editor-hooks`
(stateless) and `ci-no-safety-overrides` (needs E5). Not part of `0.1.0`.

---

## 17. Relationship with funky-ai

**No action in `funky-ai`.** That repository has no published npm package and is intentionally out of
scope (D-10). Therefore:

- `funky-cli`'s `funky secure` command stays exactly as it is: not removed, not deprecated, not
  documented as superseded inside that repository, not invoked by this package.
- `docs/funky-ai/feature-secure.md` and `docs/funky-ai/secure.md` remain as the historical record of
  the old design. This RFC supersedes their content for the new product; nothing is edited there.
- No shared code, no shared dependency, no shared state. `funky-secure` is installable and useful
  without `funky-cli` on the machine.

Semantic mapping for anyone who used the old command:

| Old | New | Note |
|---|---|---|
| `funky secure doctor` | `funky-secure scan` | read-only, same intent, one engine |
| `funky secure check` | `funky-secure scan --fail-on error` | the verdict is a flag, not a command |
| `funky secure check --rebaseline` | removed | a gate does not mutate (2.4) |
| `funky secure init --posture …` | `funky-secure init --preset …` | preset is a policy, not a lifecycle posture |
| seven seeded keys | at most one managed block (`minimumReleaseAge`) | 4.1 |
| `AGENTS.md` injection | removed | an agent rule is not a security control |
| `.funky/secure-state.json` | removed | 4.4 |
| exit `0/1` | exit `0/1/2` | 10.4 |

---

## 18. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| K1 | `baseline` is stricter than expected and the tool gets turned off | medium | high | Friction table (4.2); every rule can be `off` in config; `--fail-on` decouples reporting from gating |
| K2 | `pnpm config list --json` changes shape across pnpm majors | medium | medium | One parser, one test per supported major, and an unknown-shape path that reports `skip` instead of guessing |
| K3 | Windows spawn of pnpm shims regresses (the old `DEP0190` warning) | medium | medium | E7 before implementation; closed probe list; documented fallback |
| K4 | `exact-versions` produces a wall of findings on a real repository, hiding the rest | high | medium | `warn` in `baseline`, grouped per importer, and the human renderer collapses to a count; `--only exact-versions` for the detail |
| K5 | Rule ids become a public contract and cannot change | high | low | Documented in 6.2; changes need a decision-log entry and an alias period |
| K6 | Missing probes produce a false green in CI | medium | high | Skips counted and printed separately; `--strict-probes` for CI |
| K7 | Scope creep toward enforcement (the npm shim debate) | medium | high | N3 is a non-goal, not a backlog item; `explain` repeats it per rule |
| K8 | The tool reports a policy the machine contradicts (global vs repository) | medium | medium | The effective value is reported exactly as pnpm reports it and the rule claims no source (12.2); no precedence logic of our own (4.1) |
| K9 | A rule's documentation and its code drift | low | medium | The drift gate (13.2) |
| K10 | `migrate --apply` deletes a lockfile someone needed | low | high | Refusal without a pnpm lockfile, dirty-tree check, non-default-branch requirement, and only step 4 is automatable |

---

## 19. Resolved design questions

Resolved in this revision:

1. **Name:** `funky-secure`, no version suffix (6.1).
2. **Own repository**, independent package, zero dependencies (4.7, 14).
3. **Nine rules in v0.1**, the rest deferred (8.4).
4. **`exact-versions` severity:** `warn` in `baseline`, `error` in `strict` (8.2 R5, 9.1).
5. **`init` does not write `pnpm-workspace.yaml` in v0.1** except the managed block, when the
   effective quarantine is below policy, and only with `--apply` (11.2).
6. **No lifecycle-script posture is seeded** and no `ignoreScripts` write exists (2.3, N6).
7. **No state file** in v0.1 (4.4).
8. **No enforcement of pnpm**: recommend and migrate (G4, N3).
9. **`funky-ai` untouched** (17).
10. **Help and docs are generated from the catalog and gated in CI** (13).
11. **Severity deviations from the friction guidance are declared per rule and justified in place:**
    R3 `foreign-lockfile`, R4 `quarantine`, R8 `actions-pinned-sha` (8.2, 9.1).
12. **Write-target validation is specified now**, before any `apply` exists (11.5).

Left open on purpose, to be answered by evidence during implementation rather than guessed now:
E1–E8 (15.5) and the split-severity form of `exact-versions` (a v2 extension, 8.2 R5).

Added or corrected in revision 2:

13. **The closed probe list gains three git reads** — `status --porcelain`, the current branch and the
    default branch — because `init --apply` and `migrate --apply` cannot honour their refusals without
    them (12.1, 11.2, 11.3).
14. **Two bounded readers ship in v0.1:** `src/lib/lockfile.js` for the specifier comparison of R5,
    and `src/lib/workflows.js` for the structural claims of R8/R9 (8.2, 14). Both degrade to `skip`
    instead of guessing, and both name their supported shape.
15. **`quarantine` reports the effective value and no origin** (8.2 R4). The inheritance guard that
    W1 used to carry is gone: it was unobservable (E2) and contradicted the write table (11.2).
16. **R4's remediation is the managed block W1**, with `pnpm config set … --location=project` offered
    only if E8 proves pnpm still reads it (15.5).
17. **The report contract is closed:** `code` exists in `Finding`; only `fail`/`skip`/`error` are
    serialized; `summary` counts each verdict once; the verdict with `--fail-on none` is defined; and
    `off` runs nothing (9.2, 10.1, 10.2, 10.5).
18. **`init` and `migrate` have a JSON plan document** with absolute paths and digests, and `init`
    does not accept `--fail-on` (11.2, 10.5).

---

## 20. Acceptance criteria

`funky-secure` `0.1.0` is accepted when all of the following hold:

1. `scan` produces identical output on two consecutive runs over the same repository state (4.9).
2. `scan` writes nothing: a filesystem snapshot before and after is identical, in both scopes.
3. The nine rules exist, are documented, and each has tests for its question, its boundary and its
   skip path (8.2, 15.1).
4. The JSON report validates against the documented schema, has stable ordering, and contains no
   absolute paths outside the machine scope (10.1, 10.2).
5. Exit codes `0`, `1` and `2` mean pass, violation and tool failure respectively, each covered by a
   test (10.4).
6. `init` without `--apply` writes nothing; with `--apply` it performs only W1–W4; a second run
   performs zero writes (11.2).
7. `init --apply` refuses a dirty tree with exit `2` and names the file (11.2).
8. `migrate --apply` refuses without a pnpm lockfile and removes only the foreign lockfile (11.3).
9. The drift gate is green, and deleting a rule's documentation makes it red (13.2).
10. The product's own CI self-scan is clean at `--fail-on warn` (15.4).
11. `npm pack --dry-run` contains no test fixtures, no `node_modules`, no state (F4).
12. A manual run of `scan` against two real repositories produces reports a human agrees with. This is
    a one-off check with the owner's explicit authorization, because it reads outside this repository;
    it is never part of the suite and never part of CI.
13. `scan --format json` lists no `pass` finding, counts them in `summary.pass`, and a rule set to
    `off` contributes neither a finding nor a count (10.1, 10.2, 9.2).
14. `init --format json` and `migrate --format json` emit the plan document of 11.2, with absolute
    paths and content digests.

---

## Appendix A — Decision log

Quotes are verbatim from the author; no correction of spelling or accents. Dates are the session in
which the decision was taken.

| # | Decision | Verbatim source | Section |
|---|---|---|---|
| D-1 | The product analyses a project **and** initializes it with good practices | "Es una manera de analizar tu proyecto o inicializarlo con buenas practicas." | 1.1 |
| D-2 | pnpm's defaults are the baseline; the tool does not re-implement them | "En npm hay mala reputacion por ataques de supply chain, pnpm ya en ultimas versiones trae un minimum release age por default, y un approve builds para no correr scripts como postinstalls u otra cosa peligrosa." | 1.3, 4.1 |
| D-3 | pnpm is recommended and npm is migrated, never required | "nuestra filosofia es recomendar siempre pnpm y migrar en caso de haber npm, no es obligatorio pero se menciona." | G4, R3, 11.3 |
| D-4 | The product must be lighter and better focused than the old one | "Como muchas cosas ya han cambiado, funky secure tal vez podría ser mas ligero que antes y mejor enfocado." | 4, 8.4 |
| D-5 | A global scan that overwrites nothing, **plus** project and workspace scanning | "Un escaneo global como ya se hace que no sobrescribe nada de config del usuario, tambien puede hacer escaneo del proyecto o workspace, ya que hay configuracion de proyecto tambien." | 7, 12 |
| D-6 | No floating ranges; no automatic dependency merges | "El caso de usar carets en los package no me gusta, tampoco suelo usar dependabot ya que nunca se puede saber si es seguro sin auditar, un merge automatico es riesgoso." | R5, R9 |
| D-7 | In CI: Actions pinned by SHA; sensitive files and `.env` covered | "Tambien en CI suelo recomendar usar shas para las versiones, para siempre saber la version exacta y evitar posibles ataques, tambien el revisar que el gitignore o archivos sencibles como .env esten incluidos." | R6, R7, R8 |
| D-8 | Name and packaging | "será repo propio, funky-secure, sin \"v2\"." | 6 |
| D-9 | Nine rules now, the rest in v2 | "Mantengamos las 9 reglas iniciales, para v2 el resto." | 8.2, 8.3, 8.4 |
| D-10 | `funky-ai` is out of scope and untouched | "no tocaremos funky-ai, ese repo no tiene paquete npm publicado, se ignora, eso hicimos con forge." | 17 |
| D-11 | Severity of `exact-versions` | "Mi voto: warn en baseline, error en strict." | R5, 9.1 |
| D-12 | What `init` may write | "Mi voto: no lo escribe en v0.1; solo el bloque gestionado si detecta que la cuarentena efectiva es menor a la política, y aun así con --apply." | 11.2 |
| D-13 | Receipt-driven development enabled for this workspace | "prender rdd en este workspace" | session control |
| D-14 | Help is always current; complete architecture docs are a deliverable | "en funky-forge tenemos una politica de el comando help se actualiza siempre, no refleja estado no actualizado, tambien tenemos docs de la arquitectura completa." | 13, 14 |
| D-15 | This session ends with the RFC; implementation happens in another session | "Esta sesion terminará con la redaccion de un mega rfc, tal cual se hizo en funky-forge, para tener todo recabado y aprobarlo e implementar en otra sesio" (as typed; truncated in the source message) | whole document |

---

## Appendix B — Evidence of current defects

All references are `funky-ai/funky-cli` at `main`, version `4.9.1`.

| # | Defect | Evidence |
|---|---|---|
| B-1 | Two engines for one truth | `src/utils/secureDomain.js:151` (`diagnose`) vs `:249` (`evaluate`); handlers at `src/commands/secure.js:44` and `:235` |
| B-2 | Seven-key seed duplicating manager defaults | `src/utils/secureYaml.js:5` (`STANDARD_KEYS`) and `:17` (`FAIL_FAST_KEYS`) |
| B-3 | Lifecycle posture seeded into user repositories | `secureYaml.js:5` `ignoreScripts: true`; the approval-fatigue warning at `secure.js` step 6 of `runInit` |
| B-4 | A gate that mutates state | `secure.js:274` (`--rebaseline` writes the state file inside `check`) |
| B-5 | Exit 1 conflates policy and tooling | probe failures pushed into the violation list at `secure.js:250` and `:260` |
| B-6 | Hook baseline inert on a fresh clone | `src/utils/secureSnapshot.js:30` (`buildBaseline`), `:78` (`compareBaseline`); `.funky/` gitignored by `init` |
| B-7 | Detects floating ranges, never fixes them | `secureDomain.js:219` (`floatingRanges`) consumed by `evaluate`; no fix path in `runInit` |
| B-8 | Product does not dogfood | `funky-cli/pnpm-workspace.yaml` contains only `pmOnFail`; `funky-cli/package.json` uses `^` on every dependency |
| B-9 | Help depends on `cwd` | `src/utils/help.js:17` (`resolveDocCandidates` defaults to `process.cwd()`), wired at `bin/funky.js:39` |
| B-10 | Documented features that do not exist | `docs/funky-ai/feature-secure.md` section 5 lists `audit`, `incident`, `approve`, `global`; none exists in `src/commands/` |
| B-11 | `shell: true` on win32 | `src/utils/runner.js` (produces Node `DEP0190` on every run; observed in the suite) |
| B-12 | Test infrastructure compensating for fused I/O | `tests/secureCommand.test.js` (289 lines) with `vi.mock('fs')`, `applyMocks`, `applyWrites` |

---

## Appendix C — Observed environment evidence

Collected on the author's machine during this session, read-only. Reproduced here because two
decisions of this RFC depend on it (4.1 and 12.2).

```text
$ pnpm --version                     # cwd: M:/funky-ai/funky-cli (packageManager: pnpm@11.5.0)
11.5.0

$ pnpm config list --json            # abridged to the relevant keys
{
  "ignoreScripts": true,
  "minimumReleaseAge": 4320,
  "pmOnFail": "download",
  "storeDir": "M:/.../.pnpm-store",
  "cacheDir": "M:/.../.pnpm-cache",
  "globalDir": "M:/.../.pnpm-global",
  "globalBinDir": "M:/.../.pnpm-global/bin",
  "registry": "https://registry.npmjs.org/",
  "userAgent": "pnpm/12.3.4 npm/? node/? win32 x64"
}
```

### C.1 Staleness (revision 2)

The block above was recorded during the RFC session. Re-measured on the same machine during the
review that produced revision 2, `pnpm --version` answers **12.3.4** — identical to the `userAgent`
value — so the disagreement that motivated 12.2 does not reproduce today. Two consequences: E1 must
be answered on the pnpm this repository ends up pinning, and 12.2's ambiguity is covered by an
injected collector in tests rather than by live evidence. No other claim in the block is assumed by
the implementation.

What it demonstrates:

1. **4.1 is empirically true.** The age quarantine (4320) and `ignoreScripts` are already effective
   on this machine. Seeding them per repository restates an inherited fact.
2. **12.2 is empirically true.** The version reported by `--version` (11.5.0, the pinned one) and the
   version in `userAgent` (12.3.4) disagree. A single-version claim would be wrong on this setup.
3. **Store paths are readable facts** and belong in the machine report as evidence (11.5, point 6).

Repository evidence showing that the policies behind R8 and R9 are real practices rather than
aspirations:

```text
M:/funky-ai/.github/workflows/ci.yml
   9:  permissions:              (least privilege declared)
  19:  uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  24:  uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9
  29:  uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
  37:  run: pnpm install --frozen-lockfile

M:/funky-ai/.github/dependabot.yml    present, weekly, no auto-merge configured
M:/funky-forge-v2/.github/            absent
```

`actions-pinned-sha` (R8) passes on that workflow today, and `no-bot-auto-merge` (R9) reports the
`info` finding for Dependabot without an `error` — the intended split between "automated updates
exist" and "automated updates merge themselves".

---

## Appendix D — Output examples

### D.1 `scan` — human output, repository below policy

```text
funky-secure scan  ·  preset baseline  ·  scope all

machine
  pnpm 12.3.4 (M:/.pnpm-global/bin/pnpm.CMD)  ·  store M:/.pnpm-store

repo-root
  ✖ quarantine          pnpm-workspace.yaml  minimumReleaseAge is 1440; policy requires 4320
                        → funky-secure init --apply   (writes the managed block, 11.2)

importer  packages/api/package.json
  ⚠ exact-versions      packages/api/package.json:14  yaml@^2.9.0 is a floating range
                        → pnpm add --save-exact yaml@2.9.0

ci
  ⚠ actions-pinned-sha  .github/workflows/ci.yml:31  pnpm/action-setup@v6 is not a commit SHA
                        → uses: pnpm/action-setup@<sha> # v6.0.9

passing  6 rules (package-manager-pin, lockfile-committed, foreign-lockfile, env-not-tracked,
         sensitive-ignored, no-bot-auto-merge)   ·   0 skipped

summary  1 error · 2 warnings · 0 info · 6 passing · 0 skipped
verdict  FAIL (threshold: error)
```

### D.2 `scan --format json` (abridged to one finding)

```json
{
  "schemaVersion": 1,
  "tool": { "name": "funky-secure", "version": "0.1.0" },
  "scope": "all",
  "policy": { "preset": "baseline", "quarantineMinutes": 4320, "failOn": "error" },
  "targets": [
    { "kind": "machine", "detail": "pnpm 11.5.0" },
    { "kind": "repo-root", "path": "." },
    { "kind": "importer", "path": "packages/api" }
  ],
  "summary": { "error": 1, "warn": 2, "info": 0, "pass": 6, "skip": 0, "verdict": "fail" },
  "findings": [
    {
      "rule": "quarantine",
      "status": "fail",
      "severity": "error",
      "scope": "repo",
      "target": "repo-root",
      "path": "pnpm-workspace.yaml",
      "message": "minimumReleaseAge is 1440; policy requires 4320",
      "evidence": { "effective": 1440, "policy": 4320, "exclusions": [] },
      "remediation": {
        "kind": "auto",
        "command": "funky-secure init --apply"
      },
      "doc": "funky-secure explain quarantine"
    }
  ]
}
```

### D.3 `init` — plan without `--apply`

```text
funky-secure init  ·  preset baseline  ·  plan only (nothing has been written)

would write
  pnpm-workspace.yaml   create + managed block   minimumReleaseAge: 4320   (effective 1440 < policy 4320;
                                                 the file did not exist, so this repository becomes a
                                                 workspace root without a packages: key)
  .gitignore            append managed block   .env, .env.*, !.env.example, !.env.test.example, *.pem, *.key
  package.json          set packageManager    pnpm@12.3.4

would not write
  ignoreScripts, allowBuilds, onlyBuiltDependencies   manager-owned: reported, never seeded
  workflows, dependency versions, ~/.npmrc            out of scope

run with --apply to perform the 3 writes above
```

### D.4 `migrate` — plan

```text
funky-secure migrate  ·  from npm  ·  plan only

1. evidence
   package-lock.json present · pnpm-lock.yaml absent · packageManager absent

2. behavior settings in .npmrc that pnpm does not read
   minimum-release-age   move to pnpm-workspace.yaml or the pnpm global config

3. human step (not run by this tool)
   pnpm install

4. would remove (only after pnpm-lock.yaml exists)
   package-lock.json

5. CI follow-up (manual)
   .github/workflows/ci.yml:22   npm ci  ->  pnpm install --frozen-lockfile

run with --apply to perform step 4
```

### D.5 `explain exact-versions` (abridged)

```text
funky-secure explain exact-versions

question      Are dependency specifiers exact, and does the lockfile agree?
severity      baseline: warn   strict: error          friction: 2 (expensive)
remediation   manual — pnpm add --save-exact <pkg>@<version>

detects       ^, ~, >, <, *, latest, x-ranges and git/tarball URLs in the four dependency sections
              of every workspace importer, plus a package.json/lockfile specifier disagreement
              (lockfile-desync).

does not      pin versions for you, re-resolve the lockfile, or judge whether a version is secure.

docs          docs/rules/exact-versions.md
```

---

## Closing note

The old `funky secure` failed for one reason worth naming: it answered a question nobody asked —
"can I make this repository look hardened" — instead of the question that matters: "is this
repository, and the machine that builds it, configured the way we decided, and if not, what exactly
do I run next". Everything in this RFC follows from moving that answer from *writes* to *evidence*,
and from refusing to own a setting the package manager already owns.

Nine rules, one engine, two scopes, zero writes unless asked.
