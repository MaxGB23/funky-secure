# open-task-ledger — one real orphan, two stale rows, and a check that does not police prose

The analysis that opened this feature counted three orphaned tasks. Two judges and two measurements later, it
counts one: `T17`. The other two — `T11` and `T16` — were closed by work that landed *before* the plan was
written, and their rows never said so. This document replaces the plan with what the repository actually says,
and shrinks the mechanical check to something that can be green without inventing a grammar for prose it would
have to police.

## Specs

**S1** — the owner's instruction, verbatim: «por qué se ha olvidado de realizar? hay mas tareas olvidadas?
para meter todo en backlog nuevo. dame un analisis primero, sin implementar nada».

**S2** — the owner's approval, verbatim: «me gusta el plan, ya sabes qué hacer, jueces para el plan y para
afirmaciones, a empezar».

**S3** — **one task is open, and it is `T17`.** The row is `odd/tasks/next-release-backlog.md:330-349`; the page
it asks for, `docs/testing.md`, does not exist, and `grep -n "field-loop" AGENTS.md CONTRIBUTING.md` returns
nothing, so both cross-references it names are missing. It has never had an issue: `gh issue list --state all`
carries 189 and none covers a testing policy.

**S4** — **two rows are stale, and the record is append-only, so they are corrected by a dated `## Errata`, never
by editing them.** The backlog says so in its own words: *"the cure is a dated `## Errata` naming each commit —
never an edit"* (`odd/tasks/post-release-debt.md:195-196`). The two stale rows:

- **`T11`** — `next-release-backlog.md:172`. Closed by issue **#320** (and **#327**) with `ba5491e`, and the
  measurement branch of `S15` landed in `abd6db3` (`docs/validation.md:65-87`: both sides of all five rules).
