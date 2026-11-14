# The workflow_run artifact pair

Close #153 by naming the third privileged trigger, so the README stops carrying a known hole.

## Specs

- **S1** The goal, in the owner's words: "quiero cerrar 153 y si es necesario adaptar el issue por si es que miente.
  Esto nos hará evitar mencionar el "One hole in the rule set is known and open" y por fin cerrarlo."
  (#153 must close because the hole is closed, never because the sentence is deleted.)
- **S2** The drawing stays out of this release: "153 entra, pero el diagrama de readme será abordado despues por mi
  cuenta, fuera de la release". The raster keeps `TWELVE` until the owner redraws it; every **text** surface that
  states the count moves in this release, and the divergence is recorded, not hidden.
  The GitHub repository description states the count too ("twelve stateless rules") and moves **last**: "igual la
  descripcion del repo en gh la ponemos para el final, ya que igual menciona 12 reglas".
- **S3** The finding is the pair, as #153 measured it: an unprivileged workflow (`on: pull_request`,
  `permissions: contents: read`) uploads an artifact, and a privileged workflow (`on: workflow_run`, with
  `contents: write`, `actions: read` or `pull-requests: write`) downloads it by `github.event.workflow_run.id`
  with `github.token` and hands its bytes to a write context. The verdict today is `PASS` with every CI rule
  green; after this feature it is a finding.
- **S4** The catalogue is twelve and a thirteenth must argue itself in §8.4, which says: "twelve rules must still
  fit one screen of output on a real repository, one page of documentation, one test file each and one release
  note" and "a thirteenth rule cannot arrive without a section here (0024)". RFC 0035 carries that argument or
  the feature does not proceed.
- **S5** Spec and implementation ship in one pull request: `tests/docs-contract.test.js:281-285` counts
  `#### R` sections against `catalog.length`, so a spec-only PR cannot pass the suite the ritual refuses to
  publish over.
- **S6** The reader must expose what the finding needs, and today it does not: `parseWorkflow` returns
  `{ok, jobs, permissions}`, steps carry no `env`, and nothing models the workflow `name:` or
  `on.workflow_run.workflows` (issue #153's consumer carries `GH_TOKEN` only in `env:` and names its producer
  by workflow name).
- **S7** `README.md:193-196` ("One hole in the rule set is known and open") is removed **in the pull request that
  closes the hole**, gated by a test over issue #153's exact two-file fixture.
- **S8** A new `error` rule turns existing scans red under the default `--fail-on error`: `Risk: item 3`
  (published contract), `type:breaking-change`, and the RFC states the upgrade consequence and the `starter`
  preset position.

## Tasks

| ID | Task | Spec | Route | Commit |
|---|---|---|---|---|
| T1 | Re-measure #153 on `main` with the two-file fixture; record the verdict; amend the issue if it lies | S1, S3 | inline | — |
| T2 | Reader: workflow `name:`, `on.workflow_run.{workflows,types}`, `env:` at job and step | S6 | inline | — |
| T3 | `rfcs/0035-the-third-privileged-trigger/rfc.md` as `draft` + registry row; carries "why thirteen", the §8.4 amendment, the false-positive boundary, the S2 divergence | S4, S8 | inline | — |
| T4 | The rule + tests + goldens + `docs/rules/<id>.md` + preset policy + every count in `docs/spec/`, `docs/cli.md`, `docs/guide.md`, `README.md` prose | S3, S5, S8 | inline | this commit |
| T5 | Remove `README.md:193-196`, gated by the T1 fixture as a test | S7 | inline | this commit |
| T6 | Verification, native review, and `node scripts/open-pr.js` | S5 | inline | — |
| T7 | Update the GitHub repository description once every text surface is true (last step of the release) | S2 | inline | — |

## Log

- **L1** "Quiero tu recomendacion. No quiero abordar todo, solo quiero que el repo deje de tener una seccion de
  "Qué no está verificado" para que el repo tenga fiabilidad"
