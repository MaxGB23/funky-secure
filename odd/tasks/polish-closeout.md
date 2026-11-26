# Polish closeout

The three carried defects that survived the 2026-11-26 batch, plus a fourth the J1 round found inside the same
subject, closed one work unit at a time. Everything shipping in this repository that is not the portfolio data
file; the portfolio is out of scope on the owner's own word.

## Specs

**S1 — Scope.** The owner's words: *"deja todo pulido, si surge una nueva problematica que requiera issue y pr,
hazlo, dime cuando todo esté al 100. Solo no implementes nada de portfolio aun. Apoyate de jueces para plan, odd
y sus J[n], afirmaciones, etc, empecemos"*. Judgments (`J1`–`J3`) are part of the work: the plan is judged before
code, each claim-bearing change before it merges, and the batch audited when it closes.

**S2 — R2-002, the unanchored negative assertion.** `tests/ci-coverage.test.js:283` asserts
`doesNotMatch(job, /continue-on-error/)`. Any mention of the key — a comment explaining why it is absent —
satisfies the pattern and fails the case, so the case punishes documentation instead of measuring the workflow.
Requirement: the assertion matches an active YAML key (`continue-on-error:` in a setting position) and not a
prose mention, and it still fails when the key is really set.

**S3 — the conflict-only plan is missing from the page that lists refusals.** The contract says
`docs/spec/commands.md:110-118`: *"A plan that performs no write and carries at least one conflict exits `3`"*,
and that a conflict inside a plan that writes something *"does not change the code"*. In `docs/cli.md`, the
refusal list is `:502-504` — one line and one bullet, the dirty target — and `:516-517` denies the
conflict-only half: *"A `conflict` alone does not make the command fail; it makes the plan a refusal you can
read"*. The same page **affirms** the I-58 half at `:511-515` (a conflict *"is printed in the plan, left
untouched, and is not a write"*), so the page contradicts one half, never both; `:506-509` is the exit-`2`
paragraph and is not part of the refusal list. Requirement: the page names the conflict-only case as exit `3`,
leaves the I-58 half as it stands, and a test fails if it drifts.

**S4 — five citations name a line that moved, under three different rules.** `src/lib/plan.js` returns `0` for a
zero-write plan at `:302-304`. Each site is corrected by the rule its own location imposes:
1. `rfcs/0037-a-refused-plan-says-so/rfc.md:22` cites `:284-287`. The RFC is a `draft` (`rfcs/README.md:46`, its
   status line `:5`) and `rfcs/README.md:94-95` makes acceptance the last moment its body may be rewritten — so a
   draft's citation is corrected in place.
2. `odd/tasks/next-release-backlog.md:232` cites `:291-293` inside that document's `## Log` (`:213`), which
   `AGENTS.md` makes evidence and append-only — so the correction is an appended line.
3. `odd/tasks/next-release-backlog.md:127` cites `:291-293` inside `## Specs` (`:7`), not the Log, so appending a
   Log line would leave it standing. The document's own `## Errata` section is the route: a dated entry names the
   corrected line and keeps the row it corrects.

Two more sites surfaced while implementing, both under rule 3's route:
`odd/tasks/pendings-closeout.md:30` cites I-99 at `docs/decisions.md:286`, which #572's dedupe moved to `:144`, and
`odd/tasks/docs-drift-audit.md:47` reads `docs/decisions.md:29` as D-9 while `:29` carries D-7 and D-9 sits at
`:31`. The delivered count is five, and this record states it rather than leaving the plan's three standing.

**S5 — Delivery.** One issue and one pull request per unit, through `node scripts/open-pr.js`, one commit per
unit. Every unit is `Risk: none`: documentation and tests, no product behaviour, no contract.

**S6 — the RFC registry states a pending contract that already landed.** `rfcs/README.md:46` reads
`0037 … | draft | … | pending: becomes docs/spec/commands.md §11.2 when the change merges`, while
`docs/spec/commands.md:113` already carries the rule and `docs/decisions.md:125` (I-80) records it in force. The
row's contract cell is false about the present. Requirement: the cell names where the contract actually lives.
The `draft`/`accepted` question is the owner's — `rfcs/README.md:94-95` reserves `accepted` for the owner's
agreement — so this unit changes no status and the issue names that decision as open.

## Tasks

