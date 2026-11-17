# The next release's backlog: six issues, two documentation debts, one review finding

Close every issue and identified defect the owner scoped to the next release, one candidate at a time,
each with its plan judged before code and its claims judged after CI. Sources: issues #133, #119, #135,
#139, #266, #134; native-review finding R2-001; the two `docs/validation.md` debts of the 2026-11-15 audit.

## Specs

- **S1** The owner's instruction: "Quiero ir atacando todos los pendientes uno por uno. Haremos odd con rdd."
  And on granularity: "iremos issue por issue para llevar mejor control."
- **S2** Scope, in the owner's words from the session that produced this list: "La idea es que la proxima
  release, todos los issues y fallos que hayamos identificado queden cubiertos." No open issue and no
  identified defect is left over.
- **S3** Instrument, in the owner's words: "Para cada issue delegaremos funky-judge para que nos ayude a ver
  si nuestro plan es correcto por issue, incluso para refutar nuestro plan, y despues cuando la pr de un
  issue esté lista, el judge detectará si cosas son falsas o están mal." And the refinement: "judge cuando
  sea necesario, como validar un plan o tareas del odd antes de implementar. Y para atacar afirmaciones, ya
  que los jueces el 100% de las veces han detectado afirmaciones falsas."
- **S4** Two instruments, one gate. `funky-judge` reviews an artifact — a plan, the task list of this
  document, a set of claims — and returns findings only. The native 4R review reviews a diff, and only a
  **consumed** review of the exact pushed range gates delivery. A judge's approval never substitutes for it,
  and no candidate merges with red checks.
- **S5** Repository policy: a behaviour change starts in `docs/spec/` in its own pull request. This is not a
  style preference — `AGENTS.md` states it — so a task whose behaviour changes ships a spec pull request
  before its code pull request, and a task that only restates what the spec already decides ships one.
- **S6** The four unverified leftovers are not facts. "Verificar antes de asignarles alcance, no asumir que
  siguen abiertos": each is decided by evidence before it becomes a task.
- **S7** #133 — the skip is right, the sentence is not: "So the skip is defensible and the sentence is not.
  'This repository is not on pnpm' is a claim about the repository; 'the manifest still declares npm' is a
  claim about the manifest, and it is the one the tool can support." And: "The message, not the status."
  The conditional resolves to **no specification pull request**: the string does not appear anywhere in
  `docs/spec/` (read, not assumed), and `docs/spec/rules.md:47-49` already scopes `not-pnpm` to a declaration
  naming another manager. What the string does reach is `src/rules/package-manager-pin.js:228` (the message),
  `tests/golden/pinned-conflict.json:50` (the exact message, so a golden regeneration) and
  `docs/rules/package-manager-pin.md:41`, which quotes the sentence in prose and goes stale with it. T1
  therefore names three artifacts and no spec page. The second question in the issue — whether such a pin
  deserves more than a `skip` — is a record, and S22 is where it is named.