- **L2** "dale, sigamos ese orden, quiero cerrar 153 y si es necesario adaptar el issue por si es que miente.
  Esto nos hará evitar mencionar el "One hole in the rule set is known and open" y por fin cerrarlo. Dame el
  plan para hacerlo con odd y rdd"
- **L3** "delega un subagente a que refute nuestro plan antes, esto nos ayudará a tener una segunda opinion y que
  el plan sea mas pulido" — the refuter found, verified here: the docs-contract count gate (S5), the §8.4 budget
  and the drawn count (S4, S2), the missing `env`/`name` surfaces (S6), and the vacuous 403 probe (moved to the
  other feature).
- **L4** "153 entra, pero el diagrama de readme será abordado despues por mi cuenta, fuera de la release" — the
  raster is out of scope; the divergence between the drawing and the catalogue is recorded in RFC 0035 and in
  `docs/images/README.md`, and the redraw is owned by the maintainer.
- **L5** "igual la descripcion del repo en gh la ponemos para el final, ya que igual menciona 12 reglas" — the
  description is a text surface, so it is not deferred like the raster: it moves at the end of this release (T7).
- **T1 measured** on `main@1b5d344`, `GIT_CEILING_DIRECTORIES` set to this repository so the parent's lockfile
  cannot contaminate the fixture. The scan prints `CI — all 5 rules pass` over issue #153's exact two files, so
  the issue does not lie and needs no rewrite. The same run confirms S6: `parseWorkflow` returns
  `{ok, jobs, permissions}`, `name` is `undefined`, and the step keys are
  `index, line, name, uses, raw, with, run` — no `env`. The measurement was posted as a comment on #153.
- **T4 built.** `workflow-run-artifact` is R13 of 8.2: friction 1, `error` in `baseline` and in `strict`,
  remediation manual, catalog entry last in `src/rules/index.js`. The producer leg is reachable because
  the collector already resolves every `.github/workflows/*.y(a)ml` as `ctx.repo.workflows` with its
  full text, so the rule reads the sibling file the trigger names and matches `name:` against it; no
  new probe and no new parser. Measured: `node --test tests/rules/workflow-run-artifact.test.js` is 12
  of 12 passing, and the RED was observed before the rule existed — against a module that returned no
  finding, 11 of the 12 cases failed on their own assertions and the twelfth was the catalog identity
  the stub already declared. `node scripts/gen-golden.js` moved only the counts: `pass` +1 in `clean`,
  `dirty` and `vulnerable`, and `skip` +1 with the new `no-ci` finding in `at-policy`, `below-policy`
  and `pinned-conflict`. No other golden field moved. The counts moved in `docs/spec/rules.md` (8, 8.2,
  R13 itself and 8.4, which carries the argument), `docs/spec/scope.md` (the `ci` list),
  `docs/spec/policy.md` (`starter` turns the other seven `off` and names the rule as an added catalog
  rule), `docs/spec/report.md`, `docs/spec/machine.md`, `docs/cli.md`, `docs/guide.md` and
  `README.md`. `skills/funky-secure/SKILL.md` states no count at all, so it needed no edit. `starter`
  leaves the rule `off` and `baseline` is `error`, which is where the change is felt (0035). The
  self-scan is exit `0`: `CI / all 6 rules pass`, `11 passing · 2 skipped`, verdict `PASS`.
- **T5 measured.** The paragraph "One hole in the rule set is known and open" is removed from
  `README.md` in the same change that closes the hole, and issue #153's exact two files, copied byte
  for byte from `.tmp/issue153/.github/workflows/` into
  `tests/fixtures/workflows/workflow-run-pair/`, are the failing test. End to end, a scan over a
  scratch copy of those two files, with `GIT_CEILING_DIRECTORIES` set to this repository, prints
  `Workflow run artifact  ·  .github/workflows/label.yml:11` under `CI`, names the producer and the
  two write scopes, prints the two structural routes, and exits `1`. The T1 measurement on the same
  pair printed `all 5 rules pass` and exit `0`, so the two runs are the before and the after.
