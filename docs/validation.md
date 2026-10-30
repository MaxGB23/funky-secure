# What has been verified, and how

Every row names the check that would fail if the claim stopped being true. A claim with no command
behind it is not on this page.

Scope: the tree at the time of writing. The version is deliberately omitted — a table that carries a
number becomes wrong at the next release, and the suite itself is the authority for it.

## The suite

| Claim | How | Where |
|---|---|---|
557 tests, 556 pass, 1 skipped (a Windows symlink case) | `node --test` | the whole tree |
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
The new state severity changes no other rule | 13 findings across 8 rules byte-identical to the base commit, including their severities; the three presets' severity maps, `failOn` and `active` identical; the standalone-lockfile human output byte-identical | differential against `git archive`, not committed |

## Not verified — deliberately, and why

| Not verified | Why, and what it would take |
|---|---|
GitHub Actions behaviour: that a correct workflow really runs green, and that `permissions: contents: read` really produces a 403 | Needs a runner and a repository. The rules were verified statically against 11 real workflows |
Linux | the suite, the self-scan and the drift gate run on `ubuntu-24.04` in the CI matrix, at the engines floor and the Active LTS, and `tests/ci-coverage.test.js` fails if the label leaves the matrix. A field loop has never run there: every field round was Windows |
macOS | never executed, locally or in CI. The code branches on `win32` against POSIX, so macOS runs the path Ubuntu exercises — an argument, not evidence |
The published tarball on another machine | The tarball was installed and exercised locally only |
The correctness of every remediation that needs an install (`pnpm install --lockfile-only`, `pnpm pkg set`) | Following one would change a repository; the commands were verified for shape, not for effect |

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
