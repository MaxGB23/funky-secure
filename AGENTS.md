# AGENTS.md

Where things live in this repository. Two axes, and each document belongs to exactly one.

| Axis | Answers | Where | Mutability |
|---|---|---|---|
| **Record** | what we decided and why | `rfcs/NNNN-<slug>/rfc.md`, `odd/tasks/<feature>.md` | frozen once `implemented` or `closed` |
| **Present** | what is true now | `docs/spec/`, `docs/decisions.md`, the rest of `docs/` | edited freely, in its own pull request |

## Paths

| Path | What it is |
|---|---|
| `docs/spec/` | **The normative contract.** Extracted verbatim from RFC 0001 sections 6-14 and 17. Where the spec and the record disagree, the spec wins. |
| `docs/README.md` | The map from a change to the page that must move with it. Start here when you touched code. |
| `docs/architecture.md` | The four layers, the per-command flows, the invariants and the module map. |
| `docs/cli.md` | Every command, flag, exit code and JSON field. The operating manual, not a second specification. |
| `docs/concept.md` | What the product is and what it refuses to be. |
| `docs/guide.md` | How to read the output, and what to do about each rule a reader meets. |
| `docs/images/` | The diagram that ships with the package, and its `README.md` note. |
| `docs/spec/README.md` | The map from every section number (`10.3`, `11.2.1`) to the file that carries it. |
| `docs/delivery.md` | Contract for CI, pinning, release and provenance (record §17). |
| `docs/rules/<id>.md` | The page a user reads about one rule; names the spec as normative. |
| `docs/decisions.md` | Decision log, `D-n` product decisions and `I-n` implementation decisions. |
| `docs/field-loop.md` | The method that finds what the tests cannot: delegate a fresh session per scenario, triage every claim against the code, pine the finding as a fixture. |
| `rfcs/README.md` | RFC registry: number, title, status, `supersedes` / `superseded-by`. |
| `rfcs/0001-funky-secure-v1/rfc.md` | Frozen record, revision 7. **Not edited.** Corrections are a dated `## Errata` append or the next record. |
| `odd/tasks/<feature>.md` | Feature record: specs, tasks, and an append-only Log. |
| `src/`, `tests/`, `scripts/` | Code, suite and the golden generator. |

The path map is a fact the suite checks: `tests/docs-contract.test.js` fails when an entry here names
a path that is not on disk.

## Working rules

- **A recommendation is not authorization.** "What do you recommend", a review, a comparison or a
  problem statement is read-only: answer, then wait. Implement only when the change itself was asked
  for.
- A behaviour change starts in `docs/spec/`, in its own pull request. Behaviour the record never
  decided starts with the next numbered RFC under `rfcs/`, opened as `draft`.
- The append-only Log of an `odd/tasks/` document is evidence: append, never rewrite.
- Zero runtime and zero dev dependencies, no network, no machine writes as a side effect; every write
  inside the repository goes through `validateWriteTarget`, and the one write outside it is
  `skill --install` (11.5 point 7). See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full hard rules.
- CLI output carries symbols (`✖ ⚠ ℹ ✓ –`), never emoji: double-width glyphs break alignment and
  determinism. Color only on a TTY.
- **The JSON report is the machine contract; the human text is presentation and may change.**
- **A pull request passes `pr-policy` or it does not count, and every part of it is knowable before
  the push**: the body links an issue (`Closes #N`, `Fixes #N` or `Refs #N`), exactly one `type:*`
  label is applied, and the branch is `type/description`, where `type` is one of `feat fix chore docs
  style refactor perf test build ci revert`. The rule lives in
  [`CONTRIBUTING.md`](CONTRIBUTING.md) and in `scripts/check-pr-policy.js`; the script is the same one
  CI runs, so run it first, not after the failure notice. `main` requires no status checks, so nothing
  stops a red pull request from merging: the check is only as real as the run before it.
- **A pull request merges only when its checks have finished, and "finished" is a state list, not a
  feeling.** `gh pr checks <n> --json state` must show no state outside `SUCCESS`, `SKIPPED` and
  `NEUTRAL`. `gh pr checks --watch` is not that gate — it exits `1` while checks are still pending,
  and that exit code does not mean failure — and `mergeStateStatus: CLEAN` is not that gate either,
  because it reports mergeability, not the matrix. After the merge, the push run on `main` must be
  green too: the merge commit is the one that ships.
- **A `pr-policy` failure with the matrix green is the label race, not a violation.** The label is
  attached after the pull request exists, so the `opened` run reads `PR_LABELS` empty. Re-run it
  (`gh run rerun --failed`) and do not change the code; creating the pull request as a draft,
  labelling it, then marking it ready avoids the race entirely, which is what the `pr-policy` job's
  draft guard in `.github/workflows/ci.yml` expects.

## Commands

```sh
node --test                    # the suite: rules, commands, drift gate, goldens, self-scan
node scripts/gen-golden.js     # regenerate goldens after an intended report change
node bin/funky-secure.js scan --scope repo --fail-on warn   # self-scan, what CI runs
PR_BODY="$(cat body.md)" PR_LABELS=type:docs PR_HEAD_REF="$(git branch --show-current)" \\
  node scripts/check-pr-policy.js   # the pull request policy, before the push
```