| ID | Spec | Work | Route | Commit | Judge |
| --- | --- | --- | --- | --- | --- |
| J1 | — | Plan judged blind by two judges, two rounds | `jd-judge-a` + `jd-judge-b` | `d845aa3`, `04eb72a`, `5267e8d` | done, 14 rows |
| T1 | S2 | Anchor the `continue-on-error` assertion — and the two siblings the round found — and prove each one fails on a setting and not on a mention, using a `git archive` tree | inline, test first | `8fba453` (PR #585) | J2 done, 4 + 0 rows |
| T2 | S3 | The conflict-only plan in `docs/cli.md`, with the guard that pins **both halves** of the claim | inline, test first | `fe883f0` (PR #586) | J2 done, 3 + 0 rows |
| T3 | S4 | Five citations, each by its own rule | inline, docs only | `7fac73e` (PR #587) | J2 done, 5 + 1 rows |
| T4 | S6 | The three `pending` registry cells name where their contracts live; no status change | inline, docs only | `3d4bc07` (PR #588) | J2 done, 2 + 0 rows |
| J3 | — | Closing audit over the batch's records and claims | `jd-judge-a`, `SINGLE` | — | pending |

## Log

- **L1** — owner, verbatim: *"deja todo pulido, si surge una nueva problematica que requiera issue y pr, hazlo,
  dime cuando todo esté al 100. Solo no implementes nada de portfolio aun. Apoyate de jueces para plan, odd y sus
  J[n], afirmaciones, etc, empecemos"*
- **L2** — premises verified by the parent before they became tasks (protocol rule 3): the zero-write return is
  `src/lib/plan.js:302-304` (`sed -n '296,310p'`); both record citations name other lines; the spec sentence at
  `commands.md:110-118` says exit `3` and the I-58 half; `docs/cli.md` denies the conflict-only half at
  `:516-517` while affirming I-58 at `:511-515`. The citation drift a previous advisory blamed on
  `src/lib/plan.js:302` was a misreading of the direction: the records are the ones citing, and their numbers are
  the stale ones.
- **L3 — J1 round 1.** Freeze `d845aa3` (`git rev-parse d845aa3:odd/tasks/polish-closeout.md` →
  `56ce7421`, 56 lines; `sha256sum` of the working file → `d8dcc338`). Judges: `jd-judge-a`
  `opencode-go/deepseek-v4.1-flash`, `jd-judge-b` `opencode-go/muse-spark-1.3-contributor`. Nine questions,
  seven rows returned. The marker and both verdicts live in `.tmp/judge/` (untracked: `.tmp` is ignored), which is
  where the counts above are read from. Adjudication, after the parent read each row against the tree:
  **JD-B-001 and JD-A-001** `confirmed` (deterministic) — S3's `:508-511` was the exit-`2` paragraph's tail, and
  both judges found it independently; **JD-A-002** `confirmed` — "the opposite of both halves" overstated it;
  **JD-A-003** `confirmed` — `rfcs/README.md:46` still says the contract is pending, which became **S6/T4**;
  **JD-A-004** `confirmed` — RFC 0037 is a draft, so S4 named the wrong rule; **JD-A-005** `confirmed` — T1's
  acceptance named no fixture; **JD-A-006** `confirmed` against the question set, not the artifact — Q7 asked
  about premises the plan never asserts, so the parent records a question-set defect and opens no work.
- **L4 — J1 round 2, and the cap.** Freeze `04eb72a` (blob `c661519c`, 92 lines; `sha256sum` →
  `e28cb457`). Same two judges, five questions. Judge B returned no rows; judge A returned seven, all read
  against the tree by the parent: **JD-A-001** (round 2) `confirmed` — `tests/ci-coverage.test.js:6-9` reads
  three files at module load, so "a scratch copy of the two files" could not run; T1 now names the four-file
  mirrored tree; **JD-A-002** (round 2) `confirmed` — the backlog's `:127` sits under `## Specs`, not `## Log`, so
  S4's two-rule split did not classify it; S4 now carries three rules and cites the document's own
  `## Errata` precedent; **JD-A-003** (round 2) `confirmed` — S3's `:502-509` overshot into the exit-`2`
  paragraph; the list is `:502-504`; **JD-A-004** (round 2) `confirmed` — a digest without its recipe;
  **JD-A-005** (round 2) `confirmed` — "the only third-party premise" was an un-run sweep, and S2 rests on
  `assert.doesNotMatch` behaviour; **JD-A-006** (round 2) `confirmed` — the round-1 record is untracked, so its
  count is a reading of `.tmp/judge/` and not a repository fact; **JD-A-007** (round 2) `confirmed` — L3 used
  "accepted" and "the row stands" beside `confirmed`; the vocabulary is now the protocol's four. **The cap is
  reached: two judged rounds on this artifact, and no third pass was run.** Every row above was corrected in this
  text, and the corrections are not re-judged — the record states that plainly rather than implying a clean round.
- **L5 — J2, two rounds per unit, before each pull request.** Each body was frozen by `sha256sum` and judged with
  `jd-judge-a` (`opencode-go/deepseek-v4.1-flash`); each corrected body went to `jd-judge-b`
  (`opencode-go/muse-spark-1.3-contributor`), because the protocol asks that a corrected artifact be judged by
  someone other than its corrector. Everything confirmed by the parent against the tree before it became work:
  - **T1 — 4 rows, then 0.** The header stated a past failure the tree cannot show (`grep -c continue
    .github/workflows/ci.yml` prints `0`), the three outcomes named no recipe, the lineage id lives outside
    tracking, and the same unanchored defect sat in two sibling needles (`runs-on: …-latest`, `PR_LABELS:
    join(event…)`). T1 became the class fix, and every recipe in the body is now a command.
  - **T2 — 3 rows, then 0.** The counts named no commit or host and the provenance did not recompute (the cited
    base's suite was 1027, not the 1030 behind `1031`), and the guard accepted any bullet containing "conflict".
    The guard now requires both halves — a conflict and a plan that writes nothing — with its own RED.
  - **T3 — 5 rows, then 1.** My appended Log entry reused a label the backlog already had (`L16`), the dedupe
    mechanism was described wrongly (the copies are byte-identical apart from the truncated `I-98`, so the
    numbering that survives is the first copy's), and two new `## Errata` sections cited a rule no document
    states. The single round-2 row was the sharpest: the "precedent" citation of `:357` was shifted to `:360` by
    this very commit's own insertion — the defect class the unit exists to fix, produced by the fix. The citation
    is now by section, not by number. The body changed once more after that verdict (a line-reference edit), and
    the two-round cap was already spent, so those bytes are **not** re-judged and the record says so.
  - **T4 — 2 rows, then 0.** The row I fixed was one of **three** identical `pending` cells (`:44`, `:45`, `:46`);
    the sweep `grep -n pending rfcs/README.md` returns those three and one prose "Appending". T4 grew to the table
    it claimed to fix.
- **L6 — delivered.** The four units merged as **#585** (`2cfd90c`), **#586** (`1ee0582`), **#587** (`d963d1f`)
  and **#588** (`23b594a`), each with its own issue (#581–#584) closed by its body.
- **L7 — J3, the closing audit, and what it found in this record.** Frozen `a06e9e6`, class `claims of a change`,
  purpose `cover`, `jd-judge-a`, four questions; five rows, each verified by the parent against `23b594a`:
  **JD-A-001** `confirmed` — S4 rule 3 cited the backlog's errata as `:357-362` while the section sits at `:360`,
  because `7fac73e`'s own three-line insertion moved it: the defect class the unit closes, reproduced by the unit,
  inside the record that describes it. S4 now names the section, not the number. **JD-A-002** `confirmed` — L5's
  heading said "one round per unit" while it tabulated two passes per unit; the heading now says two, which is
  what `4 + 0`, `3 + 0`, `5 + 1` and `2 + 0` tabulate. **JD-A-003** `confirmed` — S4 said "three citations" and
  the delivery was five; the record now names all five. **JD-A-004** `confirmed` — the J1 row stopped at
  `04eb72a`, one correction short of the text that shipped (`5267e8d`, blob `56b9ab8a`, 98 lines); the row names
  it. **JD-A-005** `confirmed` — the 0036 registry cell, and RFC 0036's own `Present contract` cell, say
  "§8.1 R1" while R1 lives under §8.2 (`docs/spec/rules.md:38`, `:40`) and the `(0036)` sentence sits at `:212`
  inside R1; both are corrected, the registry cell in this batch and the RFC in place because it is still a draft.
  **The cap is spent**: these corrections are not re-judged, and the record says so.