- **T4/T5 suite state.** `node --test` is 704 passing and 3 failing, and the three failures are count
  assertions in files outside T4 and T5's edit surface: `tests/policy.test.js` ("starter runs exactly
  six rules and turns the other six off"), `tests/report.test.js` ("states how many rules a reduced
  policy runs and names the ones it does not") and `tests/start.test.js` ("both closing blocks always
  print"). Each still states the catalogue as twelve; they are named here for the parent instead of
  edited from this task. The commit these two tasks land in is the parent's to name.
- **Suite closed.** The parent applied the three count assertions (seven off in `starter`, the label
  list, the closing sentence): `node --test` is 708 tests, 707 passing, 1 skipped, 0 failing.
- **The count leaked in four text surfaces, found by grep after the rule landed.** `docs/concept.md`,
  the README's description of the drawing, `CONTRIBUTING.md`'s feature checklist and `docs/decisions.md`
  still said twelve, and the log had no row for the product decision. The description drops the number
  rather than raising it, because the drawing it describes still says TWELVE; the log gained `D-17`.
- **Commits.** `cdf2126` the reader, `1c0a326` the RFC, `5737216` the rule with its spec, page, tests
  and goldens, and one docs commit for the four surfaces. `gentle_review assess` over the committed
  range answered `risk: medium`, `reviewDue: false` (`under_budget`), so no native review was started;
  the independent verifier runs instead, and a `Risk: item 3` line was needed to admit it.
- **The independent verifier's findings on `5737216`, three of them fixed here.** D1: a producer name two
  files carry resolved to the first in path order, so a consumer named `build` whose `workflow_run` names
  `build`, with `a-build.yml` (`on: push`) and `z-build.yml` (`on: pull_request`) carrying the same name,
  answered `pass / trusted-producer` and said every producer declares no `pull_request`, which is false of
  that repository; with `z-build.yml` first the same repository answered `fail / workflow-run-artifact`.
  A name more than one workflow carries now resolves to no producer: the answer is the existing
  `skip / producer-unresolved-name`, the message names the files that carry it in path order, and the
  answer no longer depends on which file sorts first. A name exactly one workflow carries keeps today's
  answer byte for byte, checked against `fd4e32d` over issue #153's pair: the two scans agree on stdout,
  stderr and exit code. The RED was observed before the fix: the new two-file case answered
  `pass / trusted-producer` where it requires `skip`, and a hand run over the three-file repository
  answered `pass / trusted-producer` with the push file first and `fail / workflow-run-artifact` with the
  `pull_request` file first. D2: the rule's `evidence` string dropped the value clause R13 states, so it
  now reads "with the value that was read", the shape `evidence.download` already carried and
  `pull-request-target` and `actions-pinned-sha` write. D3: `docs/validation.md` had one row per rule and
  none for R13 while `README.md:181` claimed thirteen rules verified against real code; R13's row states
  the one measurement that exists (issue #153's two files, scanned in a scratch directory with
  `GIT_CEILING_DIRECTORIES` set to this repository, before the rule and after it, and no real-world
  repository instance was searched for), and the README bullet claims real code for twelve while naming
  the thirteenth's evidence. The spec, the page and the rule's own `detection`, `evidence` and `limits`
  strings say the same: a shared name is a skip, never a resolution to the first in path order. Three
  tests pin what the verifier checked by hand, and two of them were already there: a shared workflow name
  is never `trusted-producer` (new), a consumer whose `on:` is a flow collection skips and never fails
  (already present, named here), and a `schedule:` trigger with one `- cron:` item still parses as `map`
  with the `schedule` event (`tests/workflows.test.js`, already present). Measured: `node --test
  tests/rules/workflow-run-artifact.test.js` is 13 of 13, `node --test` is 709 tests with 708 passing, 1
  skipped and 0 failing, `node scripts/gen-golden.js` writes the same five files and leaves no diff, the
  self-scan is exit 0 with `0 errors, 0 warnings, 0 info, 11 passing, 2 skipped`, and a scratch scan over
  the three-file repository answers `skip / producer-unresolved-name` naming the three files in path
  order. No golden moved. The verifier's fourth finding is not this task's and is left to the parent.
