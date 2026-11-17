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
| T9 | `quarantine` says `manual` where it cannot clear | 361 | verify, then spec, then code |
| T10 | `exact-versions` keeps the workspace protocol | 368 | spec, then code |
| T11 | the pin that works under a frozen lockfile | 373 | spec, then code |
| T12 | the no-lockfile skip names its fact | 369 | one |
| T13 | `evidence.form` stops claiming `branch` | 377 | spec, then code |
| T14 | the scope wins for `package-manager-pin` | 398 | spec, then code |
| T15 | the permissions remediation names both shapes | 407 | one |
| T16 | the permissions pass message is true | 395 | one |
| T17 | `init --apply` writes both declarations from one pin | 353 | spec, then code |
| T18 | the quoted argument's limit is stated | 384 | one docs |
| T19 | the reader models a flow `with:` map | 405 | spec, then code |

## Log

**L1** — the owner's request, verbatim, is `S1`. It sets two constraints: nothing stays pending, and the small
fixes are decided here rather than deferred. It also names the instrument: `funky judge`.

**L2** — the triage was frozen at `1ab826b0` and judged by `jd-judge-a` and `jd-judge-b`, blind to each other,
over the same eleven questions (`C0`–`C10`).

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
