# Adversarial round — what a tester trying to break the tool found

Source: one `funky-lakra` session, 2026-10-30, eighty commands over nineteen hand-built directories under `M:/pruebas/adversarial/`. Its brief was to break the tool, not to use it. Triage of every claim is in this document; a claim is a hypothesis until it is reproduced against the code.

## Specs

S1. A JSON value the tool cannot interpret is never treated as absent. `init --apply` refuses (exit `3`, nothing written) when `packageManager` exists and is not a string, instead of rewriting it.
  Example verbatim from the report: `"packageManager":{"name":"pnpm","version":"10.0.0"}` becomes `"packageManager": "pnpm@12.3.4"`, exit 0. That is data loss.

S2. The human renderer never concatenates a label with its count. The line reads `not verified` and its count separated as every other label is.
  Observed: `not verified1 rule did not answer`.

S3. A `pnpm-workspace.yaml` entry that resolves outside the repository root is refused, not read. A `packages:` entry of `..` must not make the scan report `../package.json`.

S4. An unreadable `package.json` is not a passing repository. A file that cannot be parsed is a finding (or a failing skip the verdict names), and the message says which file and what is wrong with it — including a BOM.
  Observed: verdict `pass`, exit 0, and only `skipped: no importer package.json could be parsed`.

S5. `"packageManager": "pnpm"` without a version is its own case, and its message says so. It is never `package.json declares pnpm, so this repository is not on pnpm`.

S6. Every lockfile skip names the file it came from. `unsupported-lockfile-shape` carries `path: pnpm-lock.yaml`, so `expected "key: value" at line 3` is attached to something a reader can open.

S7. A truncated `pnpm-lock.yaml` is not a supported lockfile. The reader notices that the document ends inside a block and reports the shape it could not read, instead of accepting the subset it managed to parse.

## Tasks

| ID | Spec | Route | Commit |
|---|---|---|---|
| T1 | S2 | inline (parent) | — |
| T2 | S1 | worker, first | — |
| T3 | S3 | worker, first | — |
| T4 | S4 | worker, second | — |
| T5 | S5 | worker, second | — |
| T6 | S6 | worker, second | — |
| T7 | S7 | worker, second | — |
| T8 | all | parent: suite, self-scan, release 0.9.2 | — |

## Log

L1 (verbatim request): «arranca con todo» — the owner authorized the closing field loop: independent re-verification on the five clones, an adversarial agent, the two-rule real-code gap, the three unmeasured questions, and the three follow-ups.

L2: the adversarial report carried seven defects and no severity-1 hang or write-during-scan. Defect 1 (S1) and defect 6 (S3) are severity 1; defect 5 (S2) is trivial and visible in every human run.

L3: the three unmeasured questions were closed by measurement, not by assumption; record 0026 and `docs/validation.md` carry the result. The workspace question also produced a follow-up that is *not* part of this round: `migrate` does not tell a monorepo migrating from npm or yarn that pnpm needs `packages:` (recorded in 0026 as its own future record).
