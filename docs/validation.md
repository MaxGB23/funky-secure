# What has been verified, and how

Every row names the check that would fail if the claim stopped being true. A claim with no command
behind it is not on this page.

Scope: the tree at the time of writing. The version is deliberately omitted — a table that carries a
number becomes wrong at the next release, and the suite itself is the authority for it.

## The suite

| Claim | How | Where |
|---|---|---|
The suite passes, exit 0; one Windows symlink case is skipped | `node --test` | the whole tree |
The repository passes its own audit | `node bin/funky-secure.js scan --scope repo --fail-on warn`, exit 0 | CI |
Every documented flag is accepted by the command the document names | `tests/docs-contract.test.js` | documentation contract |
The spec stays a true slice of the record, and every amendment names a shipped record | `tests/drift.test.js` | the drift gate |
A rule cannot be added without a page and without a spec section | `tests/docs-contract.test.js` | catalogue |
The pack we would publish installs and runs | `node scripts/pack-smoke.js` — packs, installs the tarball into an empty directory, asks the installed binary for its version and runs a report | `prepublishOnly`, and the `runtime-claims` job in CI |

## Read-only: nothing is written by a scan

| Claim | How | Where |
|---|---|---|
`scan` leaves the working tree byte-identical | `git status --porcelain` before and after, plus a hash manifest | `tests/read-only.test.js`, and five real clones |
The same holds for `--scope all`, `--scope machine`, `--scope repo` and `start` | same test, one case per command | `tests/read-only.test.js` |
`init`, `pin` and `migrate` write only through `validateWriteTarget`, only to the paths their plan printed | unit tests over the writers plus the plan digest | `tests/writers.test.js`, `tests/init.test.js`, `tests/pin.test.js` |

Five real repositories were cloned and scanned with nothing from them executed: `yarnpkg/berry` (3 825
files), `t3-oss/create-t3-app` (544), `vercel/nextjs-subscription-payments`, `primefaces/primevue`
(4 837), `shadcn-ui/ui` (6 411). Every one ended with an empty `git status` and identical file hashes.

## Determinism and scale

| Claim | How | Where |
|---|---|---|
The same repository produces the same findings twice | two runs, comparing rule, status, path, line and message | `shadcn-ui/ui`, 6 411 files |
A large repository is usable | 6 411 files in 0.38 s, 79 MB peak RSS (three runs) | measured, well under any bar |
Output is stable byte for byte where it matters | golden reports regenerated only by an intended change | `tests/golden/` |

## The rules, exercised against real code

| Rule | What was verified on real repositories |
|---|---|
`package-manager-pin` | A declared `pnpm@10.33.4` (`shadcn-ui/ui`) and `pnpm@9.6.0` (`primevue`) pass while the machine answers 12.3.4, and no plan rewrites them; `yarn@4.2.1` (`berry`) is `skip not-pnpm`; a repository declaring nothing (`vercel/…`) still fails with `pin-missing` |
`lockfile-committed` | `vercel/…` (pnpm 8 shape) and `t3` (pnpm 9) pass; `berry` (yarn only) fails, correctly — and the message no longer claims a berry repository is unreproducible |
`foreign-lockfile` | `primevue` warns on a tracked `package-lock.json` next to `pnpm-lock.yaml`; `berry` warns on `yarn.lock` |
`quarantine` | `shadcn-ui/ui` declares `minimumReleaseAge: 2880` and passes — `pnpm config list --json` answers `2880` and no strict flag, so the explicit age makes the strictness default `true`. `t3` declares no `minimumReleaseAge` at all: its `pnpm-workspace.yaml` carries `packages:` and `onlyBuiltDependencies:` and nothing else, so the effective value there is inherited and belongs to the machine, not to `t3`'s bytes — on this host `pnpm config list --json` answers `4320` in that clone and the rule counts a `pass` from it. The `1440` this row used to attribute to `t3` is the baseline floor the managed block declares: in a fixture whose block `init --apply` wrote, `pnpm config get minimum-release-age` answers `1440` and `minimum-release-age-strict` answers `true` |
`exact-versions` | 206 floating ranges located line by line in `shadcn-ui/ui` with 0 mismatches and 0 desyncs over 245 specifiers across 7 importers; 68 findings on `primevue` after the catalogue is resolved (13 false positives gone); 80 of its 96 findings carry `pnpm -C <dir>` in `t3`; 26 specifiers pinnable on the pnpm 8 shape in `vercel/…` |
`sensitive-ignored` | True positives on `primevue` and `shadcn-ui/ui` (`git check-ignore --no-index` confirms the paths are not ignored), and a tracked tokenless `.npmrc` correctly exempt |
`env-not-tracked` | `.env.local.example` in `vercel/…` is a template and not a finding; a tracked `.env` still is |
`actions-pinned-sha` | 56 unpinned actions in `berry` (36 files), 64 in `shadcn-ui/ui` — all of them in its eleven workflow files, because that repository carries no `.github/actions/` directory at all — and 24 in `t3`, of which 2 are inside `.github/actions/setup/action.yml`, the composite action four of its seven workflows call as `./.github/actions/setup` (`ci`, `e2e`, `prerelease`, `release`). Measured with `scan --scope repo --only actions-pinned-sha --format json` in each clone; in `t3` the other 22 span its seven workflows |
`no-bot-auto-merge` | 2 findings in `berry`; passes on `shadcn-ui/ui`, whose kodiak requires a label |
`ci-no-safety-overrides` | Detects `--no-frozen-lockfile` in `ts-safeql/safeql` `.github/workflows/ci.yml:49` (`ci-frozen-lockfile-disabled`, with the command in `evidence`); passes on `shadcn-ui/ui` and `t3` (`--frozen-lockfile` and nothing worse) |
`pull-request-target` | Detects a genuine pwn request in `cloud-bulldozer/benchmark-operator` `.github/workflows/e2e.yml:33` — the step checks out `github.event.pull_request.head.sha` and later steps consume real secrets (`pull-request-target-checkout`); passes on `t3` and `shadcn-ui/ui`, whose three `pull_request_target` workflows — two in `t3`, one in `shadcn-ui/ui` — never check out the head |
`workflow-permissions` | 32 findings in `berry` — the rule that produced no signal at all before the indentless-sequence fix — and 4 in `shadcn-ui/ui`, each naming the jobs that inherit the default |
`workflow-run-artifact` | the rule runs against three of the repositories' own workflow bytes, vendored in `tests/fixtures/workflows/real/` (each elided producer says so at the top of its file, with its blob and the date it was read): `node --test tests/rules/workflow-run-artifact.test.js` asserts one `fail` per pair — `pnpm/pnpm`'s `pacquet-integrated-benchmark{,-comment}.yml`, `nodejs/node`'s `nix-changes{,-comment}.yml`, and `vercel/next.js`'s `upload_preview_tarballs.yml` against `build_and_deploy.yml` — at the step that downloads, with each consumer's write scopes named in the message, and a repository declaring no `workflow_run` as `pass / no-workflow-run`. Issue #153's own two files remain the fixture the rule's tests start from. The four-repository field measurement this row used to report — the clone counts, the `id-token: write` threshold change and the unparseable `contributor-guidance.yml` (#266) — has no clone on disk and is in *Not verified — deliberately, and why* below |

