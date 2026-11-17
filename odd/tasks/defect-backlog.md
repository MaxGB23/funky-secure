# The defect backlog, decided one issue at a time

The field loop closed with twenty open defects, each carrying a reproduction. This document decides how each
one is solved, in what order, and in which pull request — and it is judged before the first line of code, the
way the loop itself was. **Two blind judges attacked it; what they broke is in the Log, and the decisions below
are the ones that survived.**

## Specs

**S1** — the owner's request, verbatim:

> continua, no deben quedar pendientes, si quedan fixes pequeños decide cómo se solucionaran. recuerda apoyarte de jueces de funky judge

**S2** — the repository's rules bind every task here: **a behaviour change starts in `docs/spec/` in its own
pull request** (so a task marked *spec + code* is **two** pull requests, never one); **one issue is one work
unit** and every pull request closes its issue; the CLI output carries symbols and never emoji; the JSON report
is the machine contract; a golden is regenerated with `node scripts/gen-golden.js`, never hand-edited; a page
that quotes a message moves in the same pull request as the message.

**S3** — `L6` of `odd/tasks/field-loop-every-rule.md` binds the remediation fixes: a printed remediation must
**clear the finding and change nothing else the author wrote**.

**S4** — a defect is closed only when a test fails for its own reason before the fix and passes after, and the
page or spec sentence that made it plausible is corrected in the same change.

**S5** — nothing is decided from reading alone. **No decision here is executed until its reproduction has been
re-run** (`T0`), because two of the twenty were wrong when the judges read them back.

**S6** — a task that touches a message names every surface that quotes it: the rule, its page, `docs/cli.md`
where it appears, and the goldens. A message fix that leaves a quoted copy behind is half a fix.

## The nineteen, and how each is solved

