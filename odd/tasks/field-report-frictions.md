# Feature: field-report frictions

Six frictions from an agent that hardened a `create-next-app` project with the shipped skill. Four were
verified as real, one needed the artifact, one is a decision. Scope: the seams between what the tool
knows and what it tells the person using it — never a rule's detection.

## Specs

S1. `exact-versions` must emit a remediation that works for a scoped dependency. Verified defect: the
recorded form `pnpm pkg set 'devDependencies.@types/node=20.19.43'` fails on pnpm 12.3.4 with
`ERR_PNPM_PKG_INVALID_PROPERTY_PATH` — "Unexpected token \"@\" in property path". The bracket form
`pnpm pkg set 'devDependencies["@types/node"]=20.19.43'` writes `"20.19.43"`, and works unchanged for an
unscoped name (`devDependencies["is-number"]`), so one form covers both. The same wrong form appears in
`docs/guide.md`, `docs/rules/exact-versions.md` and decision I-20.

S2. `quarantine`'s manual remediation must not send the reader to a file `sensitive-ignored` requires
them to ignore. `pnpm config set minimum-release-age-strict true --location=project` writes `.npmrc`;
the committable route is `pnpm-workspace.yaml`, which is what `init --apply` already writes. The message
must name that route, and the tokenless-`.npmrc` exception (RFC 8.2 R7) must be visible where the
contradiction surfaces.

S3. A refusal is not "the tool could not answer". `migrate --apply` exits `2` when it refuses because
the branch is `main`, and `docs/spec/report.md` reserves `2` for bad usage, unreadable input, malformed
config and an unavailable probe: "Never used for a policy violation". Reproduced: `EXIT: 2` with
`funky-secure: switch to a feature branch and re-run migrate --apply`. A refusal is a policy decision
that wrote nothing and must be distinguishable by exit code from a crash.

S4. The verdict word must not hide unverified rules. `scan --scope repo` prints
`verdict  PASS (threshold: error)` while two rules are `not verified`, with the skip lines below it. The
exit code is right and the skip is honest; the word is not. A reader who stops at the verdict reads
"pass" as "checked".

S5. In a migration the gate must precede the first resolve. `migrate --apply` prints a human step 3
`pnpm install` and refuses to remove a foreign lockfile until `pnpm-lock.yaml` exists; the gate
(`savePrefix: ''`, `minimumReleaseAgeStrict: true`) is written by `init --apply`, which the canonical
order runs afterwards. So the first resolve happens before the policy that governs it — structurally,
and for every repository arriving from npm or yarn. Greenfield is unaffected. `start` already holds
every correct step; the order is what is wrong.

## Tasks

- T1 — S1, S2: bracket form everywhere, quarantine names `pnpm-workspace.yaml`, record 0007. Route: inline. Commit: done in PR A.
- T2 — S3, S4: refusal exit code and the verdict word, record 0008. Route: inline. Commit: PR B.
- T3 — S5: `start` runs `init --apply` before `migrate`, spec and record 0009. Route: inline. Commit: PR C.
- T4 — S1-S5 verification against a real Next project fixture. Route: inline. Commit: with its slice.

## Log

L1 (verbatim) — "tengo el veredicto de un agente usando nuestra skill de funky secure, en un proyecto inicializado de nextjs con npm, esto me dijo: …" (full report: F1 migration gate after first resolve; F2 exit 2 for a refusal; F3 `exact-versions` skip `unsupported-lockfile-shape` on a pnpm 12.3.4 lockfile; F4 `pnpm pkg set` dot form fails on scoped names and `pnpm add --save-exact` keeps the range; F5 `--scope repo` PASSes with rules not verified; F6 `.gitignore` ignores `.npmrc` while the quarantine remediation writes it).

L2 — Verification of every friction against the code, before any edit. F4 reproduced with pnpm 12.3.4 in a scratch repository, both forms. F2 reproduced: `migrate --apply` on `main` with two lockfiles exits 2. F1 confirmed by reading the plan order and `src/lib/writers.js` gate keys. F6 confirmed: `sensitive-ignored`'s candidate list includes `.npmrc`, `quarantine`'s remediation names `--location=project`. F5 confirmed: `PASS` with `2 rules not verified`. F3 not reproducible: this repository's own two-document 12.3.4 lockfile parses and `--only exact-versions` reports `1 passing · 0 skipped`; the reader already handles concatenated documents and a nested `packageManagerDependencies` under `settings`, so the cause is an unknown top-level key in that lockfile. Blocked on the artifact.

L3 — The owner authorized all of it in one instruction: "arranca con tus recomendaciones. aplica todas sin parar."

L4 — F1 design decision: no new flag and no new writer. `migrate --apply` already requires `pnpm-lock.yaml`, and `init --apply` writes the gate, so the correct order is `init --apply` → human `pnpm install` → `migrate --apply`. `start` printed the right steps in the wrong order; the fix is the order, and the spec's canonical list carries the same defect (step 3 `migrate` before step 4 `init --apply`).

L5 — T1 done, PR A. RED first: four tests failed before the change (three pins on the old dot form, one new test naming the measured `ERR_PNPM_PKG_INVALID_PROPERTY_PATH`, one on the quarantine message). GREEN after two source edits. The goldens moved one line, `tests/golden/dirty.json`, which is the same finding with the bracketed path. Verified end to end on pnpm 12.3.4 with a Next-shaped set and a lockfile recording resolutions: the scan emits four bracketed commands, running them leaves four exact specifiers, and `pnpm config set minimum-release-age-strict true --location=project` creates `pnpm-workspace.yaml` and no `.npmrc` — which is why F6 was a message defect, not a doc contradiction: the specification already said it (8.2 R4). 420 tests, 419 pass, 1 skipped; self-scan exit 0.

L6 — T2 done, PR B. RED first: three tests (two verdict shapes, one exit-code contract). The distinction is drawn per call site, not per command: `migrate --apply` refuses on the default branch (3) and cannot answer when `git rev-parse` fails (2), so the two "git did not answer" sites became `unanswered()` (ConfigError) beside `refusal()` (RefusalError). The write path only ever refuses, so `plan.js` and the symlink case of `skill --install` moved with it; `skill`'s "cannot ask, no terminal" stays 2 because there the tool genuinely could not ask. Eleven existing expectations moved from 2 to 3, each with its reason in the test. The verdict now reads `PASS (threshold: error · 2 rules not verified)` on this repository, which is the field case. 424 tests, 423 pass, 1 skipped; self-scan exit 0.