- **`T16`** — `next-release-backlog.md:309-318`. Closed by **`e9251d1`** (#297), merged nineteen minutes after
  the row was written: `docs/spec/report.md` §10.3 now says the verdict *counts the rules it did not verify once
  each and names them*, `src/lib/render-human.js:405-420` implements `unverifiedIds`, and `tests/report.test.js`
  gained `+40` lines pinning it. No errata names it, which is why it read as open.

**S5** — **the mechanical check is narrowed to this document, and it acquires the syntax it needs.** The two
judges refuted the first version on measured grounds and the refutation stands: over `odd/tasks/*.md` the
predicate's true positives were 1 of 11 (a single real orphan among eight errata rows and three prose
sentences), it matched its own specification twice (`:19` quotes `**Still open.**` and `Commit: —`), it could
not tell an issue from a pull request (`T16`'s only token is `#296`, a PR), and it could not see an open row
whose issue had been closed — the `T11` shape. So it does not police legacy prose. It reads **this document's
own task table** and fails when a row with `status: open` names no `#<issue>`. The table therefore carries
`status` and `issue` columns, and that is the syntax the check reads.

**S6** — repository policy is not re-decided: a behaviour change starts in `docs/spec/` in its own pull request,
and a new page must answer `docs/README.md`'s map or say why it fits none of its rows.

**S7** — `T17`'s own rider is not dropped. The row asks for a page with five admission tests *and* two mechanical
debts, one of which is *"a list of tests that cannot fail, found by mutation and forbidden to grow"*. A mutation
campaign is not a page; it is named here as the one item this feature defers, with the deferral written rather
than silently trimmed.

## Tasks

| id | task | specs | status | issue | route |
|---|---|---|---|---|---|
| T0 | two blind judges on the plan, adjudicated in this Log | S2, S6 | landed | — (the owner's approval is the authority) | one |
| T1 | the `## Errata` entry naming `#320`/`ba5491e`/`abd6db3` for `T11` and `#297`/`e9251d1` for `T16`, never an edit to the rows | S4 | landed | #451 | one | one |
| T2 | `docs/testing.md`: the five admission tests, the two absences, what was adopted and what was rejected, and the `AGENTS.md` / `CONTRIBUTING.md` / `docs/README.md` links | S3, S6 | landed | #452 | one | one |
| T3 | the check over this table: a row with `status: open` and no `#<issue>` fails — RED observed on this document before the `issue` column is filled | S5 | landed | #454 | one | test-first |
| T4 | claim audit over the feature before it closes | S2 | landed | #453 | one |

The mutation-testing rider (`S7`) is **not** a task of this feature: `T17`'s parent row names it, this document
names it, and it stays where it belongs — in the ledger, unwritten, rather than half-done here.

## Log

**L1** — the owner's request is `S1`, the approval is `S2`. `S1` set the order — analysis first, no
implementation — and `S2` named the instrument.

**L2** — the first plan's analysis, **corrected**. It said `grep -rc "Commit: —" odd/tasks/*.md` returned nine
rows of which six were false positives. Measured at `7081f77`, before this document existed: **eleven lines.
Eight false positives** — five landed rows whose commits the `## Errata` names (`T2`, `T5`, `T6`, `T8`, `T15a`)
and three sentences *about* that errata (`next-release-backlog.md:360`, `release-0.13.0.md:129`,
`post-release-debt.md:192`) — **and three rows the errata does not cover** (`T11`, `T16`, `T17`). The old
sentence also read a `grep -c` per-file count as a row count, called `T8` and `T15a` one row, and claimed "no
document mentions the other" while `release-0.13.0.md:68` names `T11` by number.

**L3** — the first plan's freeze hash was **wrong and is withdrawn**: it was taken before two Log entries were
appended, so `a59f7539…` matches nothing in history. The committed blob of that plan is `4184319a…`. The lesson
is `T0`'s: a freeze hash is only a freeze if it is taken of the bytes that are committed, and recorded in a
place that lets a reader recompute it — `git show <commit>:<path> | sha256sum`.

**L4** — **the adjudication of both judges, and what each of their findings cost the plan.** They were read
independently and agreed on the critical points; every one below was re-verified against the repository before it
was written, because a judge's finding is a claim and not evidence.

- **The premise (`S3`): accepted, and it changes the feature.** `T16` was closed by `e9251d1` (#297) and `T11` by
  `#320`/`#327` with `ba5491e` and `abd6db3` — both verified here (`git merge-base --is-ancestor e9251d1 HEAD`;
  `gh issue view 320`; `docs/validation.md:65-87`). The plan called them open and planned work that is already
  done. **Two tasks left the table; two rows entered it.**
- **`L2`'s count: accepted.** Eleven lines, eight false positives, three rows, one open. The old arithmetic could
  not sum to nine under any reading.
- **The check (`S5`): accepted in full, and the answer is to narrow it, not to widen it.** Self-match,
  issue-versus-PR, closed-issue blindness, id collisions across six documents, and a true-positive rate of one in
  eleven. **The strongest argument against building it at all** — that `scripts/check-pr-policy.js` already forces
  an issue the moment anyone starts an orphaned task, which is exactly how `T11` got `#320` and `#327` — is
  recorded here rather than dismissed: it is why the check no longer claims to police the record, only this
  document's own table.
- **The order (`T1` before `T2`): accepted.** The RED was unobservable in that order. `T3` now precedes the
  filling of its own `issue` column, and `scripts/open-pr.js` refuses a red suite — so the RED is captured in the
  Log and the green lands in the same pull request.
- **`T1` against append-only: accepted, and it was the plan's own policy violation.** Writing issue numbers into
  those rows would edit a record that says *"never an edit"*. The cure is the `## Errata` entry, which is what
  `T1` now is.
- **`T3` already landed: accepted.** §10.3, `verdictLine` and the tests shipped on 2026-11-15. Nothing re-does it.
- **`T5` already satisfied: accepted.** `T11`'s disjunction was closed on both branches. It is errata, not a
  sweep.
- **`T4`'s dropped rider: accepted.** The mutation debt is named in `S7` and deferred explicitly, and the
  `docs/README.md` link B found — the map whose closing line says a page that fits no row should probably not
  exist — joins the other two.
- **`T17`'s stale measurement: accepted, and left quoted as history.** The row's *"765 `test(` declarations in 48
  files"* is from a tree two weeks younger; `T2` measures the page's counts when it writes them, and does not
  repeat a number it did not run.

**L5** — the table's `issue` column is `—` on purpose, and that is the RED `T3` observes. The first draft of this
revision wrote issue numbers before the issues existed, which is the same defect the plan is about: a row
claiming a link nobody opened. The order is `T3`'s test first (red on this table, captured below), then the four
issues, then the column filled and the suite green in one pull request.

**L6** — this plan is frozen at commit `43b2acb`, whose blob hashes to `6a903bd4be55ab89…`. That is the
form the freeze takes after `L3`'s defect: a reader recomputes it with `git show 43b2acb:odd/tasks/open-task-ledger.md
| sha256sum`, and the number cannot describe bytes other than the committed ones. Both judges read the
**previous** plan, are quoted in `L4`, and no finding of theirs was carried over unverified.

**L7** — `T3` was observed, not asserted. With the table's `issue` column still empty, `node --test
tests/open-task-ledger.test.js` failed for its own reason: *an open task with no issue is the leak this ledger
exists to close* — `actual: [ T1 (issue: —), T2 (issue: —), T3 (issue: —), T4 (issue: —) ], expected: []`. The
four issues were then opened (`#451`, `#452`, `#454`, `#453`), the column filled, and the same command passed
2/2. The RED is four rows and the GREEN is the same four rows naming their issues; nothing else changed between
the two runs.

**L8** — the closing claim audit, done by the parent because the judge allocated for it **timed out on an
infrastructure fault** (`No models match pattern "opencode-go/crouton-alpha-free"`), not on a verdict: no finding
was produced and none is implied. Every claim below was re-run here.

- **`L4` says `T16` was closed "nineteen minutes after its row was written", and that is wrong.** Measured:
  `3befd3f` (the row) `2026-11-15T19:17:21-06:00`, `e9251d1` (the fix) `2026-11-15T19:26:33-06:00` — **nine
  minutes and twelve seconds**. `L4` is not rewritten; this entry corrects it, and the errata entry in
  `next-release-backlog.md` carries the same correction in its own words.
- **`docs/testing.md` cited one assertion at the wrong line.** The `typeof rule.detect === 'function'` assertion is
  at `tests/rules/ci-no-safety-overrides.test.js:121`, not `:120`, and the page is corrected in place because a
  page is not a record.
- **Everything else the audit touched reproduced.** `src/lib/render-human.js:397` is a JSDoc sentence;
  `docs/spec/report.md` `:200-202` carries the sentence the errata quotes; `docs/README.md:11` routes a message
  change to `spec/report.md` §10.3; `tests/report.test.js:552` really is
  `assert.equal(renderHuman(report), renderHuman(report))`; `tests/open-pr.test.js:971`'s test destructures
  `{ code }` alone; the five measured counts in the page (51 files, zero clock or network, twelve absolute
  fixtures, ten `t.skip`, eight resolvers, thirty-one `src/lib` importers) each re-ran to the number written.
- **The audit's own limit, stated.** It checked the claims its list named, not every sentence in three
  documents. A judge with a broader lens was allocated and did not run; this entry records the substitution
  instead of presenting the parent's audit as equivalent.