- **S8** #119 — the behaviour is the specified one and does not change. The guard-first order **is already
  normative** at `docs/spec/rules.md:77-90` (a guard that differs is `skip` with `self-managed-pin` "whatever
  pnpm answers", and a guard declaring no `version` is not equal to a pin that declares one), and
  `src/rules/package-manager-pin.js:244-249` implements it. What is missing is not a second rule: `:49` states
  the unversioned pin fails without naming that the guard branch is read first, so a reader of `:49` alone
  reaches the opposite answer for this shape. The clause is therefore a **cross-reference to `:77`**, never a
  restatement, and the issue says it in its own words: "needs the clause that the guard branch is read first,
  or the two sentences stay reconcilable only by reading both." The test claim was re-read and holds: every
  `self-managed-pin` test declares a **versioned** pin (`tests/rules/package-manager-pin.test.js:136-203`)
  and the only `pin-unversioned` test carries no guard, so no test pins the intersection.
- **S9** #135 — the issue names two ways out and does not choose: "Either the line says what the tool knows —
  the lockfile is already there, so this step is satisfied — or it names its condition the way every other
  printed step in this tool does." The condition the issue proposes is itself imprecise: the print condition
  today is any foreign lockfile, not the absence of `pnpm-lock.yaml`. The task decides the wording and the
  spec row with it.
- **S10** #139 — the two ways out, and the reason to prefer the first: "Either the printed step names the
  consequence ('if the manifest already declares it, this commit has nothing to do'), or the step merges with
  the closing commit for this branch of the path... The second contradicts 0016's rule that a commit names
  what it covers, so the first is probably the honest one — but it is a spec sentence, not a code change."
- **S11** #266 — three deliverables: the reader honours the indicator, "A test over `WELCOME_MESSAGE: >2-`
  asserting the file parses and the value is read as the scalar it is", and one line listing which
  block-scalar spellings the subset accepts. The audit narrows the premise: `BLOCK_SCALAR` at
  `src/lib/workflows.js:50` already accepts the indicator, while `readBlockScalar` (`:320-344`) ignores it and
  takes the first body line's indent. The sentence the issue's audit attributes to the reader header is not
  there — `src/lib/workflows.js:15-18` lists **refused** shapes, including a `uses:` block scalar — so the line
  to move is `docs/spec/rules.md:266`, and that misquote is corrected here rather than repeated. Acceptance is
  the whole of what the issue asks, not the part a fixture can satisfy: a fixture in the `>2-` shape proves the
  value is read and the CI rules answer on it, because `nodejs/node` is not in this tree and the tool never
  touches the network, and every existing block-scalar test still passes, **including the ones that pin the
  refusal of a shape the subset deliberately does not model**.
- **S12** #134 — the three claims that do not reconcile, and its own scope statement: "Whether the verdict
  line should carry a coverage caveat, whether `next` should name the six rules or only say 'nothing to do in
  the enabled set', or whether the per-target breakdown should list every rule, is presentation and belongs to
  a record if it changes what `PASS` means. The counter labels are the cheapest part and the clearer defect."
  Acceptance is **all three**, not the caveat alone: `0 skipped` must stop sitting beside rules that never ran
  (`src/lib/render-human.js:462`), `next` must be scoped to the enabled set (`:517`), and a reduced policy must
  stop reading as a clean repository (`:393`). Two figures the audit fixes and two it leaves conditional: the
  line reads `6 of 13` with seven labels (`tests/report.test.js:692-700,735`), and the sixth passing rule is
  `exact-versions` with `targets: ['importer']` (`src/rules/exact-versions.js:307`) whose pass carries no
  `path` — which the renderer **drops only when the importer block resolves to paths**
  (`src/lib/render-human.js:270-282`) and keeps when it does not. T8 measures which happens on a real run
  before it claims either.
- **S13** R2-001 — the probe fixture is built from the constant the judgement reads, never from a copied
  literal: "Editing that constant would make the fixture and the judgement disagree, which fails loudly on
  the next run rather than passing quietly."
- **S14** Debt (a) — `docs/validation.md` states `737 tests, 736 pass, 1 skipped` while the audit measured the
  tree at `739 / 738 / 1`. The second figure is **the task's measurement, not a settled fact**: T12 runs the
  suite and reads the totals before it decides anything. What is settled is that nothing catches the drift.
  "The honest fix is not a better number typed by hand: either the row stops carrying a count... or a test
  derives it from a fact the run can read, and a number nothing checks is the mistake the page's own last
  section is about."
- **S15** Debt (b) — the rule table measures one side only on real repositories for five of thirteen rules:
  `foreign-lockfile`, `quarantine`, `exact-versions`, `actions-pinned-sha`, `workflow-permissions`. Either a
  clone sweep finds a repository where each passes, or the residual declaration says so.
- **S16** Delivery gates, per candidate, all of them: `node --test`, `node scripts/gen-golden.js` when the
  report changes on purpose, `node scripts/pack-guard.js`, the self-scan, `node scripts/check-pr-policy.js`
  before the push, and a merge only on `gh pr checks <n> --json state` with no state outside `SUCCESS`,
  `SKIPPED` and `NEUTRAL`.
- **S17** No issue is closed on a partial reading. Each task closes when the acceptance its issue states is
  demonstrated, not when the code "looks right"; a task whose acceptance cannot be demonstrated says so and
  stays open.
- **S18** Every line reference in this document was re-read at `main` `9d7569f` after the first blind review,
  and **four of them were wrong at the commit they claimed to describe** — this is not drift, it is an unread
  citation. So the rule is stronger than "re-confirm before the first edit": a task may rely on no citation it
  has not read itself, and the four corrected here (`renderSkipped`, `renderBlock`, the `applyPlan` zero-write
  return, the `unsupported-glob` range) are the evidence that the rest are not inherited truths either.
- **S19** The renderer emits two consecutive blank lines when one target block carries exactly one failing
  rule and exactly one skipped rule: `renderSkipped` (`src/lib/render-human.js:184-197`) returns a group that
  opens with `''` (`:186-187`) and `renderBlock` (`:225`) pushes its own separator between groups (`:243-246`),
  so the second blank line has no owner. Presentation only — `AGENTS.md` puts the human text outside the
  machine contract — so no spec page moves; one test pins the spacing, and T7 is the task with no other
  evidence, so its first read is the renderer itself.
- **S20** A `packages:` negation such as `!**/test/**` is **not modelled and not reported**. The pattern fails
  the shape test as `unsupported-glob` (`src/lib/targets.js:157-166`: the test at `:157`, the skip at `:162`;
  `:147-156` is the `outside-root` branch), is collected at `:307-312` and is then dropped by `exact-versions`
  (`src/rules/exact-versions.js:488-493`) with the reasoning that "saying its directories are not read would be
  false" — which is right, and leaves the opposite fact unstated: the directories *are* read, so the read set
  exceeds what the manifest declares. Scope is the honest report, not a negation model: modelling negation is
  new workspace semantics and belongs to its own record, out of this campaign. The report change is additive
  to a list, so it is not a contract removal, but it changes what the tool says it covered, and it ships with
  its spec sentence.
- **S21** A plan of `init --apply` whose items are all conflicts refuses everything and exits `0`. The record
  names the gap in its own words (`docs/decisions.md:103`, I-58): "The exit code stays `0` because
  `init --apply` writes the other items of the plan… a conflicted plan that refuses everything is a contract
  change and is left to its own record." That record does not exist. The **code value** is not open: the spec
  defines `3` as "a refusal — understood, refused, nothing written" (`docs/spec/README.md:73`, restated at
  `:98`, `docs/spec/report.md:224`), so honouring it is the specified answer and the record states it; whether
  to ship the change is the owner's, and S22 keeps that distinction. The behaviour lives at
  `src/commands/init.js:83` (the guard skips the early path when a conflict exists) and at
  `src/lib/plan.js:291-293` (`return 0` for a zero-write plan). The test surface is wider than the audit said:
  `tests/init.test.js` pins `init --apply` exit codes at `:441`, `:468`, `:539` and `:593`, and T10 reads each
  before writing, because one of them may be the zero-write case and then it is the assertion the task
  changes.
- **S22** Two questions the release does not answer, named so that S2 stays honest: whether a pin the tool
  never rewrites deserves more than a `skip` in a repository it just migrated (#133 defers it "to a record"),
  and whether to prune the 121 merged remote branches and drop `stash@{0}`. Both are the owner's decisions,
  both are recorded here, and neither is a task. "Nothing left over" means every reported defect closes; a
  design question an issue explicitly defers is named, never silently dropped.

## Tasks

- **T0** Verify the four leftovers with evidence before scoping them — S6, S18. Route: one read-only
  explorer, `path:line` evidence, no repository change. Commit: none.
- **T1** #133 — the skip sentence becomes a claim about the manifest, in the message, the golden and the page
  that quotes it — S7. Spec: none (the string is absent from `docs/spec/`, confirmed). Judge: the claims after
  CI. Commit: 1baf94d (PR #283)
- **T2** #119 — the cross-reference at §8.2 R1 `:49` plus the intersection test, no behaviour change — S8.
  Spec: this is the specification pull request. Judge: plan, LIGHT. Commit: —
- **T3** #135 — the human step reports the lockfile it depends on and names the criterion it cannot
  evaluate, never declaring the step done — S9. Spec: **its own pull request first** (the row and its
  condition), then the code. Judge: plan, LIGHT, on the committed specification. Commit: 7e33049 (spec,
  PR #285) and 399c4d1 (code, PR #286); #135 stays open by design.
- **T4** #139 — the printed step names its consequence — S10. Spec: with it. Judge: claims after CI.
  Commit: `a3aacc4` (spec, PR #287) and `04d3ec0` (code, PR #288); #139 closed. The second judged round
  on the specification produced T14.
- **T5** #266 — `readBlockScalar` honours the indicator, with the `>2-` fixture and the accepted spellings —
  S11. Acceptance includes the issue's first line, proven by the fixture because the real file is not
  retrievable here, and every existing block-scalar test, including the refusal ones. Spec: with it. Judge:
  claims after CI. Commit: —
- **T6** R2-001 — the probe fixture is built from the constant — S13. Spec: none. Judge: none. Commit: —
- **T7** The renderer stops emitting two blank lines for one fail plus one skip — S19. Spec: none.
  Judge: none (a spacing test is the proof). Commit: `fda4a0d` (PR #293); issue #292 opened and closed with it.
- **T8** #134 — the verdict block stops implying a coverage it did not measure, in the order that keeps each
  slice a record: (a) `next` names the set it speaks for when a rule is off; (b) the `summary` counter
  vocabulary and the pathless passing rule. Spec: the page that defines the report. Judge: plan, STANDARD.
  Commit: —
- **T15a** #134, the counter — `docs/spec/report.md:85` said `summary` "counts every rule verdict
  exactly once" and the sentence after it counted failing *findings*; the code counts findings for all
  five statuses (`src/lib/report.js:115-126`), so the first clause was false and `3 skipped` read as
  coverage. Owner decision (L15): the spec tells the truth and `PASS` is not touched. Spec: 10.2 and the
  `cli.md` capture that shows it. Commit: —
- **T15b** #134, the invisible pass — **landed**: spec `8df1a96` (#317), code `2ed897d` (merge `1d6c9a7`, #318), decision row I-81. A pathless passing finding is counted in a block of its target, headed by the kind alone; blocks sum to `summary.pass`. The failing half is measured, not deferred: `exact-versions` is the only `targets: ['importer']` rule and both its fail sites carry a path.
- **T9** The unmodelled `packages:` negation is reported instead of dropped — **landed**: RFC 0036 (`74f92a8`), code `8064ca5` (#300), and the follow-up `#301`→`72a8a96` (#302) that replaced "its directories are still read" with "it excludes nothing", true outside the root too.
- **T10** A conflict-only `init --apply` exits `3`, with the record that says so — **landed**: RFC 0037 (`70586a2`), code `3791a2f` (#305), and `#306`→`d40e5b5` (#308) where the refusal now ends with the `funky-secure:`/`reason:` lines every refusal uses. Exit codes are consumed by scripts, so the record came first.
- **T11** Debt (b) — the five one-sided rules are measured or declared — S15. **Still open.** Spec: the page itself. Judge: plan, before the sweep. Commit: —
- **T12** Debt (a) — the count either leaves the row or is derived by a test — **landed**: `21d76ce` (#316), 737 → 765 measured against the finished suite, which is why it was the campaign's last task.
- **T13** The `--apply` refusal tells the reader to run `pnpm install`, while step 3 of the same plan exists
  because `install` discards the foreign pins (0021) — **landed** as `#309`→`b80f02c` (#311). The first
  fix named `install --lockfile-only`, and the audit showed the safe step for that state is `pnpm import`:
  it reads the foreign file. `IMPORT_STEP` now lives beside `LOCKFILE_ONLY_STEP`, shared with the plan.
- **T14** Step 14 hands the lockfile the add writes to the closing commit (row 15) — **closed as invalid
  (2026-11-16).** A claim audit of #312 refuted the premise: `src/commands/start.js:230` prints the closing
  commit when the lockfile is missing, and `tests/start.test.js:405-414` already pinned it. Issue #310
  closed, PR #312 closed unmerged. What survived is the wording that made it plausible — row 15 said "for
  one that is present" while the code answers `status !== 'pass'` — fixed in #313 (`c0da664`).

**Why this order.** T1 first because it is one message, one golden and one page line, and it takes the whole
path from issue to merged pull request on the cheapest candidate. T2 follows: it is the only task that ships a
specification and no code. T3 and T4 are the two printed-step tasks (`migrate` and `start`) and share the
question of how a printed step names its own condition. T5 is the only task that needs a shape the tree does
not contain. T6 is one constant. T7 before T8 because both rewrite `src/lib/render-human.js` and the smaller
edit goes first, so the invasive one lands on a settled file. T9 and T10 each add a surface a script can read,
so they follow the presentation work. T11 needs a clone sweep, the one task with external work. T12 is last
because its count must be measured against the final suite.

## Leftovers verified (T0, closed)

All four were checked with `path:line` evidence on `main` `9d7569f`. Three are real and became tasks above;
the fourth produced one owner decision and no code.

- **Conflicted `init --apply` exits `0`** — real, and narrower than "no record": I-58 names the gap itself.
  Became **T10** (S21).
- **`packages:` negation is silently dropped** — real and worse than described: it neither applies nor
  rejects, and because the excluded directories are read anyway, the read set exceeds the manifest.
  Became **T9** (S20).
- **Double blank line, one fail plus one skip** — real and reachable, not fixed, and no golden could ever
  show it. Became **T7** (S19).
- **Branches and stash** — inventory, not a defect, and no code task. `git branch -r --merged main` lists
  **121** remote branches; three are unmerged (`origin/chore/t1-path-evidence`,
  `origin/docs/readme-three-commands`, `origin/fix/canonical-working-directory`). `stash@{0}` is the only
  stash and it is the **pre-0.1 snapshot of the whole tool** (85 files, 7242 insertions, including
  `src/lib/writers.js` and all nine rules), parked on `review/s1`, a branch that no longer exists. Pruning
  branches and dropping a stash are destructive and belong to the owner, not to this campaign:
  **one decision, no task**.

## Log

- **L1** Owner, session that produced this list: "Guarda en memoria todos los pendientes que quedan. La idea
  es que la proxima release, todos los issues y fallos que hayamos identificado queden cubiertos. Guarda igual
  la estrategia de apoyarnos en fu[…]" (the captured prompt is truncated at that point).
- **L2** Owner: "Quiero ir atacando todos los pendientes uno por uno. Haremos odd con rdd. Para cada issue
  delegaremos funky-judge para que nos ayude a ver si nuestro plan es correcto por issue, incluso para
  refutar nuestro plan, y despues cuando la pr de un issue esté lista, el judge detectará si cosas son falsas
  o están mal. No sé qué te parezca este flujo o tiene algo mas que decirme"
- **L3** Owner: "dale, judge cuando sea necesario, como validar un plan o tareas del odd antes de implementar.
  Y para atacar afirmaciones, ya que los jueces el 100% de las veces han detectado afirmaciones falsas, tu
  plan tiene sentido. Iniciemos. SI van surgiendo dudas las iremos atacando, iremos issue por issue para
  llevar mejor control. Pero antes debemos delegar una exploracion para los restos sin verificar, para que el
  plan sea correcto, arranquemos"
- **L4** Evidence opening the campaign: `main` at `9d7569f`, clean tree, no candidate in flight; the six
  issues open with their audit sections recorded against `49114b5`; the audit of this list taken against
  `9d7569f`.
- **L5** T0 evidence, from one read-only explorer and three closing reads, **all re-read after the judge round**:
  a conflicted `init --apply` exits `0` (`src/commands/init.js:83` skips the early path when `conflicts`,
  `src/lib/plan.js:291-293` returns `0` for a zero-write plan); I-58 at `docs/decisions.md:103` leaves the
  all-conflict case to its own record. `!**/test/**` fails the shape test (`src/lib/targets.js:157-166`), is
  collected at `:307-312` and dropped at `src/rules/exact-versions.js:488-493`. Two blank lines come from
  `renderSkipped` (`src/lib/render-human.js:184-197`, blank at `:186-187`) plus the separator in `renderBlock`
  (`:243-246`); `grep` finds no test pinning human spacing. `git branch -r --merged main` = 121; unmerged = 3;
  `git stash show --stat` = 85 files, 7242 insertions.
- **L6** Scope growth, recorded rather than assumed: the owner's standing rule is that no identified defect is
  left over, so the three real leftovers entered the campaign as T7, T9 and T10. The exit-code value was never
  open — the spec fixes `3` — so T10 writes the missing record and honours a contract that already exists;
  whether the change ships in this release is the owner's (S22). The branch pruning and the stash became one
  owner decision and no task.
- **L7** First judge round, STANDARD, two blind judges on the frozen artifact (`6445a757…`, 178 lines), both
  hash-verified. They **independently refuted the same four citations** (`renderSkipped`, `renderBlock`, the
  `applyPlan` zero-write return, the `unsupported-glob` range); both found that #133's string reaches
  `docs/rules/package-manager-pin.md:41` and the golden with no task touching them; both found that T5 and T8
  could pass without closing their issue; both found that #133's deferred question had no task and no owner
  row. They **disagreed on #119**: judge A held that `:49` needs its clause, judge B that `:77-90` already
  decides the intersection and that a clause at `:49` would be a second normative statement. The adjudication
  is S8: B is right that no rule is new, A is right that `:49` alone reaches the opposite answer, so the
  clause is a cross-reference and never a restatement. Judge B closed its own residual gap by asking the right
  question — does a test already cover an unversioned pin with a versioned guard — and the answer, read at
  `tests/rules/package-manager-pin.test.js:136-203`, is no. Corrections: S7, S8, S11, S12, S14, S18, S19, S20,
  S21, new S22, T1, T2, T5, T8, T10, and this entry. Neither judge reviews its own correction.
- **L8** T1 landed: PR #283 merged as `1baf94d`, #133 closed as completed. Three commits, and the third
  exists because the blind claim judge found that the page still said "a repository deliberately on
  another manager" at `:128`, and that the test's comment attributed to RFCs 0018/0020 a rule that lives at
  `docs/spec/commands.md:51`. It confirmed six of seven claims and refused to certify the gates it was
  forbidden to run, which is the honest answer. `funky-judge-protocol` was written from this round.
- **L9** T2 landed: PR #284 merged as `745881b`, #119 closed. One judged round refuted the first version
  of the clause on substance, not style: it restated the ordering the guard order already states, and its
  "answered by that comparison" was false for a pin that names another manager (which returns before the
  guard is read) and for a versioned pin whose guard is equal. The row now says only what it does not
  decide. Two positional claims of mine were also false — "nine lines later" in the bodies of #283 and
  #284, where the measured distances are 106 and 31 — and both bodies now carry the correction; a pushed
  commit message cannot be corrected without rewriting history, so the body is the record.
- **L10** T3's specification took two judged rounds and both found it wrong, in different ways. The first
  refused "step 3 is satisfied when `pnpm-lock.yaml` exists", because a lockfile resolved from the manifest
  does not carry the foreign pins — the harm 0021 forbids — so the declaration would drop the only route that
  keeps them. The second refused the replacement for underspecifying the output (which branches print, the
  added line, its position relative to the flag line) and for adding a criterion no record sources. The row
  now prints the command in both branches, adds one line when the lockfile is present, names the criterion,
  and claims no status: only an import carries those pins, and this command does not compare the two files.
  The second round also surfaced **T13** — the `--apply` refusal recommends `pnpm install`, the command the
  same plan's step 3 says discards the pins. Two judged rounds is the cap; a third would be the owner's call.
- **L11** T3 landed in two pull requests: `7e33049` the specification (PR #285) and `399c4d1` the code
  (PR #286). **#135 stays open**, and the pull request says `Refs` rather than `Closes`: the issue's title
  is that the step is printed at all, and withholding it needs a comparison this command does not compute.
  Both exits the issue offered were unsafe — "satisfied" would drop the only route that keeps the foreign
  pins, and its own proposed condition (absence) is the same trap — so the comment on the issue records
  what landed and what remains, as a product decision. A sibling instance became T13.
- **L12** T4's specification took two judged rounds and both blocked it, and both times the defect was the same
  in a smaller form: the row promised a state it also said the plan could not know. The first round refused
  that, the widening of 0016's scoped rule into a path invariant, a claim about what `pnpm add` writes that
  the specification does not carry, and an output slot named nowhere. The second refused the appended
  retraction, an element that both existed and did not grow the list, and prose that still promised a clean
  tree. The change moved to where the element is defined: §11.7 now carries one line for a step whose outcome
  depends on a choice the plan cannot see, and the row points at it instead of arguing it in a cell. Two
  judged rounds is the cap; this revision is the owner's decision, not a judged one. The second round also
  produced T14, a pre-existing defect the row had been leaning on.
- **L13** T4 landed in `a3aacc4` (specification, PR #287) and `04d3ec0` (code, PR #288); #139 closed. Two
  judged rounds refused the specification, and the decision moved out of the table cell into a new §11.7
  element. The claim judge on the code found two advisories worth taking: `docs/cli.md` had not moved with
  the command, which `docs/README.md` binds, and the printed sentence said "declares it" with no
  antecedent in the line — both fixed in `0c3f866`.
- **L14** T7 landed in `fda4a0d` (PR #293), and it began by opening issue #292: the defect was found in the
  T0 verification and had no issue of its own, and this repository's pull requests need one. The renderer's
  separator and `renderSkipped`'s own leading blank line are both deliberate, so the fix pushes one
  separator per boundary instead of removing either. T8 (#134) is the same file and the harder question.
- **L15** The owner answered #134's counter question with **A**: the spec tells the truth and `PASS` is not
  touched. The measurement that framed it, on a clean fixture with `--preset starter`: `summary 0 errors ·
  0 warnings · 0 info · 3 passing · 3 skipped`, `verdict PASS (threshold: error · 3 rules not verified: …)`,
  `not run 6 of 13 rules; off by policy: …`, and `next nothing to do among the rules that ran` — ten of
  thirteen rules measured nothing, and every line was true. §10.2 now says the counters count findings and
  are not coverage; T15 splits into T15a (this spec) and T15b (the invisible passing rule).

## Tasks opened by a claim audit

- **T16** the verdict counts findings and calls them rules — found while auditing #296's claims, not
  reported anywhere. `src/lib/render-human.js:397` prints `plural(summary.skip, 'rule', 'rules') not
  verified`, and `summary.skip` counts skip **findings** (10.2, `src/lib/report.js:121-123`). A rule that
  emits a skip per unreadable file — `actions-pinned-sha.js:257-263`,
  `workflow-run-artifact.js:221-227`, `exact-versions.js:383-389` — makes the verdict overstate its own
  labels. Measured on two crafted unparseable workflows with `--preset baseline`: `verdict PASS
  (threshold: error · 16 rules not verified:` over **10** names, so the sentence is wrong by six in a
  repository with two bad files. RFC 0008 says a verdict **names** the rules it did not verify, and I-53
  says "a count is not a name"; the fix is a distinct-rule count or the names alone. Spec: 10.3 and the
  0008 errata it needs. Judge: plan, STANDARD. Commit: —
- **L16** The campaign closed with three artifacts it should not have opened. A judge's finding is a claim,
  not evidence: T14's premise was refuted by a test the repository already had
  (`tests/start.test.js:405-414`), and issue #310, PR #312 and a spec sentence were built on it before an
  audit read the condition. Hard rule 9 of `funky-judge-protocol` now says so. The verdict's counter carried
  the same shape of error in production: `plural(summary.skip)` labelled findings as rules until T16, found
  by an audit nobody had asked for. Two escape hatches were also confirmed by measurement: the `not run`
  line prints the count that **ran** first, and a chained delivery command makes the RDD preflight refuse
  the whole chain rather than the command inside it.

## Tasks opened after the release

- **T17** A **testing policy**: which behaviour requires a test, which does not, and what makes a test
  admissible. The owner asked on 2026-11-17 whether `AGENTS.md` already carried such a rule and whether the
  suite's **765 `test(` declarations in 48 files** (the run reports 768) are all worth keeping. Today the
  rules are scattered — `CONTRIBUTING.md:87-107` asks for a green suite with its counts, test-first for a
  behaviour change, the drift and docs-contract gates, goldens, and determinism — and **no page states when
  a test is required or when one is inadmissible**. Proposed, not yet judged: one `docs/testing.md` of
  process (not spec: no behaviour moves) with five admission tests — the test pins an observable contract
  (exit code, exact stdout/stderr, a report field, a tree state, a golden); it can fail for the right
  reason, so deleting the line it pins turns it red; one rule carries all its observable effects, including
  that a rejected input leaves data and counters untouched; it is deterministic, with no clock, network or
  machine state; and it is named for the contract, never the implementation. Plus the two absences nobody
  wrote: **what does not need a test**, and the test that duplicates another's contract. Two mechanical
  debts ride with it — a list of tests that cannot fail, found by mutation and forbidden to grow, and the
  `docs/field-loop.md` link that neither `AGENTS.md`'s Paths table nor `CONTRIBUTING.md`'s checklist
  carries. Adopted from `M:/funky-ai/.agents/skills/vitest/SKILL.md:76`: behaviour-named tests, one unit
  under test per file, shared helpers in one place, an empty debt map. Rejected, with the reason: the
  blanket "never hardcode copy" (here the stdout **is** the product and `docs/spec/commands.md` fixes it
  line by line, so the adapted rule is "assert the bytes the spec fixes, and none it does not"), the
  500/800-line caps, and a meta-test policing names. Spec: the page itself. Judge: plan, STANDARD, before
  any edit. Commit: —
- **L17** The field loop was already the rule the owner remembered, and the gap is a **link, not a
  document**: `docs/field-loop.md` says the suite custodies what we know while the loop discovers what
  nobody imagined, and its step 3 (*"Pine it — or pay for it twice"*) already requires a field finding to
  land as a case, taken from the agent's own files and named after the promise it broke. What no page does
  is state the admission rule, and neither `AGENTS.md` nor `CONTRIBUTING.md` points at the loop at all. So
  T17 adds one page and two cross-references; it reopens no measurement and claims none.

## Errata

**2026-11-17 — the rows whose commit was recorded in another document.** This record is append-only, so the four
rows below keep the `Commit: —` they were written with; the commit each one produced is named here instead. Found
while planning `odd/tasks/post-release-debt.md` (its T7), and every hash below was checked against `git log -1`
before it was written.

- **T2** — `745881b` (PR #284), *docs(spec): name the guard order where the unversioned pin row is read*.
- **T5** — `6be24e7` (PR #290), *fix(workflows): a block scalar starts at its indentation indicator*.
- **T6** — `62fa2cb` (PR #291), *chore(probe): the resolve fixture builds its section from the constant*.
- **T8** — split before it landed, so its row names no commit and its halves name their own: **T15a** is
  `3befd3f` (PR #296), *docs(spec): the summary counters count findings, and they are not coverage*, and **T15b**
  already carries its two in its own row.

Nothing else about those rows changes: their specs, judges and acceptance are as written.

**2026-11-17 — the two rows that read as open and are not.** Found while planning `odd/tasks/open-task-ledger.md`
(its `T1`). Both rows keep the `Commit: —` and the `Still open` they were written with, because this record is
append-only; what they produced is here instead, and every hash was checked against `git log -1` before it was
written.

- **T11** — *"Debt (b) — the five one-sided rules are measured or declared"*. **Both branches were closed, each by an
  issue the row never named.** The declaration half is **#320** (created 2026-11-16, bundling this debt with the
  suite count nothing checked), closed by PR **#321** -> `ba5491e`, whose commits are `44bb835` (*the suite row
  loses a number nothing checks*), `0fd67b2` (*keep the skip disclosed, and leave the plan out*) and `232cbd5`
  (*the 0.13.0 plan is not part of this pull request*). The measurement half is **#327** (*one side of five rules
  is unmeasured*), closed by PR **#330** -> `abd6db3`, *docs(validation): the sweep ran, three rows moved, and
  the table is a table again*. `docs/validation.md:65-87` records both sides of all five rules. **Nothing is owed
  on this row.**
- **T16** — *"the verdict counts findings and calls them rules"*. Closed by `e9251d1` (PR #297, *fix(render): the
  verdict counts the rules it names*), merged nineteen minutes after this row was written. It moved
  `docs/spec/report.md` §10.3 at `:201` (*"The verdict counts the rules it did not verify once each and names them"*),
  `src/lib/render-human.js` (`verdictLine` now takes `unverifiedIds`), and `tests/report.test.js` (+40 lines
  pinning both). Its two commits are `17adf0c` (the fix) and `e01cebd` (the tests). The row's evidence line, `src/lib/render-human.js:397`, is a JSDoc sentence today: the defect it
  describes is not there. **Nothing is owed on this row either.**

What survives from that pair is `T17` alone, and it is `odd/tasks/open-task-ledger.md`'s subject.

> **Corrected the same day, in this entry's own voice.** The `T16` bullet above says *"nineteen minutes"*; the
> measured interval is `19:17:21 -> 19:26:33`, which is **nine minutes and twelve seconds**. The word is left as
> written because this record is append-only, and the number is corrected here rather than overwritten.
