# The command speaks both shells

Issue #548: a printed command carries POSIX-only quoting, so `cmd` fails on it with a pnpm error that looks like the reader's mistake. The fix is the command, not an explanation: two measured spellings are read identically by `cmd`, `bash` and `sh`. This record supersedes `odd/tasks/command-dialect.md`, withdrawn at L5/L6 of that file.

## Specs

- **S1 — one spelling, every shell.** Every command the tool prints is written so `cmd`, `bash` and `sh` deliver the same argv: no single-quoted segment anywhere, an argument that needs quoting is double-quoted, and an embedded double quote is written `\"`. Measured twice independently: `"dependencies[\"is-odd\"]=3.0.1"` reaches pnpm as `dependencies["is-odd"]=3.0.1` on all three, and pnpm 12.3.4 writes the manifest from `cmd` and from `bash`.
- **S2 — the two places that quote, and no others.** `pinCommand` (`src/rules/exact-versions.js:248-251`) and `pnpmAt` (`:222-227`) are the only emitters that quote. The bracket form stays — the dotted path is refuted for scoped names — and only its quoting changes. `-C "<dir>"` when the directory carries a space or a quote, `-C <dir>` otherwise, so every directory that needs no quoting prints today's bytes.
- **S3 — no detector, no note.** Because the command works, nothing explains it: no new label, no note line, no `next`-block tail, and nothing added to the numbered plan, which never carries a quoted segment (measured by both judges; `pnpmDirFlag` does not quote). `frozenRoute`'s hand-edit prose keeps its quotes, because it is prose and no longer implies a dialect.
- **S4 — the document changes value, not shape.** `remediation.command` keeps its place and its meaning; the bytes change for `exact-versions`; the goldens are regenerated and the diff must contain nothing but those command strings. No key is added, removed or renamed, and the JSON schema version does not move.
- **S5 — the claim becomes a check.** A test asserts that every command `exact-versions` emits carries no `'`, for a scoped name, an unscoped name, a root importer and a spaced directory; `scripts/probe-remediation.js` runs the printed command end to end, so the manifest it writes is the evidence rather than the string's shape.

## Tasks

- T1 (S1, S2) — the two functions: double quotes, `\"` for an embedded double quote, `-C` quoted only when the directory needs it. Route: worker.
- T2 (S5) — the assertions: no `'` in any emitted command across the four cases, and the probe end to end.
- T3 (S4) — regenerate the goldens and prove the diff is only the command strings; the suite stays green on Windows and Ubuntu.
- T4 (S1) — the spec first: the §10.3 rendering rule gains the sentence, RFC 0042 records the decision, its registry row and amendment row follow, `docs/cli.md` and `I-96` move with it. Route: parent.

## Log

- L1 (owner, verbatim): «decide tú y que respete lo mas posible nuestra filosofia, crea el issue y su pr, mergea las anteriores. Apoyate de jueces».
- L2 (field round 2, verbatim): «El exit 1 de cmd es del comando, no sintaxis (no 255/2): cmd pasa las comillas simples literales a pnpm. El render de #540 queda fuera de eso.»
- L3 (v1's premise, now refuted): "no spelling of that argument is read by both shells". Two independent judges and one parent measurement contradict it; L5/L6 of the withdrawn record carry the evidence.
- L4 (parent, this plan): the repair is the command's quoting, because a command that works needs no note, no new label and no second surface — and the note was unactionable on the Windows that has no bash.
