# The command speaks the shells it names

Issue #548. Four blind judgements measured every cell of the shell matrix. The design is closed; this record is the checklist of what they measured, with the path and the line. No clause here is an opinion.

## The matrix (measured: cmd, bash, sh, pwsh 7, WinPS 5.1)

| spelling | cmd | bash | sh | pwsh 7 | WinPS 5.1 |
|---|---|---|---|---|---|
| `'dependencies["x"]=1'` (today) | fails | ok | ok | ok via `pnpm.ps1`; fails via `pnpm.cmd` | `&&` rejected |
| `"dependencies[\"x\"]=1"` | ok | ok | ok | **2 args** → `ERR_PNPM_PKG_SET_INVALID_ARG` | `&&` rejected |
| `dependencies.x=1` | ok | ok | ok | ok | `&&` rejected |

## Specs

- **S1 — the shells are named with the loss.** Commands are written for `cmd`, `bash` and `sh`. `pwsh` 7 keeps working for every **unscoped** name through the dotted form and loses only scoped ones (2 args, a loud pnpm error, no write); `WinPS` 5.1 rejects `&&` before any quoting. The spec says exactly this.
- **S2 — the predicate, in three clauses.** A name takes the quote-free dotted path iff it is unscoped **and** carries no dot **and** does not start with a digit. `dependencies.lodash.merge=…` writes `{"lodash":{"merge":…}}` beside the untouched entry (corrupting, exit 0); `dependencies.7zip-bin=…` is rejected (`Numeric suffix "z" is not supported`) — both measured, both real published names. Every other name takes the bracketed path, double-quoted with the inner quotes escaped: `pnpm pkg set "dependencies[\"@types/node\"]=20.11.5" && pnpm install`.
- **S3 — `-C` quotes unless the directory is provably safe.** Quote with double quotes unless the directory matches `^[A-Za-z0-9._/-]+$`; quoting fixes `&`, `;`, `^`, `$`, parentheses and globs (measured: `-C "packages/a&b"`, `"a;b"`, `"a^b"` all arrive exact on cmd and bash, while bare `a&b` splits and bare `a^b` silently resolves to `packages/ab` with exit 0). Two holes get named, never hidden: `%NAME%` expands even inside double quotes on cmd, and a directory containing `"` has no cross-shell escape (`\"` collapses the cmd line so `&&` becomes a literal argument and the install never runs). For those two the record states the limitation instead of printing a command that lies.
- **S4 — the document changes value, not shape.** The goldens regenerate; `tests/golden/dirty.json:128` becomes `pnpm pkg set dependencies.left-pad=1.3.0 && pnpm install`. No key moves, `schemaVersion` stays.
- **S5 — the check can fail, and it can run.** The probe gains a Windows leg: `.github/workflows/ci.yml:90` is `runs-on: ubuntu-24.04` for `runtime-claims`, and `:138` is the only probe step, so today every printed command is executed by the one shell where the defect never existed. The runner must spawn through `execSync(command)` (ComSpec `/d /s /c`), never `execFileSync('cmd', ['/c', command])`, which mangles the correct command into `Input ends without closing quote (")` — measured. `tests/ci-coverage.test.js:193-201` pins the step inside `runtime-claims` and moves with it.

## Tasks

- T1 (S2, S3) — `pinCommand` (`src/rules/exact-versions.js:247-251`) and `pnpmAt` (`:222-227`), plus the falsified "one form and one thing to remember" rationale (`:228-241`).
- T2 (S5) — the probe's spawn shape, its Windows leg in `ci.yml`, and the ci-coverage pin. An invariant over every golden command whose first token is `pnpm|git|corepack`, **including the wrapped form** (`(cd "<root>" && …)`, `src/lib/render-human.js:96`), which the first-token rule alone would miss.
- T3 (S4) — the goldens, and the test literals: `tests/rules/exact-versions.test.js:164,167,231,279,757,809,1140-1143,1180,1230,1518` (+ comments `:180,251-253`), `tests/probe-remediation.test.js:161,169` (+ comment `:298`).
- T4 (S1) — the spec first, in its own pull request: `docs/spec/rules.md` **R5** at `:223` and `:246-247`, `docs/spec/commands.md:511`, `docs/spec/README.md:73`, `docs/cli.md`, `docs/learn/commands/pin.md:34`, `docs/rules/exact-versions.md:155,171`, `docs/guide.md:213`, `rfcs/0010-remediation-conformance/rfc.md:93`, the `remediation:` prose at `exact-versions.js:374`, the probe's two dialect sentences (`:216-227`, `:338`), RFC 0042 with its registry row and the `0007` amendment row, `docs/decisions.md` I-96 — and **decision rows I-20 (`:64`), I-39 (`:83`), I-83 (`:128`)**, which print the old bytes; the later row supersedes them by name, never by silent edit.

**Ordering trap, measured:** `tests/rules/exact-versions.test.js:1631-1632` asserts that `docs/rules/exact-versions.md` contains the old bytes. The docs-only pull request is red unless that assertion moves in the same commit, so it belongs to T4, not T3.

## Log

- L1 (owner, verbatim): «decide tú y que respete lo mas posible nuestra filosofia, crea el issue y su pr, mergea las anteriores. Apoyate de jueces».
- L2 (field round, verbatim): «cmd pasa las comillas simples literales a pnpm».
- L3-L6 (three judged plans, refuted): `odd/tasks/command-dialect.md` L5/L6 carry the first two; the third's verdicts are quoted below.
- L7 (judge B, third round, verbatim): "a worker following the plan verbatim edits the wrong rule, works to an undefined test scope (F9), and implements a cmd-leg check that has no CI leg to run on."
- L8 (judge A, third round, verbatim): "S2 ships a spelling that pnpm rejects for legal digit-leading names (`0x`, `7zip-bin`) on all four shell families, and neither the plan's predicate nor its new check can see it." Its other findings — the `&;^` correction, the `execSync` spawn shape, the R5/R2 error, the docs-test ordering trap — are folded into S3, S5 and T4 above.
