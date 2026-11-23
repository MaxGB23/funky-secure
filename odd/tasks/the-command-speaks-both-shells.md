# The command speaks the shells it names

Issue #548. Two blind judgements refuted the previous plan and measured a matrix: no spelling serves `cmd` and `pwsh` 7 at once. This record decides which shells the command serves, names the cost, and closes the hole that let the defect reach the field.

## The matrix (measured twice, independently, plus the parent)

| spelling | cmd | bash | sh | pwsh 7 | WinPS 5.1 |
|---|---|---|---|---|---|
| `'dependencies["x"]=1'` (today) | fails | ok | ok | ok | fails at `&&` |
| `"dependencies[\"x\"]=1"` | ok | ok | ok | splits (2 args) | fails at `&&` |
| `dependencies.x=1` (no quotes) | ok | ok | ok | ok | fails at `&&` |

`WinPS 5.1` fails on `&&` before any quoting, so it is out of scope for every spelling. The unquoted bracketed path is rejected by pnpm (`Unexpected identifier`), and `pnpm add --save-exact` writes `^3.0.1`, not `3.0.1` (measured on pnpm 12.3.4). So the fork is real and belongs to the product.

## Specs

- **S1 — the shell set is named with its cost.** The commands are written for `cmd`, `bash` and `sh`. `pwsh` 7 splits the escaped scoped form into two arguments, and `WinPS` 5.1 rejects `&&`; the spec says both, because a promise that hides a measured gap is the defect this issue is about.
- **S2 — the shortest spelling the named shells read.** An unscoped dependency pins with the quote-free dotted path (`pnpm pkg set dependencies.is-odd=3.0.1 && pnpm install`), the only form that also survives `pwsh` 7. A scoped one pins with the bracketed path double-quoted and its inner quotes escaped (`pnpm pkg set "dependencies[\"@types/node\"]=20.11.5" && pnpm install`). Both reach pnpm as one argument on `cmd`, `bash` and `sh` — measured.
- **S3 — `-C` quotes when the directory needs it, and the limit is named.** Double quotes when the directory carries a space or a quote; today's bytes otherwise. A directory carrying `&`, `;`, `^` or `%` is beyond one line on `cmd` — `%VAR%` expands even inside double quotes, `&` splits the line — so the record says so instead of pretending the quoting covers it. `pnpmDirFlag` emits only `..`-chains (verified), so no plan step needs quoting.
- **S4 — the document changes value, not shape.** The goldens regenerate; the diff is the command strings and the test literals, nothing else. No key moves and `schemaVersion` stays.
- **S5 — the check can fail on the regression it is about.** `scripts/probe-remediation.js` runs the printed command under the shell of the platform leg (`sh` on Linux, `cmd` on Windows) instead of a fixed `sh`, which is why #548 escaped CI: every printed command was executed by the one shell where the defect never existed. The invariant — no command whose first token is `pnpm|git|corepack` carries `'` — is asserted over every golden and over `pinCommand`'s shapes; prose (`frozenRoute`, `uses:`, `add "permissions:"`) is excluded by the first-token rule, never by a special case.

## Tasks

- T1 (S1, S2, S3) — `pinCommand` (`src/rules/exact-versions.js:247-251`) and `pnpmAt` (`:222-227`). Route: worker.
- T2 (S5) — the probe's shell, the invariant, and the shapes it must cover. Route: worker.
- T3 (S4) — regenerate the goldens; prove the diff is the command strings plus the test literals named in F9. Route: worker.
- T4 (S1) — the spec first, in its own pull request: `docs/spec/rules.md` §8.2 R2 (which prints the old bytes), §10.3's rendering rule, RFC 0042, its registry row, the amendment rows (`0007`, and the §10 row if the rendering sentence moves), `docs/cli.md`, `docs/rules/exact-versions.md`, `docs/guide.md`, the `limits` prose at `exact-versions.js:374`, the probe's two false sentences (`:216-227`, `:338`), and `I-96`. Route: parent.

## Log

- L1 (owner, verbatim): «decide tú y que respete lo mas posible nuestra filosofia, crea el issue y su pr, mergea las anteriores. Apoyate de jueces».
- L2 (field round, verbatim): «cmd pasa las comillas simples literales a pnpm».
- L3 (judge A on the superseded plan, verbatim): "the plan repairs `cmd` by breaking `pwsh` 7, which works today … while S1's three-shell scope and S5's no-`'` check make the regression invisible."
- L4 (judge B on the superseded plan, verbatim): "`pnpmAt` quotes `-C` only on space/quote, so a legal directory `packages/a&b` prints bare and splits on every shell".
- L5 (parent, measured): the dotted path is accepted for unscoped names; the unquoted bracketed path is rejected; `pnpm add --save-exact` writes `^3.0.1`. Each closes an escape from the fork.
- L6 (parent, decision): serve `cmd`, `bash`, `sh`; unscoped names take the quote-free path, scoped take the escaped form; `pwsh` 7 and `WinPS` 5.1 are named in the spec with the mechanism, because the cost is measured and hiding it is the defect being fixed.