The reader learned one spelling in the batch and every count above stayed where it was: a `pull_request_target`
workflow that names the head in the flow map `with: { ref: … }` now answers `fail pull-request-target-checkout`
on the step's first line, exactly as the block map does, and a `with:` flow map that does not close on its
own line answers `skip / unparseable-workflow` where it used to be a pass (#405). Neither that change nor the
message changes moved a count in the five clones: `scan --scope repo --format json` in each answers an identical
`summary` and identical per-rule, per-code counts at `e923280` and at `33c105a`.

## The side each rule was measured from

This section used to carry two rows — `exact-versions` and `quarantine` — each measured from one side only. Both
have since gained the other, so both left the table: `quarantine` fails in a fixture whose own
`pnpm-workspace.yaml` sets `minimumReleaseAgeStrict: false`, because `pnpm config list --json` runs with the
invocation directory as its `cwd` — and that declaration is also why its finding is `manual` there: the same key
outside the managed block makes `init --apply` plan a `conflict`, so the printed route is the hand edit, and
setting the key clears the finding on the rescan (#361) — while `exact-versions` passes in a repository whose
specifiers are all exact. `exact-versions` has a second hand-edit shape: a repository whose `pnpm-workspace.yaml`
declares `frozenLockfile: true`, where pinning the manifest and then installing exits 1
`ERR_PNPM_OUTDATED_LOCKFILE` on pnpm 12.3.4 and the finding prints the manifest edit with the lockfile moved in
one change instead (#373). `CI=true` is not read: the same floating range with `CI=true` and no declared freeze
still prints the ordinary `pnpm pkg set … && pnpm install`.
The runs are in the rule loop below. The table is empty now, and the paragraph that introduced it — a row that
gains the other side leaves this table — is the reason it can be.

## Behaviour that was measured rather than assumed

| Claim | How |
|---|---|
| `foreign-lockfile` passes on a repository with `pnpm-lock.yaml` and no foreign lockfile | eight of the ten repositories at `M:/pruebas/real`, e.g. `shadcn-ui-ui` and `t3-create-t3-app`: `scan --scope repo --format json` emits no finding for the rule and counts it in `summary.pass`. `catalogs-primefaces-primevue` and `yarnpkg-berry` fail it, which is the side this page already had |
| `actions-pinned-sha` passes on a repository whose every action is pinned to a full SHA | `M:/funky-secure-v2` — eleven `uses:`, all 40 hex, zero tag refs — and `catalogs-primefaces-primevue` and `vercel-subscriptions` among the ten. Measured with `scan --only actions-pinned-sha,foreign-lockfile --format json`, which answers `summary.pass` for both |
| `workflow-permissions` passes on a repository whose workflows all declare permissions | `repro-steps-indent` among the ten: no finding for the rule, while the `skip`s it does emit belong to other rules. Six of the ten fail it, so both sides are now measured |
| `pnpm import` reads a foreign `package-lock` v3 offline, in 39 ms, keeping the recorded version | measured in a scratch directory |
| `pnpm import` over an existing `pnpm-lock.yaml` replaces what it records with the foreign pins | scratch directory, offline: a lockfile recording `lodash@4.17.21` beside a `package-lock.json` pinning `4.17.20` ends at `4.17.20`, exit 0. It neither refuses the existing lockfile nor merges the two. The first import was measured long before this one; the second is what makes a printed step safe to follow twice |
| `minimumReleaseAge` defaults to 0 on pnpm 10.16 and to 1440 from pnpm 11 | measured against both |
| `minimumReleaseAgeStrict` defaults to true only when an age is explicit | pnpm issue #14409, and measured |
| `pnpm --version` rewrites a lockfile when the repository declares `packageManager` | isolated four ways before the probe was moved out of the repository |
| `pnpm --version` answers the declared version **inside** the project | measured on `shadcn-ui/ui` (10.33.4 inside, 12.3.4 on the PATH) |
| `init --apply` is idempotent on a real workspace | `t3`: block appended after `onlyBuiltDependencies`, `packages:` untouched, `yaml@2.9.0` parses it, second run `nothing to apply`, bytes identical |
| `pnpm import` reads a **berry** `yarn.lock` offline and keeps the pin | pnpm 12.3.4, a `__metadata: version: 8` lockfile, `lodash` `4.17.21`: 23 ms, and the new `pnpm-lock.yaml` records `lodash@4.17.21` |
| `permissions: contents: read` really produces a 403 | the `runtime-claims` job on `ubuntu-24.04`: the probe attempts a write that cannot succeed even with `contents: write`, is answered 403 with the integration denial, and reads the path back absent — on a `push` to `main` and on a pull request from a branch of this repository. A pull request from a fork is not measured, because the platform imposes a read-only token there; the job prints why. That a third-party workflow the rules call correct really runs green, and that its bytes stay out of a write scope, are still read statically |
| The packed artifact installs into a directory that holds nothing else, and answers | `npm pack` at the commit under test, on `ubuntu-24.04`, installed into a directory that holds nothing but the tarball, then asked for its version and a report (`scripts/pack-smoke.js`). The runner checks this repository out first, so the empty thing is the install directory and not the machine. A registry install through a mirror, and the staged tarball's own identity, stay outside this claim |
| The remediation commands change a repository the way their text says | the four shapes the catalogue printed when this row was first written — the resolve step, that step with `--pm-on-fail=ignore` for a repository declaring a foreign `packageManager`, the root pin, and the importer pin carrying `-C <dir>` — run in throwaway directories on `ubuntu-24.04`, judged by the importer record the resolve step writes (the dependency, with a version beside it, read through the same lockfile reader the rules use) and by the field the pin sets; a fixture with nothing declared writes a lockfile whose root importer is `{}`, which is why the file appearing is not the claim. The shapes the defect batch added are measured the same way, in fixtures under the OS temp directory here: `pnpm import && funky-secure migrate --from npm --apply` — the sequence `foreign-lockfile` prints while `pnpm-lock.yaml` is absent (#359) — on a committed feature branch exits 0, removes `package-lock.json`, keeps the imported version and leaves the rescan `pass`, while a coexisting lockfile prints the migrate alone; a `workspace:` range is pinned to `workspace:*` and pnpm 12.3.4 records `specifier: workspace:*` beside `version: link:../lib`, so the symlink the path would have replaced survives (#368); a repository declaring `frozenLockfile: true` clears with the printed hand edit when the lockfile moves in the same change, and both `pnpm install` forms answer exit 1 `ERR_PNPM_OUTDATED_LOCKFILE` without it (#373). Effect only: which version the record names is pnpm's business, and a consumer's monorepo is not exercised |
| pnpm **ignores `workspaces` in `package.json`**, and an empty `pnpm-workspace.yaml` changes nothing | four trees: no block, empty block, managed keys only — one importer each; only `packages:` produces three importers and the `workspace:^` link. So creating the file never degrades a workspace pnpm already had, and it never transfers an npm or yarn one either |
| pnpm 10 reads the block | pnpm 10.16.1 and 12.3.4 both answer `1440`, `4320` and `~` from `pnpm-workspace.yaml`, and `undefined` outside it; `ignoreScripts` answers `true` |
| `devEngines.packageManager` is a guard npm enforces and `packageManager` is not | npm 11.13.0 exits 1 `EBADDEVENGINES` before the install and writes no `package-lock.json`; `--force` downgrades it to a warning and writes one; a machine-level `pmOnFail` overrides it on pnpm's side. The guard is a deterrent, not a wall: a forced install lands the repository in R3's coexistence case, which is `error`, so the audit still answers with the bytes on disk rather than with a promise about the installer | `rfcs/0030-the-guard-both-managers-read/evidence/onfail-and-autoswitch.md`, re-measured on npm 11.13.0 |
| The `onFail` value is not a free choice | with `onFail: "error"` pnpm 11.28.10 refuses to re-execute as the pinned 12.3.4 and exits 1, while the same manifest with no `onFail` — and with no `devEngines` at all — exits 0 having switched; npm's default is already `error`, and `warn` makes it write the lockfile | same evidence file |
| The manifest writer loses nothing it was not asked to change, and withholds what it must | seven manifest shapes compared item by item against `git archive e923280`, each plan read through `init --format json` and each write through `init --apply` in a fixture under the OS temp directory. Four of them declare no guard the writer compares — no declarations, `devEngines.runtime`, tabs, and a `devEngines` that is a string — and both commits answer them identically in state and digest: on the no-declaration shape both the pin and the guard are `would-write` (`95c453…` and `08b4f0…`) and `init --apply` writes both, moving `package.json` from `1ce0e31c…` to `08b4f043…`; on the `devEngines`-that-is-a-string shape the pin is `would-write` and the guard the `conflict` it already was, at both commits. A declared `devEngines.packageManager` is where #353 acts, and it acts on the two forms the writer will not overwrite — not on both shapes that declare one. Where the guard **agrees** — a manifest whose `devEngines.packageManager` names pnpm `12.3.4`, the version the machine answers — nothing changed: the pin is `would-write` with digest `2c5547ff…`, the guard is `would-skip` with the reason `package.json already declares devEngines.packageManager "pnpm@12.3.4"`, and `init --apply` writes `"packageManager": "pnpm@12.3.4"` beside it, so `sha256` moves `a000a4ad…` → `2c5547ff…` at both commits. Where the guard **differs** (`9.6.0`) the pin is withheld: both items are `conflict` with no digest, `init --apply` writes no bytes to `package.json` — `sha256` `90a4ffee…` before and after — and the managed block still lands, where `e923280` still planned `set packageManager` `would-write` with digest `280615f2…`; a `devEngines.packageManager` that is a string is on that same changed side (`would-write` `fd5fb47f…` at `e923280`, `conflict` now). The 28-shape list this row used to cite was never committed; this is a fresh differential, not a re-run of it | differential against `git archive e923280`, fixtures in the OS temp directory, not committed |
| The guard is read before the machine, and compared by name and by version | four combinations of pin and `devEngines.packageManager` on the wire, before and after: a guard naming another version answered `pass` while the pin equalled the machine, and a pin naming another manager answered `self-managed-pin` with the sentence "declares npm@11.13.0 and manages its own pnpm". After: `skip` / `self-managed-pin` and `skip` / `not-pnpm`, and a repository with an agreeing guard still passes | `tests/rules/package-manager-pin.test.js`, plus a differential over 5 manifests against `git archive` |
| pnpm's escape from a foreign `packageManager` is `--pm-on-fail=ignore`, and no other flag does it | pnpm 12.3.4: `pnpm config get package-manager-strict` answers `undefined`; `--config.package-manager-strict=false`, an `.npmrc` key, `npm_config_…` and `COREPACK_ENABLE_STRICT=0` all leave `ERR_PNPM_OTHER_PM_EXPECTED` (exit 1). `--pm-on-fail=ignore` makes `import`, `install --lockfile-only` and `add` exit 0 and write the lockfile | measured, then confirmed in the field in a `create-t3-app` repository |
| The path prints no prediction about a workspace it is about to create | on an ancestor-workspace shape `start` prints no workspace line and its six steps are byte-identical to the no-ancestor shape; a project at `apps/demo` under an enclosing workspace, followed literally, wrote its lockfile **in the project**, scanned `PASS` with `REPO-ROOT all 5 rules pass`, and ended with `git status --porcelain` empty | `tests/start.test.js`, and a demonstration outside the repository in round 3 |
| The writers' next steps and the path print one commit, from one constant | `init`'s block equals `commitWritesStep(writtenPaths(plan))` for the same plan — `package.json` included, no bare `git add` — and the literal `chore: apply funky-secure` lives in one module | `tests/init.test.js`, `tests/start.test.js` |
| A guard that should never fire still throws the class the contract names | every `throw new X(` in `src/` checked against each module's imports and declarations: one instance, the applier's `ConfigError`, which would have surfaced as a `ReferenceError` — exit 1 with a stack — where §10.4 promises exit 2. The guards are invariants, so no printed path reaches them; the test asserts the class and the message, and that a refused item writes nothing | `tests/plan.test.js` |
| `explain` prints the state severity a rule declares, generated and not hardcoded | a rule with `severityWhen` gains one `state` line naming the pair and the evidence that selects it; a rule without one renders byte for byte as before — the whole document is compared, and `explain --list` and `explain --format json` are identical by hash | `tests/explain.test.js` |
| An `at-policy` fixture is at policy for the reason its name claims | the fixture with the old manifest plans 1 item (`package.json · set devEngines.packageManager`); restored, it plans 0. The empty-plan test in `tests/cli.test.js` had the same defect one directory away: without the guard and under a git root its plan held 3 items | `tests/init.test.js`, `tests/start.test.js`, `tests/cli.test.js` |
| `start`'s plan outside a repository is not the plan `init` applies inside one | the same directory before and after `git init`: `init --format json` plans 3 items, then 4, the fourth being the `.gitignore` block, because R7 declares `outside git, skip`; the consequence was `init --apply` refusing the untracked tree while `start` printed the smaller count | `rfcs/0031`, and the two tests over that state in `tests/start.test.js` |
| `init --apply` on a plan whose every item is a conflict refuses it | a fixture under the OS temp directory whose `package.json` carries a differing `devEngines.packageManager` (pnpm 9.6.0) and whose `pnpm-workspace.yaml` already carries the managed block: `init --format json` plans 0 writes and 2 conflicts, and `init --apply` exits `3`, prints `refusing to write: the plan carries 2 conflicts and no writable item` as its `reason:` line and writes nothing — RFC 10.4's refusal, not the dirty-tree one |

## Not verified — deliberately, and why

| Not verified | Why, and what it would take |
|---|---|
Linux | the suite, the self-scan and the drift gate run on `ubuntu-24.04` in the CI matrix, at the engines floor and the Active LTS, and `tests/ci-coverage.test.js` fails if the label leaves the matrix. A field loop has never run there: every field round was Windows |
macOS | **a decided non-goal, not a gap.** It is never executed, locally or in CI, and the owner decided it stays that way: the code branches on `win32` against POSIX, so macOS would run the path Ubuntu exercises, but nothing here claims it. A macOS user is on their own, and the README says so |
The three changes of the paths-and-guards release, as a fresh agent meets them | **closed.** The first round (0 of 4 sessions reached the end) found the defect that blocked it (#110, `start` planned a path from a directory that was not yet a repository); after the fix, the second round reached the last step in all four scenarios with `verdict PASS` and exit 0. See *The field rounds* below; what stays unverified is macOS, above, and a third-party repository's runtime. |
A field round outside a pnpm workspace | **closed by removing the claim.** The second round's installs never escaped, because `init --apply` writes `pnpm-workspace.yaml` before any step runs pnpm — so the line `rfcs/0031` added could not fire through the canonical path (#113), and three blind sessions in round 3 watched it print and be false. The line and its probe are gone (#144); `start` no longer says anything about a workspace it is about to create. The escape itself is still real for a package of a monorepo where the tool is not the one ordering the installs, and nothing in the tool claims otherwise now |
The four-repository `workflow-run-artifact` field measurement | `pnpm/pnpm` (34 workflow files), `nodejs/node` (45), `vercel/next.js` (29) and `vitejs/vite` (13) — 121 files — were fetched whole and every workflow read: three answered `fail`, one in each of the first three; the third is the case where the same measurement found the rule answering `pass` with a message false of the file, a consumer whose only write scope is `id-token: write`, after which the threshold is any write scope; no workflow answered `fail` without fork-derived bytes reaching a write scope, and the two mechanisms each carried a mitigation in the part that could be seen. **None of the four is on disk**: the ten clones under `M:/pruebas/real` do not include them, so no command here re-checks the counts, the mitigations or `nodejs/node`'s `skip / unparseable-workflow` on `contributor-guidance.yml` (`WELCOME_MESSAGE: >2-`, a valid indentation indicator, #266). What it would take: clone the four at the state the fixture headers record and re-run `scan --scope repo --only workflow-run-artifact` in each; the three consumer pairs and the `pass / no-workflow-run` shape stay checked meanwhile by `tests/rules/workflow-run-artifact.test.js` |

## The field rounds

A field round is four blind sessions, one per repository shape, each given nothing but the tool's own
output ([`docs/field-loop.md`](field-loop.md)). Three rounds have run, all on Windows.

| Round | Scenarios | Reached the last step | Findings |
|---|---|---|---|
| 1 | `create-next-app` with npm, `vite`, `create-t3-app`, a directory holding only a `package.json` | **0 of 4**, all stopped at step 2 | #110 (fixed in `rfcs/0031`), #111, #112, #113 |
| 2 | the same four shapes, regenerated | **4 of 4**, `verdict PASS` and exit 0 in each; three of four ended with a clean tree | #131, #132, #133, #134, #135 |
| 3 | `vite` and a directory holding only a `package.json`, the two shapes that ended dirty or refused in round 2 | **3 of 3** sessions ended with `git status` empty and the add's commit in the log | #139, #144, #145, #146 |

What the rounds left behind beyond the fixes: two findings became test shapes nobody had imagined while reading the code — a directory that is not a repository at all, and a manifest whose `packageManager` says npm while its `devEngines.packageManager` names pnpm. Round 3 added a third kind of value: it watched a line the tool had just been taught to print, and found it false, which no test could have done because the line was true of the moment it was computed from. A finding whose fix ships without its case leaves the same exposure one
commit later, which is the rule [`docs/field-loop.md`](field-loop.md) states in its third step.

Two caveats, because without them the rounds read as broader than they are. `GIT_CEILING_DIRECTORIES`
was set only on the tool's own invocations, so the sessions' plain `git` commands saw the surrounding
repository and `git init` created a nested one; the tool's path was still the non-repository one, which
is what the scenario is about. And round 2 ran inside a repository that owns a `pnpm-workspace.yaml`, so
its installs would have escaped had `init --apply` not written the project's own workspace file first —
which is exactly why the round met no escape and why the line `rfcs/0031` added never fired.

## The rule loop, one rule at a time

`odd/tasks/field-loop-every-rule.md` took each of the thirteen rules and measured it from four sides — it fails
with its own code at the location the finding names, it passes and the pass is **counted**, it skips with the
fact named, and it is off by policy contributing neither a finding nor a count — and then applied the three
obligations: the printed remediation is run and must clear the finding **and change nothing else**, the two
formats must agree, and the page must describe what the run does. Every fixture was built at run time in the
OS temp directory and driven through the binary, so no row here rests on a developer machine's state.

| Rule | What the four sides needed | The fact the run decided |
|---|---|---|
| `package-manager-pin` | **code** | a pin carrying `+sha512.…` was reported as a difference from the machine; the version the pin names is what is compared |
| `lockfile-committed` | **code**, spec first | `git check-ignore -v <path>` answers nothing for a path already in the index; the printed command carries `--no-index` |
| `foreign-lockfile` | the page | the page said "both presets" where three exist |
| `quarantine` | the page | the two fail codes are indistinguishable in the human report, which prints no code at all |
| `exact-versions` | the page | the page claimed two skips where the rule emits one |
| `env-not-tracked` | the page | the `no-repo` skip was never named, and the plan's own "unreachable" claim was refuted: the refusal is on the agent's command text, not on the machine |
| `sensitive-ignored` | the page | the rule fails whether or not the file exists, and `init --apply` writes one fixed block, not "the missing entries" |
| `actions-pinned-sha` | **code** | the printed docker remediation swapped the image — `docker://registry:5000/app` became `docker://registry@sha256:…` — and a digest that is not 64 sha256 hex was appended, not replaced |
| `no-bot-auto-merge` | the page | the line is where the **step begins**, not where its `run:`/`uses:` is, and the edit is the whole step |
| `ci-no-safety-overrides` | the page | the printed remediation replaced the whole `run:` body, so a compound step lost its other commands. Closed by #383, and measured on the same three commands in the two shapes a step can carry them: a multi-line body — `pnpm install --no-frozen-lockfile`, then `pnpm test`, then `pnpm run build`, one per line — prints `edit the step by hand: replace --no-frozen-lockfile with --frozen-lockfile, keeping the rest of the run: body as written`, because a body split across lines printed as one line would lose the rest; the same three on one line print the rewritten body itself, `run: pnpm install --frozen-lockfile && pnpm test && pnpm run build`. The hand-edit sentence is the multi-line shape's remediation, not the rule's only one |
| `pull-request-target` | the page | a pass is a summary count and never a row, so no format prints the code or the message it carries |
| `workflow-permissions` | the page | severity belongs to the rule, not to one of its codes: a `write-all` is `warn` under `baseline` too |
| `workflow-run-artifact` | **code** | a trigger listing a name that resolves to nothing answered a counted pass; R13 says an unresolved producer is a skip |

Nine of the thirteen needed no code. That is the loop's largest result and its least comfortable one: the
product answered its own promises, and what was wrong was the record — pages silent on the fact that decides a
side, and one spec (then at `docs/spec/rules.md:259`) promising a manual alternative that no command prints; #375
deleted the promise instead of inventing the command.

### The mutation round that closed it

Eight single-token mutations, each a deliberate defect in code the loop proved or fixed, each killed by the test
that owns the behaviour. No mutant survived, and the tree was restored from a byte copy after every run, never
from git.

| Mutation | Killed by |
|---|---|
| the `+sha512` hash left on the declared version | `tests/rules/package-manager-pin.test.js` |
| `check-ignore` without `--no-index` | `tests/rules/lockfile-committed.test.js` |
| repository facts read from the invocation directory | `tests/rules/lockfile-committed.test.js` |
| a docker tag split that ignores the registry slash | `tests/rules/actions-pinned-sha.test.js` |
| an existing docker digest not recognised | `tests/rules/actions-pinned-sha.test.js` |
| a missing producer name riding under the pass again | `tests/rules/workflow-run-artifact.test.js` |
| `starter` running `sensitive-ignored` | `tests/invariants.test.js` |
| `github.event.pull_request.head.sha` no longer a head expression | `tests/rules/pull-request-target.test.js` |

## Totals, and the mistake this page made once

A total is not a subtotal. This page first carried 89, 68, 206 and 96 as the *totals* of four clones; those are the
`exact-versions` subtotals (and 89 is `berry` without `workflow-permissions`). An independent agent re-ran the
five clones and measured 121, 74, 277 and 129; re-measured at the close of the defect batch, the same command
answers 121, 75, 281 and 129 — and `e923280` answers that too, so the note's 74 and 277 do not reproduce from the
clones on disk and the batch moved neither. The rows above name the rule whose count they quote, and this note
stays because the error is the one a reader is most likely to repeat.

| clone | total findings (rows in `--format json`) | distinct rules that skipped |
|---|---|---|
| `yarnpkg/berry` | 121 | 3 |
| `vercel/nextjs-subscription-payments` | 33, of which 26 are `exact-versions` — the specifiers `pin` can pin | 6 |
| `primefaces/primevue` | 75 | 5 |
| `shadcn-ui/ui` | 281 | 3 |
| `t3-oss/create-t3-app` | 129 | 2 |

The command behind both columns is `scan --scope repo --format json` in each clone.

## The round at `fc77fc2`

One round of the loop — the floor `odd/tasks/post-release-debt.md` states as `T5b` — was measured at
commit `fc77fc2` on branch `docs/post-release-record`: 45 scenarios, about 140 command executions, over
the real repositories at `M:/pruebas/real` and this repository, covering all **seven axes** the floor
names — the six surface axes plus one run per rule id from `explain --list` — and every one of them
produced a result. The section is additive: no row above changed.

| Axis | The run, and what it observed |
|---|---|
| Parity | `vercel-subscriptions-copy`: one flag set in both formats — the human report reads `0 errors · 26 warnings · 0 info · 6 passing · 6 skipped`, `PASS`, exit 0, and the JSON document for the same flags carries the identical counts and verdict. `repro-steps-indent` reads `4/0/0/7/3`, `FAIL`, exit 1 in both. All 13 rule ids agree between the two formats on both repositories |
| Exit codes | `--fail-on` at each threshold: `vercel-subscriptions-copy` answers `0` for `error`, `1` for `warn`, `1` for `info` and `0` for `none`; `repro-steps-indent` answers `1`, `1`, `1`, `0`. A usage error exits `2`. `init --apply` refuses a dirty tree only where the dirty path is one of the plan's own targets: with `package.json` edited it exits `3` printing `refusing to write over uncommitted changes: package.json` and writes nothing, while an edited file outside the plan — `NOTES.md` in a fixture — does not refuse the run, which exits `0` and writes its three files. The refusal is narrower than the tree, and `migrate --apply` on `main` exits `3` with the file kept |
| The write paths | run on a disposable copy under `M:/pruebas/real/_out/t5b/`: `init --apply` wrote 3 files, the ledger's `sha256` matched the bytes on disk, `HEAD` did not move, and a second run printed `nothing to apply`. `migrate --apply` removed only `package-lock.json`, and a second run printed `nothing to remove`. `pin --apply` changed only `package.json`, 26 leaves, all specifiers, key order preserved, and a second run printed `0 writes`. **No write path left a repository in a state it claimed it would not** |
| Machine scope | on this host `quarantine` passes, and the message that pass carries — `quarantine is a 4320-minute strict gate (policy floor 1440)`, the rule's own sentence in `src/rules/quarantine.js` — reaches no format, because a pass is a count: the human report prints `all 1 rule pass` and the rule id only under `--verbose`, and the JSON document counts the pass in `summary` and serializes no entry for it. `--scope machine --format json` reports `pass: 1, skip: 12` and serializes only the twelve skips, so no serialized entry names the pass; the twelve serialize as `no-repo` ten times and `no-repo-root` twice, with no `no-package-json` at all, because since #398 an excluded scope answers the scope's code for `package-manager-pin` too. `provenance.quarantine` reads `not verified (repository excluded)` beside it. The derivation is the set difference against `explain --list`, `provenance` speaks about the repository declaration and not about whether a rule ran, and the cure is a paragraph in the report spec — issue #333, relabelled `type:docs` |
| A real workspace | `t3-create-t3-app`, whose workspace is declared only in `pnpm-workspace.yaml`: three importers are named as not pinned, and the sentence `pin` printed to justify it was false twice — the scan had read those manifests, and one of the three is not a workspace member. That is issue #331, fixed: the clone now prints `3 lockfile importers not pinned (cli, cli/template/base, www): pin writes the root importer only` |
| An unreadable manifest | a fixture built under `M:/pruebas/real/_out/t5b/`: a `package.json` that does not parse yields `exact-versions` with `skip`/`unparseable-package-json` and `package-manager-pin` with `fail`/`unparseable-package-json`; a JSON document that parses but is not an object yields the same shape with `does not contain a JSON object`. No stack, exit 1, and the human and JSON documents agree |
| Every rule reachable | `explain --list` gave 13 ids, and `scan --scope all` on this repository answered every one of them with a real finding. No rule was unreachable at this commit |

A mutation round ran beside the axes: five single-token mutations, each in code that carries a promise,
each killed by the suite. No mutant survived.

| Mutation | Killed by |
|---|---|
| `src/lib/report.js:122` — count a skip as a pass | the suite |
| `src/commands/scan.js:50` — always exit 0 | the suite |
| `src/lib/report.js:160` — `>=` → `>` in the threshold comparison | the suite |
| `src/rules/quarantine.js:75` — a skip message | **exactly one test** |
| `src/lib/paths.js:47` — `isInside` always true | **exactly one test** |

Two of the five are held by exactly one test each: the quarantine skip message, and the symlink escape.
That is the finding of the round, because a mutation one test holds dies with the next refactor of that
test.

Three claims were attacked rather than confirmed, and all three survived.

| The claim attacked | What the run answered |
|---|---|
| `foreign-lockfile`'s passing side is narrower than the row above says | the rule passes on **8 of the 10** repositories at `M:/pruebas/real`, so the row survives |
| `actions-pinned-sha` passes here | the 11 `uses:` in this repository are all 40 hex, so the row survives |
| `workflow-permissions` warns on `repro-steps-indent` | it passes: `pass=1`, `findings: []`, no finding at all. The row above already said it passes, and a claim that it warned was the reviewer's error, recorded as an error and not as a defect |

Three contract observations were measured and left unchanged, because each is the contract behaving as
the spec states and none of them is a defect.

| Observation | What was measured |
|---|---|
| `verdict: pass` can sit beside a `fail` finding at `warn` severity | `yarnpkg-berry` with `--only foreign-lockfile` prints `verdict=pass`, exits 0, and emits one finding of status `fail` at severity `warn`. Correct by the threshold contract, and a trap for a script that reads `verdict` as "the rules passed" — which is why the 8-of-10 count above reads finding status and never verdicts |
| The negated globs in `shadcn-ui/ui`'s workspace file are not applied | four `workspace-entry-not-applied` skips say a negation is not applied, and `packages/tests/package.json` is scanned as a member. pnpm would not exclude that path for that pattern, so no importer is wrong; the limit is stated rather than hidden |
| A scan's root is not named in its output | `M:/pruebas` is an unborn repository — `git rev-list --count --all` answers `0` — so a scan run from `_scratch` audits `M:/pruebas` and never reads `_scratch/package.json`. Every printed statement is true of that root and misleading about the working directory, and nothing in either format names the resolved root |

The three that stood here — a failing `quarantine`, a failing `env-not-tracked` and a failing
`workflow-run-artifact` — were measured by the rule loop above, and each one was reachable for a reason the
first revision of that plan had got wrong: a fixture whose own `pnpm-workspace.yaml` decides the quarantine gate,
a test process that writes and commits a `.env` (the harness refuses the agent's command text, not the
machine), and the fixtures that already existed in the tree.

## The learn-path gate, and its four mutations

`docs/learn/` is prose, and no test can call a paragraph true. Its gate therefore asserts relations that can be
recomputed from the repository, and it says in its header what that leaves out. Four mutations, one per relation,
each run against the real suite at `tests/didactic-guide.test.js`:

| Mutation | The red it produced |
|---|---|
| a link retargeted at a page that does not exist (`01`: `../cli.md` -> `../nowhere.md`) | `01-before-you-start.md links ../nowhere.md, which resolves to docs
owhere.md and does not exist` |
| the `skill` row deleted from the when-not table (`05`) | `05-when-not-to-use-it.md has no row linking commands/skill.md: the page promises the decision for every command` |
| a rule id invented in prose (`06`: `rules/no-such-rule.md`) | `06-glossary.md cites the rule id "no-such-rule", which the catalog does not contain` |
| the last `Next:` turned back into plain text (`03`) | `03-reading-the-output.md ends with "Next: 04 - Why the rules exist.", which is not a link to the next page` |

All four killed, all four restored, and the suite green again at `10 pass` for that file.

**What this round does not prove**, and the reason the gate is not called a truth gate: a page can still assert a
falsehood about the program and pass all ten checks. The closing judge found seven such sentences, and the two that
mattered were a claim contradicted by a capture two pages earlier and an arithmetic that could not happen - neither
has a shape a test over the repository can see. What the four relations do catch is the class that silently breaks
the path: a link to nowhere, a table short a row, an id that does not exist, an order that stops being one.
## How this page stays true

The table is checked in CI through `tests/docs-contract.test.js`, which asserts the facts a document can
be wrong about: the command and flag surface, the four exit codes, the version strings and the rule
count. A row that describes behaviour tested elsewhere names its test; a row that does not is either
removed or moved to the last table.
