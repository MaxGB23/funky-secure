# What has been verified, and how

Every row names the check that would fail if the claim stopped being true. A claim with no command
behind it is not on this page.

Scope: the tree at the time of writing. The version is deliberately omitted — a table that carries a
number becomes wrong at the next release, and the suite itself is the authority for it.

## The suite

| Claim | How | Where |
|---|---|---|
586 tests, 585 pass, 1 skipped (a Windows symlink case) | `node --test` | the whole tree |
The repository passes its own audit | `node bin/funky-secure.js scan --scope repo --fail-on warn`, exit 0 | CI |
Every documented flag is accepted by the command the document names | `tests/docs-contract.test.js` | documentation contract |
The spec stays a true slice of the record, and every amendment names a shipped record | `tests/drift.test.js` | the drift gate |
A rule cannot be added without a page and without a spec section | `tests/docs-contract.test.js` | catalogue |
The pack we would publish installs and runs | `node scripts/pack-smoke.js` — packs, installs the tarball into an empty directory, asks the installed binary for its version and runs a report | `prepublishOnly` |

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
`quarantine` | Declared and strict at `2880` in `shadcn-ui/ui` (passes), declared at `1440` in `t3`; the block written by `init --apply` is read back by pnpm (`pnpm config get minimum-release-age` → `1440`) |
`exact-versions` | 206 floating ranges located line by line in `shadcn-ui/ui` with 0 mismatches and 0 desyncs over 245 specifiers across 7 importers; 68 findings on `primevue` after the catalogue is resolved (13 false positives gone); 80 of its 96 findings carry `pnpm -C <dir>` in `t3`; 26 specifiers pinnable on the pnpm 8 shape in `vercel/…` |
`sensitive-ignored` | True positives on `primevue` and `shadcn-ui/ui` (`git check-ignore --no-index` confirms the paths are not ignored), and a tracked tokenless `.npmrc` correctly exempt |
`env-not-tracked` | `.env.local.example` in `vercel/…` is a template and not a finding; a tracked `.env` still is |
`actions-pinned-sha` | 53 unpinned actions in `berry`, 64 in `shadcn-ui/ui`, 24 in `t3` — the last two inside `.github/actions/setup/action.yml`, a composite action six workflows consume |
`no-bot-auto-merge` | 2 findings in `berry`; passes on `shadcn-ui/ui`, whose kodiak requires a label |
`ci-no-safety-overrides` | Detects `--no-frozen-lockfile` in `ts-safeql/safeql` `.github/workflows/ci.yml:49` (`ci-frozen-lockfile-disabled`, with the command in `evidence`); passes on `shadcn-ui/ui` and `t3` (`--frozen-lockfile` and nothing worse) |
`pull-request-target` | Detects a genuine pwn request in `cloud-bulldozer/benchmark-operator` `.github/workflows/e2e.yml:33` — the step checks out `github.event.pull_request.head.sha` and later steps consume real secrets (`pull-request-target-checkout`); passes on `t3` and `shadcn-ui/ui`, where the two `pull_request_target` workflows never check out the head |
`workflow-permissions` | 32 findings in `berry` — the rule that produced no signal at all before the indentless-sequence fix — and 4 in `shadcn-ui/ui`, each naming the jobs that inherit the default |

## Behaviour that was measured rather than assumed

