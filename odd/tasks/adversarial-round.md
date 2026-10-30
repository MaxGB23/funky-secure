# Adversarial round — what a tester trying to break the tool found

Source: one `funky-lakra` session, 2026-10-30, eighty commands over nineteen hand-built directories under `M:/pruebas/adversarial/`. Its brief was to break the tool, not to use it. Triage of every claim is in this document; a claim is a hypothesis until it is reproduced against the code.

## Specs

S1. A JSON value the tool cannot interpret is never treated as absent. When `packageManager` exists and is not a string, `init` plans a `conflict` naming the field and the value it found, and the file is left byte-identical.
  Example verbatim from the report: `"packageManager":{"name":"pnpm","version":"10.0.0"}` becomes `"packageManager": "pnpm@12.3.4"`, exit 0. That is data loss, and the data loss is what this spec forbids.

  **Decision on the exit code (L4).** The report asked for exit `3` and nothing written. It stays at `0` with the conflict printed, because `init --apply` does write the other files in the plan: exit `3` means "understood and refused, nothing written" (10.4, 0008), and using it here would make the code lie about the writes that happened. Changing that is a contract change and belongs in its own record.

S2. The human renderer never concatenates a label with its count. The line reads `not verified` and its count separated as every other label is.
  Observed: `not verified1 rule did not answer`.

S3. A `pnpm-workspace.yaml` entry that resolves outside the repository root is refused, not read. A `packages:` entry of `..` must not make the scan report `../package.json`.

S4. An unreadable `package.json` is not a passing repository. A file that cannot be parsed is a finding (or a failing skip the verdict names), and the message says which file and what is wrong with it — including a BOM.
  Observed: verdict `pass`, exit 0, and only `skipped: no importer package.json could be parsed`.

S5. `"packageManager": "pnpm"` without a version is its own case, and its message says so. It is never `package.json declares pnpm, so this repository is not on pnpm`.

S6. Every lockfile skip names the file it came from. `unsupported-lockfile-shape` carries `path: pnpm-lock.yaml`, so `expected "key: value" at line 3` is attached to something a reader can open.

S7. A truncated `pnpm-lock.yaml` is not a supported lockfile. The reader notices that the document ends inside a block and reports the shape it could not read, instead of accepting the subset it managed to parse.

S8. A `packages:` entry refused for escaping the root is named in the report, not only collected. T3 refuses the entry and the importer disappears; an importer that disappears without a word is the same defect in a quieter form (0022, S12 of the 0.9.0 round).
  Observed after T3: the escape is gone from the output, and nothing says an entry was refused.

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
| T8 | S8 | worker, second (same files as T4 and T6) | — |
| T9 | S4-S8 | worker: the pages the new codes and the new facts make stale | — |
| T10 | all | parent: suite, self-scan, release 0.9.2 | — |

## Log

L1 (verbatim request): «arranca con todo» — the owner authorized the closing field loop: independent re-verification on the five clones, an adversarial agent, the two-rule real-code gap, the three unmeasured questions, and the three follow-ups.

L2: the adversarial report carried seven defects and no severity-1 hang or write-during-scan. Defect 1 (S1) and defect 6 (S3) are severity 1; defect 5 (S2) is trivial and visible in every human run.

L3: the three unmeasured questions were closed by measurement, not by assumption; record 0026 and `docs/validation.md` carry the result. The workspace question also produced a follow-up that is *not* part of this round: `migrate` does not tell a monorepo migrating from npm or yarn that pnpm needs `packages:` (recorded in 0026 as its own future record).

L4 (decision, T2): S1 is met at the writer — the value is never destroyed — and the exit code stays `0` with the conflict printed, because `init --apply` writes the other plan items and exit `3` promises nothing was written. The alternative (any conflicted item makes the command exit `3` and write nothing) is a contract change: it belongs to its own record, with `src/commands/init.js`, the spec and `docs/cli.md` in its surface.

L5: the worker's own review flagged that `facts.skippedGlobs` changed shape but nothing surfaces it, so T3 refuses the escaping entry silently. That is S8 added above, in T8.

L6 (release size): this round ships as one release of roughly 900 authored lines across 27 files. The reason is the one 0.9.0 recorded and this round repeats: two workers built on the same tree, and their edits interleave inside `src/rules/exact-versions.js` — a manifest skip, a lockfile skip and a workspace-entry skip end up sharing one list, so a split would produce commits that neither compile nor pass alone. Review by file group: the reader (`src/lib/lockfile.js`), the classification (`src/lib/targets.js`), the two rules, the writer, the renderer, the pages, and the release. T7's regression evidence is the number to trust: five real clones byte-identical, and 0 of 806 sampled cut points still accepted as supported.
