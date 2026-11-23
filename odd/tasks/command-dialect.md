# The command dialect

The report states where a command runs (#540) and never what reads it. One printed command carries POSIX quoting, and `cmd` fails on it with a pnpm error that looks like the reader's mistake. Issue #548.

## Specs

- **S1 — the note appears when the condition holds, and only then.** Whenever the human report prints at least one command that contains a single-quoted segment, it prints one `note` line naming the shell it writes for. A report whose commands carry no single quotes prints exactly today's bytes. The condition is a property of the printed string, never of the platform: the same state prints the same bytes on `cmd`, on bash and on CI.
- **S2 — one rule, both surfaces.** The document shape (`scan`, `init`) adds the note once after the `next` block; the numbered plan (`start`, `migrate`) adds the same line, same gutter, once after its steps. The field round found the defect in the report and the same quoting reaches the plan through `pnpmAt` (`src/lib/foreign-pin.js`/`exact-versions.js`), so a rule left on one surface is the two-rules mistake #540 already paid for.
- **S3 — the note is prose, not a command.** It keeps the 96-column ceiling that governs every line which is not a command, and it is not prefixed with a directory: it states a fact about the commands above it.
- **S4 — the JSON does not move a byte, and `explain` does not gain a line.** The dialect is presentation; the document keeps `remediation.command` exactly as it is (`docs/spec/report.md` §10.1).
- **S5 — the text says the thing that failed, and says what to do.** Measured: `cmd` passes `'…'` literally, so pnpm receives the quotes inside the property path and reports `ERR_PNPM_PKG_INVALID_PROPERTY_PATH`; bash reads them. The note names the shell and the remedy, and it fits the ceiling.

## Tasks

- T1 (S1, S3, S5) — the helper and the report surface: detect a single-quoted segment in a printed command, print one note line after `next`. Route: worker. Commit on `fix/548-command-dialect`.
- T2 (S2) — the plan surface: the same line after the numbered steps of `start`, `migrate` and `init`. Route: worker.
- T3 (S4) — tests: the note present with the `exact-versions` command and absent without it, one line, ≤96, the plan's copy, the JSON unchanged, `explain` unchanged.
- T4 (S1-S5) — the spec first: §10.3's rendering rule gains the sentence, RFC 0042 records the decision, the registry and amendment rows follow, `docs/cli.md` and `I-96` move with it. Route: parent. Commit on `docs/548-command-dialect`, before any code.

## Log

- L1 (owner, verbatim): «decide tú y que respete lo mas posible nuestra filosofia, crea el issue y su pr, mergea las anteriores. Apoyate de jueces».
- L2 (field round 2, verbatim): «El exit 1 de cmd es del comando, no sintaxis (no 255/2): cmd pasa las comillas simples literales a pnpm. El render de #540 queda fuera de eso.»
- L3 (measured, `src/rules/exact-versions.js:225-241`): `pnpm add --save-exact <name>@<range>` is a no-op on pnpm 12.3.4; the dotted property path fails on scoped names; so `pnpm pkg set '<type>["<name>"]=<version>' && pnpm install` is the only command that pins the range, and its quoting is POSIX-only.
- L4 (parent, this plan): the decision to state the dialect rather than change the command, because no spelling of the argument is read by both shells; and to cover both surfaces, because the same quoting reaches the plan.
- **L5 — the premise is refuted by measurement (judge A, 2026-11-23).** `pnpm pkg set "dependencies[\"is-odd\"]=3.0.1"`
  is read identically by `cmd`, `bash` and `sh` — argv `dependencies["is-odd"]=3.0.1` — and clears the
  finding on pnpm 12.3.4 end to end, including inside the full `(cd "<root>" && …)` shape. The dotted
  path `dependencies.is-odd=3.0.1` is quote-free for unscoped names. A judge also found the plan's own
  second surface unreachable: no numbered step carries a single-quoted segment (`pnpmDirFlag` does not
  quote), so T2 specified behaviour that can never print.
- **L6 — corroborated, with more surface (judge B, 2026-11-23; reproduced here).** The same argv
  convergence, measured independently. The single-quoted spelling delivers `'dependencies[is-odd]=3.0.1'`
  on `cmd` — it keeps the quotes **and** eats the inner doubles — while bash reads it correctly, so the
  divergence is confirmed. Also measured: `pwsh` 7 runs today's command correctly and Windows PowerShell
  5.1 mangles it, so "POSIX-only" was wrong in both directions. The detector would have fired on
  `frozenRoute`'s hand-edit prose (`exact-versions.js:269-275`), and the wrapper diverges on exotic roots
  with no quote in sight.
- **Withdrawn.** The plan prescribed explaining a defect that two measured spellings repair. Its successor
  is `odd/tasks/the-command-speaks-both-shells.md`; nothing above is rewritten, and L5/L6 are the evidence.
