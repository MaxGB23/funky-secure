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

L7 — The first push of PR B failed CI on all four legs, on a test that skips locally: `--install refuses a symbolic link destination` needs a symlink, this Windows session has no Developer Mode (`EPERM`), so the privacy of my green run was a skipped test, not a passing one. The change was correct in substance and incomplete in coverage: two more refusals live in `skill` (the symbolic link, and the downgrade refused without `--force`), and neither carried the new code. Both now throw `RefusalError`, and the two expectations moved from 2 to 3. Lesson recorded because it is structural: a contract change must be swept across every refusal, and a suite that skips on the developer's platform cannot be the sweep. Verified structurally instead — both branches throw `RefusalError`, and the `RefusalError` → 3 mapping is pinned by tests that do run locally.

L8 — The same push also exposed a sequencing defect of mine: `gh pr checks --watch` failed, the `&&` short-circuited the merge, and the `;` after it let the branch deletion and the local branch removal run anyway, closing the pull request. Recovered from the reflog (`git checkout -b fix/refusal-honesty 5cd7275`) and re-pushed. A chain that deletes something must not be reachable after a failure.

L9 — T3 done, PR C. RED first: the new test pins the four steps and both inequalities (`init --apply` before `pnpm install` before `migrate`), and the test that encoded the old order was deleted rather than edited, because it asserted the defect. The rationale in the code changed with the order: a migration does not lead because two lockfiles resolve two trees, it follows the install because the install is what writes the lockfile it keeps. Verified end to end in a scratch npm repository: `start` prints the four steps, `init --apply` writes `pnpm-workspace.yaml` with `minimumReleaseAgeStrict: true` and `savePrefix: ''`, and `migrate --apply` then refuses only for the lockfile that install has yet to create. Record 0009, I-41, one amendment row for 11.7, and `docs/spec/commands.md`, `docs/cli.md`, `docs/guide.md` renumbered. 424 tests, 423 pass, 1 skipped; self-scan exit 0.

L10 — T4 done: the five verified frictions, re-run in a Next-shaped repository (`next`, `react`, `@types/node`, `@tailwindcss/postcss`, `typescript`, a two-section lockfile and `package-lock.json`). F1: `start` prints `init --apply`, `pnpm install`, `migrate --apply`, `scan --preset starter`. F2: `migrate --apply` on `main` exits **3** with the action first. F4: the emitted commands are bracketed for scoped and unscoped names alike. F5: `verdict  FAIL (threshold: error · 6 rules not verified)` — and the count is exact, checked against the JSON: six `skip` findings, and the grouping below it is 2 + 3 + 1, which my first `head -3` had truncated. F6: `explain quarantine` names `pnpm-workspace.yaml` and says `.npmrc` is where tokens stay. F3 stays blocked on the field lockfile.

L11 — Close-out: 0.6.0. A new exit code, a new step order and a changed remediation command are all observable behaviour, so the number moves; the goldens move only in `tool.version`.

L12 — T7: the conformance sweep. Twelve fixtures, one per rule, each failing it; the remediation read from the JSON report; the command executed verbatim; the repository re-scanned. Three of twelve could not be taken, and all three in the same direction.

L13 — `lockfile-committed` printed `git add pnpm-lock.yaml` for a lockfile that was untracked **and** ignored — the state of a repository that just added it to `.gitignore`, which is why the rule fires hardest. git exits 1: "The following paths are ignored". The `lockfile-ignored` branch only fires once the file is tracked, so the pair had no route at all. Now `git add -f pnpm-lock.yaml` plus a message that names the ignore rule.

L14 — `actions-pinned-sha` printed `uses: owner/repo@<sha> # vX.Y.Z` while the finding carried `actions/checkout@v4.1.7`: the template discarded both facts it had. Now `uses: actions/checkout@<sha> # v4.1.7`, and `uses: docker://node@sha256:<64 hex> # 24-alpine`. First attempt used `split(':')[0]` and produced `docker` — caught by running it, not by the test, and the test was extended with the docker shape.

L15 — `start` printed `init --apply` as step 1, and that command refuses to write over an uncommitted tree — the state of every freshly generated project. The canonical first-run path could not be completed by running its own steps. The guard stays (it is a safety property); the commit becomes step 3 in the spec table and the first step in practice. `start` runs the same probe `applyPlan` runs, over the same paths, so it cannot promise a step the next command refuses.

L16 — The test double for git answered "clean" always, which is how the break reached the binary without a red test. It now runs the real `git status` over the fixture, so the fixture's own state drives the answer. Verified end to end with the real CLI: `start` prints the commit, the commit runs, `init --apply` writes three items, and a second `start` on the clean tree drops the step.

L17 — Close-out: 0.6.1. Two changed remediation commands and one added step are observable, so the number moves as a patch; the goldens move in the version field and in the `actions-pinned-sha` command, and the captures in `docs/cli.md` were re-run.