| # | The defect, in one line | The decision | Unit |
|---|---|---|---|
| 353 | `init --apply` can leave `packageManager` and `devEngines.packageManager` disagreeing | the guard is planned **from the same established pin W3 writes**, in the same plan; a pin the plan cannot establish plans no guard, and an existing guard is a `conflict`, never an overwrite (`commands.md` W3b). No new exit code | E |
| 354 | `no-pnpm` says `pnpm --version` did not answer while the exhausted probe was `where pnpm` | the message names the probe that actually ran, from the probe's own result. **Spec sentence first** (`rules.md:54` ties the skip to that command) | B2 |
| 359 | `foreign-lockfile` in `warn` prints `migrate --from npm --apply`, which refuses there | the finding prints the **sequence that works** (`pnpm import`, then the migrate) — not "or none", because the acceptance asks for the command | C2 |
| 360 | a warn-only run lists an action and then says `next nothing to do` | `next` names the listed action; "nothing to do" is reserved for a run that lists none. **Spec first** (`report.md:223-230` pins those bytes) | B3 |
| 361 | `quarantine`'s `auto` remediation cannot clear a hand-written declaration | **re-verified before deciding** (a judge read it as buying nothing); if it holds, the finding says `manual` for the shape `init --apply` reports as a conflict | C3 |
| 364 | `--strict-probes` escalates a skip to `status: error` while the message still begins `skipped:` | under strict the message says what the fact means at that severity; the skip wording belongs to a skip | B4 |
| 368 | `exact-versions` clears `workspace:^` by replacing it with `link:../lib`, dropping membership | the remediation preserves the workspace protocol; a range it cannot express is `manual` | C4 |
| 369 | with no lockfile, the missing-importer fact is never named | the skip names **the fact it measured**. The rejected wording ("no importer is known") is false: package.json with no lockfile also yields `floating-range` from that importer, so the sentence is scoped to what the lockfile would have said | D1 |
| 373 | the printed pin cannot clear a floating finding where `frozen-lockfile` is set | the finding is `manual` under that configuration, and the test **runs the sequence** and asserts the refusal — a static text cannot "carry" anything | C5 |
| 375 | `docs/spec/rules.md:259` promises "the exact lines to add are printed"; no command prints them | **the promise is deleted**, and the spec names what `init` prints (the managed block's entries, as a description). `init --plan` does not exist and is not invented | A |
| 377 | `evidence.form` says `branch` for a reference that names none | the field gains `none` in `docs/spec/report.md` first, then in the rule | D2 |
| 383 | the workflow remediation discards the rest of a compound `run:` step | the printed text replaces **the flag**, not the line; a step it cannot edit safely is `manual` | C1 |
| 384 | a quoted install flag is a counted false negative | **the limit is stated, not widened**: telling a quoted argument from prose needs "is this command an install", which the spec declines to decide. The page quotes both reproductions; the spec says a quoted flag is not read | F |
| 385 | `docs/spec/rules.md` R10 names two skip codes where the rule emits three | the sentence names all three | A2 |
| 390 | the `no-ci` message names a directory that may exist, in three rules | one message names the fact measured (no workflow file), in all three, with the goldens regenerated **and** `docs/cli.md:365,369` and `docs/rules/workflow-permissions.md:59` moved | B1 |
| 395 | the `workflow-permissions` pass message is false for a per-job declaration | the message names what was measured. The reproduction is **block-form** (flow steps are `unparseable-workflow`), and the assertion is rule-level, because no format prints a pass | D4 |
| 398 | the scope exclusion answers the rule's own skip code, not the scope's | **narrow**: `package-manager-pin` under an excluded scope answers `no-repo`, not `no-package-json`. `no-repo-root` keeps its own meaning and its tests | D5 |
| 405 | a flow-style `with:` map is not read at all, so the head it passes | the reader models a flow mapping **for `with:` only**, not general flow YAML | G |
| 407 | the missing-permissions remediation only names the top-level block | the remediation names both shapes: the workflow-level block and the per-job block | D3 |

## T0 — before the first fix

Every one of the nineteen reproductions is re-run and its output pasted into the Log. Two of them were already
wrong when the judges read them (#394, #395), and one decision rested on a command that does not exist
(`init --plan`). A fix aimed at a reproduction nobody re-ran is a fix aimed at a rumour.

## The order, and why

**A** first: the two spec promises (#375, #385), each its own docs pull request. They remove the pressure to
invent a command in **B** or **C**.
**B** second: the four message defects (#354, #360, #364, #390). Two of them are spec-first, so two pull
requests each; they are the cheapest closures and they make the queue easier to read.
**C** third: the destructive-remediation class (#383, #359, #361, #368, #373), each spec-first.
**D** fourth: the contract-shaped ones (#377, #398, #407, #395, #369), the two that change what a machine reads
first.
**E**, **F**, **G** last: the three that need a decision larger than a message — `init --apply`'s two
declarations, the quoted argument's stated limit, and the reader's flow mapping.

## Verification every pull request carries

`node --test`; `node scripts/gen-golden.js` when a message moves, with `git status` proving the golden changed
or did not; `node scripts/pack-guard.js`; `tests/docs-contract.test.js`; and the self-scan
`node bin/funky-secure.js scan --scope repo --fail-on warn`. A pull request that changes a message and does not
name the surfaces quoting it is not ready.

## Tasks

| ID | Task | Issues | Pull requests |
|---|---|---|---|
| T0 | re-run the nineteen reproductions | — | none (Log evidence) |
| T1 | the spec stops promising printed lines | 375 | one docs |
| T2 | R10 names three skip codes | 385 | one docs |
| T3 | the `no-ci` message, three rules, goldens and docs | 390 | one |
| T4 | `no-pnpm` names the probe that ran | 354 | spec, then code |
| T5 | `next` names the action it listed | 360 | spec, then code |
| T6 | strict probes say what they mean | 364 | one |
| T7 | the compound step keeps its other commands | 383 | spec, then code |
| T8 | `foreign-lockfile` prints a sequence that works | 359 | spec, then code |
| T9 | `quarantine` says `manual` where it cannot clear | 361 | verify, then one (`#430`) |
| T10 | `exact-versions` keeps the workspace protocol | 368 | spec, then code |
| T11 | the pin that works under a frozen lockfile | 373 | spec, then code |
| T12 | the no-lockfile skip names its fact | 369 | one |
| T13 | `evidence.form` stops claiming `branch` | 377 | one (`#428`) — `report.md` documents no `evidence.form` |
| T14 | the scope wins for `package-manager-pin` | 398 | one (`#425`) |
| T15 | the permissions remediation names both shapes | 407 | two: spec, then code (`#421`, `#423`) |
| T16 | the permissions pass message is true | 395 | one |
| T17 | `init --apply` writes both declarations from one pin | 353 | one (`#435`) |
| T18 | the quoted argument's limit is stated | 384 | one docs |
| T19 | the reader models a flow `with:` map | 405 | one (`#436`), and the stale R13 `Limits` sentence in its own spec PR (`#443`) |
| T20 | the record is repaired against a second judge round, and `L6` closes it | — | one docs (this document) |

## Log

**L1** — the owner's request, verbatim, is `S1`. It sets two constraints: nothing stays pending, and the small
fixes are decided here rather than deferred. It also names the instrument: `funky judge`.

**L2** — the triage was judged by `jd-judge-a` and `jd-judge-b`, blind to each other, over the same eleven
questions (`C0`–`C10`). The version they read was a **working copy that was never committed**, and the hash
printed for it (`1ab826b0`) names nothing: `git cat-file -t 1ab826b0` answers `Not a valid object name`, no
object in this repository begins with those bytes, and the plan as first committed (`8fea477`) hashes to
`4ffa4799…` instead. **No artifact of the pre-adjudication plan exists**, so `L3` is the only surviving
description of what the first round changed. **[Corrected: this entry said the triage "was frozen at
`1ab826b0`", which read as a surviving record. It was a hash of a working copy and nothing was frozen.]**

**L3** — the adjudication. Every finding below was checked against a run or a file, and the ones that decided a
row are marked with what proved them.
- **`#391` is closed, not pending** — spec `9fc86ca`, code `d3f52a7`; the flow form is `#405`. The count was
  wrong in the frozen plan and both judges said so.
- **`#394` was not a defect** — its own reproduction, re-run, answers a **prose** remediation, not a block
  (`{"kind":"manual","command":"replace \"permissions: write-all\" in job \"release\" with the exact scopes that
  job writes"}`). There is nothing to indent. Closed, and the real string defect beside it became **`#407`**:
  `MISSING_FIX` says "at the top level" for a job-scoped fix.
- **`#395`'s reproduction was wrong** — `steps: [{ run: echo ok }]` is flow style and yields
  `unparseable-workflow`; the false pass needs a block-form step. Re-run and confirmed: a workflow declaring
  permissions only per job answers `{"pass":1}`. The decision survives with the reproduction corrected.
- **`#398`'s decision was too wide** — `--scope machine` emits three codes (`no-repo` 9, `no-repo-root` 2,
  `no-package-json` 1). "`no-repo` for every rule" would have deleted a legitimate code and its tests. Narrowed
  to the one rule the issue names.
- **`#375`'s decision invented a command** — `init --plan` answers `unknown flag`. The promise is deleted
  instead, which is the only branch that does not replace one false promise with another.
- **`#384`'s decision would have added a false positive** — a quoted flag is only distinguishable from prose by
  deciding "is this command an install", which the spec declines. The limit is stated instead of widened.
- **`#353`'s decision could read as an overwrite** — `commands.md` W3b says an existing guard is a `conflict`,
  never an overwrite. The decision now says both declarations come from one established pin, and no guard is
  planned when the pin cannot be established.
- **Every "spec + code" row is two pull requests** — both judges cited `CONTRIBUTING.md`: the spec changes
  first, in its own pull request. The frozen plan's single "spec + code" route was a rule violation.
- **Two rows were routed as one pull request and are spec-first** — `#354` (`rules.md:54` names the probe the
  skip is tied to) and `#360` (`report.md:223-230` pins the `next` bytes). Both corrected.
- **The documentation surfaces are now named** (`S6`): `docs/cli.md:365,369` and
  `docs/rules/workflow-permissions.md:59` for `#390`, and the pages that quote a changed message for the rest.
- **`T0` exists because of the judges**: two reproductions were wrong and one decision rested on a command that
  does not exist. Nothing is fixed before it is re-run.

**L4** — `T0` re-ran the nineteen reproductions, and it paid for itself. Every reproduction was re-executed with
the binary from a `mktemp` fixture, never from the repository: **14 hold · 3 hold with a corrected
reproduction · 2 no longer hold · 0 unreachable** — nineteen, which is `T0`'s own count and the number the task
list carries. The two that no longer held are `#375` and `#385`, and they stopped holding because the batch's
own first two fixes were already in when the evidence was written: `#385` at `8d0005a` (PR `#409`, commit
`0f3bd82`, 00:10:41) and `#375` at `5aea132` (PR `#410`, commit `0a1966d`, 00:14:51), both ahead of the `T0`
evidence commit (`b06645b`, 00:23:36, merged as `150fd355` at 00:26:57). So the batch is **seventeen**, not
nineteen, and `T1`/`T2` are done.
- **`#359` needed a corrected reproduction.** The fixture must sit on a **non-default branch**: on `main` with no
  remote, `migrate --apply` refuses for the *branch* reason and masks the lockfile refusal. On a feature branch
  the issue's three lines reproduce exactly — `refusing to remove package-lock.json: pnpm-lock.yaml is absent`,
  exit 3 — and `pnpm import` followed by the migrate clears it.
- **`#373` needed its trigger corrected.** `.npmrc` `frozen-lockfile=true` is **ignored by pnpm 12.3.4**
  (`pnpm config get frozen-lockfile` answers `undefined`). The trigger is `CI=true`, which produces
  `ERR_PNPM_OUTDATED_LOCKFILE` and exit 1, while `pnpm install --lockfile-only` under the same `CI=true` exits 0.
- **`#395` is confirmed and its snippet corrected**: flow-style `steps:` yields `unparseable-workflow`; the
  block-form step yields `pass: 1` with the returned message `every workflow declares permissions:, and none
  grants write-all…` for a per-job-only declaration.
- **`#390`'s line numbers drifted**: the three strings are at `src/rules/pull-request-target.js:197`,
  `src/rules/workflow-run-artifact.js:236` and `src/rules/workflow-permissions.js:129`, with three goldens and
  `docs/cli.md:365,369` and `docs/rules/workflow-permissions.md:59` carrying them.
- **`#353` is worse than filed**: `init --apply` exits **0** while writing `packageManager: pnpm@12.3.4` beside a
  `devEngines.packageManager` of `12.16.0`, and `src/lib/writers.js:601` still says the pair is "never written
  disagreeing". A test that asserts the pair agrees would pass today on the exit code alone; the assertion is
  the two values.
- **`#361` is confirmed with the file untouched**: `init --apply` prints the conflict and exits 0, the workspace
  file's sha does not move, and the finding stands. The `auto` remediation cannot clear the shape it most often
  meets.
- **The measurement did not touch the repository**: `git status --porcelain` was empty before and after, `HEAD`
  unchanged, and the tree's sha identical — after an earlier attempt had overwritten `package.json` by running an
  applying command from the repository root. The lesson is now a rule for every task here: **an applying command
  runs with its `cwd` inside a fixture, never inside the repository being delivered.** **[Corrected: this entry
  opened by saying `T0` "ran before the first fix" and gave `5aea132` as the merge for both closed issues. The
  record's own timestamps put both `A` fixes ahead of the `T0` evidence, and `#385` merged at `8d0005a`; without
  both, "2 no longer hold" contradicted "before the first fix".]**

**L5** — `T21`, the review debt, measured rather than assumed. Seven delivered slices were assessed with an
explicit base (`gentle-ai review assess --base-ref <the merge's first parent> --committed-only --json`), chosen
for being the ones that touched a security rule or a shared reader: `actions-pinned-sha` (`#379`),
`workflow-run-artifact` (`#401`), `pull-request-target` (`#406`), the collector (`#356`), `lockfile-committed`
(`#351`), `ci-no-safety-overrides` (`#386`) and `no-bot-auto-merge` (`#381`). **All seven answered
`review_due: false`, reason `under_budget`, risk `medium`.**

**The `changed` column is withdrawn.** This entry carried one — 44 paths / 4 333 lines for the first slice and
figures of that order for the other six — and **the run that produced it cannot be reproduced from this
repository**: no artifact of the seven `assess` runs survives (no receipt, no state file, and
`grep -rl under_budget .git` answers nothing), and re-measuring the same slices with
`git diff --shortstat <merge>^1 <merge>` does not produce those numbers. The seven measure between 2 and 5
paths and between 182 and 525 changed lines each, which is enough to show the column was wrong by about ten
times and not enough to restore a per-slice figure the run no longer supports. **What stands is the verdict:**
seven slices were assessed and no review was due for any of them. **[Corrected: the table was withdrawn for the
reason stated, not replaced with other numbers.]**

**No review was due for any candidate**, which is the fact the omission denied me: skipping `assess` left
"nothing was owed" as an assumption for twenty pull requests. It was owed nothing, and now that is measured.
- **The `due review` the gate reported was about something else.** When the delivery preflight ran out of its
  10 s budget it was projecting a **retained base 90 commits behind `HEAD`**, not a slice; with a large enough
  budget that same range denies with *"Native assessment reports a due review"*. So the message was true of the
  accumulated branch and never true of a candidate. Two different objects with one word.
- **What the debt actually was, then, is procedural and it stays recorded**: the contract asks for `assess` per
  candidate before reporting work complete, and this batch did not do it. The cost of the omission is the hour
  spent reading a timeout as an authority problem — not a review that should have run.
- **The cure is now in `AGENTS.md`**, under *Review authority (RDD)*: `assess` is the cheap step and the one
  that gets skipped; skipping it does not light up the gate, because the preflight checks that the switch is on,
  not that a review happened. And a `cancelled or timed out` refusal is the clock, not authority: the preflight
  projects the **retained** base, its cost grows with `base..HEAD`, and the cure is to seat a narrow base with
  `assess {"baseRef":"<current tip>","committedOnly":true}` before issuing the delivery again.

**L6** — the batch closed **twenty-two issues: twenty-one fixed, one refuted.** The set is the plan's nineteen
rows, plus `#391`, whose spec and code landed before the plan was written (`9fc86ca`, `d3f52a7`), plus
`#414`; `#394` is the refuted one. `#378` and `#400` are **not** in it: both are field-loop slices that closed
before the plan existed, by the pull requests `#379` and `#401`, and a record that counts a pull request as an
issue is the same error as counting a pass on a file nobody read.

**What `S2` actually cost.** Eight of the twenty-one needed a spec PR and then a code PR: `#391`
(`#404`→`#406`), `#354` (`#412`→`#418`), `#360` (`#413`→`#417`), `#359` (`#424`→`#427`), `#383`
(`#419`→`#422`), `#407` (`#421`→`#423`), `#368` (`#433`→`#434`) and `#373` (`#437`→`#438`). **Four were
documentation only**, and the contract or the page was the whole change: `#375` (`0a1966d`), `#385` (`0f3bd82`),
`#414` (`da9e547`) and `#384` (`3079794`), whose spec PR stated a limit rather than correcting a sentence. **Nine
landed in code alone**: `#353` (`#435`), `#361` (`#430`), `#364` (`#416`), `#369` (`#431`), `#377` (`#428`),
`#390` (`#415`), `#395` (`#426`), `#398` (`#425`) and `#405` (`#436`) — with one qualification that is `T19`'s:
`#436` left §8.2 R13 saying a flow `with:` map was "invisible to the reader today", and that sentence moved in
its own spec PR (`#443`, branch `docs/spec-flow-with`), so the ninth pair is real but arrived after the count.
Every figure above is one
`gh issue view <n> --json closedByPullRequestsReferences` and one `git diff --name-only <merge>^1 <merge>`: the
four documentation-only PRs close their issue themselves, and each pair is a `Refs` spec PR followed by the code
PR that closes it — `#437` is the one spec PR that also says `Closes`, which is why `#373` names two.

**What the routing column recorded.** The plan sends eleven rows spec-first. Seven landed that way — `T4`, `T5`,
`T7`, `T8`, `T10`, `T11` and `T15` — and `T15` is the row that was routed as **one** pull request and was
**two** (`#421`, then `#423`). `T9` was routed `verify, then spec, then code` and landed as the verification then
one code PR (`#430`): `T0` confirmed it and no spec sentence moved. Four rows routed spec-first landed in code
alone, because there was no spec sentence to move: `T13`/`#377` (`report.md` documents no `evidence.form` at
all), `T14`/`#398` (`#425`), `T17`/`#353` (`#435`) and `T19`/`#405` (`#436`, with the spec sentence following in
`#443`). The plan's `C` line says all five of its class are spec-first; four of the five were, and `#361` is
the one that was not.

**What the fixes were, once each.** Seven were a **remediation that cannot clear, or clears by destroying
something else**: `#383` replaced a whole `run:` body and lost `pnpm build` beside the flag, `#359` printed a
migrate that refuses in the state it was printed for, `#361` said `auto` where the writer refuses the file,
`#368` replaced `workspace:^` with `link:../lib` and dropped the membership, `#373` printed a pin that cannot
clear under a declared freeze, `#353` wrote one declaration while its guard conflicted, and `#407` named only
the workflow-level block — the shape whose widening, in `#423`'s own words, "would grant that scope to every
job". Eight were a **message, field or skip code that named a fact it had not measured**: `#354` a probe that
never ran, `#360` "nothing to do" after listing an action, `#364` `skipped:` under an `error`, `#369` a fact
never named without a lockfile, `#377` `form: branch` for a reference that names no ref, `#390` a directory
where the missing thing is a file, `#395` a pass sentence false for a per-job declaration, `#398` the rule's
`no-package-json` for a scope that excluded the repository. Two were a **detection that missed a spelling**,
with opposite dispositions: `#391` reads `refs/pull/<n>/head`, its `…/merge` sibling and `gh pr checkout <n>`
and reports them (spec `#404`, code `#406`), and `#384` **states the limit** instead of widening the rule
(`#429`), because telling an argument from prose means deciding what the command is. One was a **reader that
dropped input and counted a pass**: `#405`, whose
`with: { … }` map answered an empty map and a pass. Three were a **spec sentence false on its face**: `#375`
promised printed lines no command prints, `#385` named two skip codes where the rule emits three, `#414` sent a
strict-probe failure to exit `2` where the binary answers `1`. `#394` is in none of them: it was refuted, and it
is the reason `T0` exists.

**`#368` was an omission, not a contradiction.** The batch's first reading was that R5's own Remediation
prescribed the `link:` value its Detection forbade. It did not: `git grep -n "link:" c18a75c -- docs/spec/`
answers nothing, and the word enters `docs/spec/rules.md` for the first time with `#433` (`423d26e`) — as the
value to avoid. The spec was **silent** on which spelling an internal range becomes while the rule wrote
`link:../lib`, so what the spec PR corrected was a gap in the contract, not a spec contradicting itself.

**Four decisions were refuted, each by someone other than the person who took it.** `#394` was **not a defect**
— its remediation is prose and there is nothing to indent, so its own reproduction could not hold and it closed
as written (`L3`). `#395`'s reproduction used a flow `steps:` map, which is `unparseable-workflow`, so the
failure it described was not the failure it had. `#398`'s first shape answered `no-repo` for **every** rule and
would have deleted a legitimate `no-repo-root`; the final shape answers `no-repo` only where the scope excluded
the repository. `#375`'s decision named `init --plan`, a flag `src/commands/init.js` does not declare —
`init` without `--apply` already prints the plan. And two routings inverted after the batch started: `#377` was
routed spec-first although the spec documents no `evidence.form`, and `#368` was routed as code until the spec
was read and found silent, which is the omission above and not a contradiction.

**`#373` refuted its own brief twice before a line was written.** The worker stopped, measured, and brought
back a table: `.npmrc`'s `frozen-lockfile` is a spelling pnpm 12.3.4 ignores, `CI=true` is a machine fact a
repo-scoped rule cannot see and must not see, and the freeze a repository *declares* in `pnpm-workspace.yaml`
is visible — but `pnpm install --lockfile-only`, the brief's own offered cure, refuses there too. The only route
that works anywhere carries `--no-frozen-lockfile`, the flag `R10` exists to report, so the finding prints the
hand edit and no command. A one-line cure became a spec amendment (`#437`), a measured table and `I-83`.

**`T21` measured the review debt instead of assuming it** — `L5`, whose size table is withdrawn there. Seven
slices, each assessed against its own base: `review_due: false`, reason `under_budget`, risk `medium`, for all
seven. No review was due for any candidate; the "due review" the delivery gate reported was about the retained
base ninety commits behind `HEAD`, never about a slice. The debt was procedural and it is now a rule in the
global `AGENTS.md`.

**`T0` re-ran every reproduction** (`L4`): fourteen held, three needed a corrected reproduction (`#359` on a
non-default branch, `#373` under `CI=true`, `#395` in block form), two no longer held because `A` had already
landed (`#375`, `#385`), and none was unreachable — nineteen in all, which is `T0`'s own count. One of the three,
`#395`, had described a failure it did not have; `#394` was not a defect at all; and one decision rested on a
command that does not exist. **A reproduction is evidence only after it has been re-run.**

**What the second round changed in this document, and why.** A second judge round read this record and was right
about five of its claims: the split in `L6` said thirteen pairs and nine documentation-only where the pull
requests show eight and four, the routing column sent eleven rows through a spec PR where four of them never had
one and one had two, `L5`'s `changed` column carried sizes about ten times the slices they described from a run
no artifact supports, `L2`'s frozen hash named an object that is not in the repository, and `L4`'s "before the
first fix" denied the order its own commits carry. The routing rows and the counts are corrected where they
were written, the size table is withdrawn rather than restated, and `#368`'s story is the omission its own
`git grep` proves. Leaving any of them would have been the defect this batch was closed to fix — a record
asserting what it had not measured — and a document that survives a judge unchanged is not a record.