| Claim | How |
|---|---|
`pnpm import` reads a foreign `package-lock` v3 offline, in 39 ms, keeping the recorded version | measured in a scratch directory |
`minimumReleaseAge` defaults to 0 on pnpm 10.16 and to 1440 from pnpm 11 | measured against both |
`minimumReleaseAgeStrict` defaults to true only when an age is explicit | pnpm issue #14409, and measured |
`pnpm --version` rewrites a lockfile when the repository declares `packageManager` | isolated four ways before the probe was moved out of the repository |
`pnpm --version` answers the declared version **inside** the project | measured on `shadcn-ui/ui` (10.33.4 inside, 12.3.4 on the PATH) |
`init --apply` is idempotent on a real workspace | `t3`: block appended after `onlyBuiltDependencies`, `packages:` untouched, `yaml@2.9.0` parses it, second run `nothing to apply`, bytes identical |
`pnpm import` reads a **berry** `yarn.lock` offline and keeps the pin | pnpm 12.3.4, a `__metadata: version: 8` lockfile, `lodash` `4.17.21`: 23 ms, and the new `pnpm-lock.yaml` records `lodash@4.17.21` |
pnpm **ignores `workspaces` in `package.json`**, and an empty `pnpm-workspace.yaml` changes nothing | four trees: no block, empty block, managed keys only — one importer each; only `packages:` produces three importers and the `workspace:^` link. So creating the file never degrades a workspace pnpm already had, and it never transfers an npm or yarn one either |
pnpm 10 reads the block | pnpm 10.16.1 and 12.3.4 both answer `1440`, `4320` and `~` from `pnpm-workspace.yaml`, and `undefined` outside it; `ignoreScripts` answers `true` |
`devEngines.packageManager` is a guard npm enforces and `packageManager` is not | npm 11.13.0 exits 1 `EBADDEVENGINES` before the install and writes no `package-lock.json`; `--force` downgrades it to a warning and writes one; a machine-level `pmOnFail` overrides it on pnpm's side | `rfcs/0030-the-guard-both-managers-read/evidence/onfail-and-autoswitch.md` |
The `onFail` value is not a free choice | with `onFail: "error"` pnpm 11.28.10 refuses to re-execute as the pinned 12.3.4 and exits 1, while the same manifest with no `onFail` — and with no `devEngines` at all — exits 0 having switched; npm's default is already `error`, and `warn` makes it write the lockfile | same evidence file |
The manifest writer loses nothing it was not asked to change | 28 manifest shapes (indentation, tabs, CRLF, no trailing newline, `devEngines.runtime`, uninterpretable declarations) compared item by item against the base commit: the pin's item is identical in state, content, reason and digest, and every key survives | differential against `git archive`, not committed |
The guard is read before the machine, and compared by name and by version | four combinations of pin and `devEngines.packageManager` on the wire, before and after: a guard naming another version answered `pass` while the pin equalled the machine, and a pin naming another manager answered `self-managed-pin` with the sentence "declares npm@11.13.0 and manages its own pnpm". After: `skip` / `self-managed-pin` and `skip` / `not-pnpm`, and a repository with an agreeing guard still passes | `tests/rules/package-manager-pin.test.js`, plus a differential over 5 manifests against `git archive` |
pnpm's escape from a foreign `packageManager` is `--pm-on-fail=ignore`, and no other flag does it | pnpm 12.3.4: `pnpm config get package-manager-strict` answers `undefined`; `--config.package-manager-strict=false`, an `.npmrc` key, `npm_config_…` and `COREPACK_ENABLE_STRICT=0` all leave `ERR_PNPM_OTHER_PM_EXPECTED` (exit 1). `--pm-on-fail=ignore` makes `import`, `install --lockfile-only` and `add` exit 0 and write the lockfile | measured, then confirmed in the field in a `create-t3-app` repository |
The path prints no prediction about a workspace it is about to create | on an ancestor-workspace shape `start` prints no workspace line and its six steps are byte-identical to the no-ancestor shape; a project at `apps/demo` under an enclosing workspace, followed literally, wrote its lockfile **in the project**, scanned `PASS` with `REPO-ROOT all 5 rules pass`, and ended with `git status --porcelain` empty | `tests/start.test.js`, and a demonstration outside the repository in round 3 |
The writers' next steps and the path print one commit, from one constant | `init`'s block equals `commitWritesStep(writtenPaths(plan))` for the same plan — `package.json` included, no bare `git add` — and the literal `chore: apply funky-secure` lives in one module | `tests/init.test.js`, `tests/start.test.js` |
A guard that should never fire still throws the class the contract names | every `throw new X(` in `src/` checked against each module's imports and declarations: one instance, the applier's `ConfigError`, which would have surfaced as a `ReferenceError` — exit 1 with a stack — where §10.4 promises exit 2. The guards are invariants, so no printed path reaches them; the test asserts the class and the message, and that a refused item writes nothing | `tests/plan.test.js` |
`explain` prints the state severity a rule declares, generated and not hardcoded | a rule with `severityWhen` gains one `state` line naming the pair and the evidence that selects it; a rule without one renders byte for byte as before — the whole document is compared, and `explain --list` and `explain --format json` are identical by hash | `tests/explain.test.js` |
An `at-policy` fixture is at policy for the reason its name claims | the fixture with the old manifest plans 1 item (`package.json · set devEngines.packageManager`); restored, it plans 0. The empty-plan test in `tests/cli.test.js` had the same defect one directory away: without the guard and under a git root its plan held 3 items | `tests/init.test.js`, `tests/start.test.js`, `tests/cli.test.js` |
`start`'s plan outside a repository is not the plan `init` applies inside one | the same directory before and after `git init`: `init --format json` plans 3 items, then 4, the fourth being the `.gitignore` block, because R7 declares `outside git, skip`; the consequence was `init --apply` refusing the untracked tree while `start` printed the smaller count | `rfcs/0031`, and the two tests over that state in `tests/start.test.js` |