- **The R13 measurement on four real repositories, and the false pass it found.** The queue item after
  D3 was the one that row left open: a real repository instance was searched for. Four repositories
  were fetched into `.tmp/realwf/` and every workflow file read through the rule, with nothing from any
  of them executed: `pnpm/pnpm` (34 files), `vercel/next.js` (29), `nodejs/node` (45) and `vitejs/vite`
  (13), 121 workflow files in total. Verdicts before this change: `pnpm/pnpm` `fail` on
  `pacquet-integrated-benchmark-comment.yml:112`, `nodejs/node` `fail` on
  `nix-changes-comment.yml:21` plus `skip / unparseable-workflow` for `contributor-guidance.yml`,
  `vitejs/vite` `pass / no-workflow-run`, and `vercel/next.js`
  `pass / no-write-permission`. The first three are the rule answering as it was built to; whether
  either `fail` is exploitable in its own repository is that maintainer's call, not this record's. The
  fourth is the defect. `upload_preview_tarballs.yml` runs on `workflow_run`, downloads the tarballs
  `build_and_deploy.yml` built on `pull_request`, and holds `contents: read` with `id-token: write`.
  The rule answered `pass` and its message said no bytes reach a write token, which was false of that
  file: an `id-token` is a write token. So the write test was
  three scopes that this repository's own workflows write, not a model of a token: `checks: write` on
  pnpm's consumer was missed the same way, and `statuses: write` on node's would have been. The test
  is now any scope whose value is `write`, or `write-all`, at the level that governs the job as
  before; the message and `evidence.scopes` name every write scope the file holds, in catalog order,
  and only ones it read. Nothing else moved: the codes are the same seven, the parser is untouched,
  and the four passes answer what they answered. RED observed before the fix - the four new cases
  failed on their own assertions (`pass` where `fail` was required, and the real-pair case failing on
  the first repository's status) while the two preserved cases passed already. After the fix:
  `node --test tests/rules/workflow-run-artifact.test.js` is 19 of 19, `node --test` is 715 tests,
  714 passing, 1 skipped, 0 failing, and `node scripts/gen-golden.js` writes the same six files and
  leaves no diff. The four real answers after it: `pnpm/pnpm` `fail` (`checks: write, issues: write,
  pull-requests: write`), `nodejs/node` `fail` (`pull-requests: write, statuses: write`),
  `vercel/next.js` `fail` (`id-token: write`), `vitejs/vite` `pass / no-workflow-run`. Zero false
  positives in the four. The three consumer files are committed byte for byte under
  `tests/fixtures/workflows/real/`, because the consumer is what the finding is about; the two
  producers too large to vendor (1222 and 827 lines) are elided to the name and the trigger R13
  resolves them by, with their blob sha at the top of each. Out of scope and reported, not fixed: `nodejs/node`'s `contributor-guidance.yml`
  is refused by the reader at `WELCOME_MESSAGE: >2-`, a valid YAML indentation indicator, so the file
  is a `skip` for every rule that reads workflows. A second boundary the measurement showed:
  `pnpm/pnpm`'s `ci-performance-bencher-upload.yml` reads fork-produced artifacts with `gh run
  download` and the artifacts API inside a `run:` block, which this rule cannot see, and it holds no
  write scope, so its answer was right for a reason the rule did not read. Both are stated in the
  page's Limits.