## Not verified — deliberately, and why

| Not verified | Why, and what it would take |
|---|---|
GitHub Actions behaviour: that a correct workflow really runs green, and that `permissions: contents: read` really produces a 403 | Needs a runner and a repository. The rules were verified statically against 11 real workflows |
Linux | the suite, the self-scan and the drift gate run on `ubuntu-24.04` in the CI matrix, at the engines floor and the Active LTS, and `tests/ci-coverage.test.js` fails if the label leaves the matrix. A field loop has never run there: every field round was Windows |
macOS | **a decided non-goal, not a gap.** It is never executed, locally or in CI, and the owner decided it stays that way: the code branches on `win32` against POSIX, so macOS would run the path Ubuntu exercises, but nothing here claims it. A macOS user is on their own, and the README says so |
The published tarball on another machine | The tarball was installed and exercised locally only |
The correctness of every remediation that needs an install (`pnpm install --lockfile-only`, `pnpm pkg set`) | Following one would change a repository; the commands were verified for shape, not for effect |
The three changes of the paths-and-guards release, as a fresh agent meets them | **closed.** The first round (0 of 4 sessions reached the end) found the defect that blocked it (#110, `start` planned a path from a directory that was not yet a repository); after the fix, the second round reached the last step in all four scenarios with `verdict PASS` and exit 0. See *The field rounds* below; what stays unverified is macOS and the Actions runtime, in the rows that follow |
A field round outside a pnpm workspace | **closed by removing the claim.** The second round's installs never escaped, because `init --apply` writes `pnpm-workspace.yaml` before any step runs pnpm — so the line `rfcs/0031` added could not fire through the canonical path (#113), and three blind sessions in round 3 watched it print and be false. The line and its probe are gone (#144); `start` no longer says anything about a workspace it is about to create. The escape itself is still real for a package of a monorepo where the tool is not the one ordering the installs, and nothing in the tool claims otherwise now |

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

## Totals, and the mistake this page made once

A total is not a subtotal. This page first carried 89, 68, 206 and 96 as the *totals* of four clones; those are the
`exact-versions` subtotals (and 89 is `berry` without `workflow-permissions`). An independent agent re-ran the
five clones and measured 121, 74, 277 and 129. The rows above now name the rule whose count they quote, and
this note stays because the error is the one a reader is most likely to repeat.

| clone | total findings | rules skipped |
|---|---|---|
| `yarnpkg/berry` | 121 | 3 |
| `vercel/nextjs-subscription-payments` | 26 pinnable by `pin` | — |
| `primefaces/primevue` | 74 | 4 |
| `shadcn-ui/ui` | 277 | 2 |
| `t3-oss/create-t3-app` | 129 | 2 |

## How this page stays true

The table is checked in CI through `tests/docs-contract.test.js`, which asserts the facts a document can
be wrong about: the command and flag surface, the four exit codes, the version strings and the rule
count. A row that describes behaviour tested elsewhere names its test; a row that does not is either
removed or moved to the last table.
