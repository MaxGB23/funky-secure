# Polish closeout

The three carried defects that survived the 2026-11-26 batch, plus a fourth the J1 round found inside the same
subject, closed one work unit at a time, with the plan judged blind before the first source write. Everything
shipping in this repository that is not the portfolio data file; the portfolio is out of scope on the owner's
own word.

## Specs

**S1 — Scope.** The owner's words: *"deja todo pulido, si surge una nueva problematica que requiera issue y pr,
hazlo, dime cuando todo esté al 100. Solo no implementes nada de portfolio aun. Apoyate de jueces para plan, odd
y sus J[n], afirmaciones, etc, empecemos"*. Judgments (`J1`–`J3`) are part of the work, not decoration: the plan
is judged before code, each claim-bearing change before it merges, and the batch audited when it closes.

**S2 — R2-002, the unanchored negative assertion.** `tests/ci-coverage.test.js:283` asserts
`doesNotMatch(job, /continue-on-error/)`. Any mention of the key — a comment explaining why it is absent —
satisfies the pattern and fails the case, so the case punishes documentation instead of measuring the workflow.
Requirement: the assertion matches an active YAML key (`continue-on-error:` in a setting position) and not a
prose mention, and it still fails when the key is really set.

**S3 — the conflict-only plan is missing from the page that lists refusals.** The contract says
`docs/spec/commands.md:110-118`: *"A plan that performs no write and carries at least one conflict exits `3`"*,
and that a conflict inside a plan that writes something *"does not change the code"*. In `docs/cli.md`, the
refusal list at `:502-509` names only the dirty target, and `:516-517` denies the conflict-only half:
*"A `conflict` alone does not make the command fail; it makes the plan a refusal you can read"*. The same page
**affirms** the I-58 half at `:511-515` — a conflict *"is printed in the plan, left untouched, and is not a
write"* — so the page contradicts one half, never both. Requirement: the page names the conflict-only case as
exit `3`, leaves the I-58 half as it stands, and a test fails if it drifts.

**S4 — two records cite a line that moved.** `src/lib/plan.js` returns `0` for a zero-write plan at
`:302-304`. The records cite `src/lib/plan.js:291-293` (`odd/tasks/next-release-backlog.md:127` and `:232`) and
`src/lib/plan.js:284-287` (`rfcs/0037-a-refused-plan-says-so/rfc.md:22`). The two are corrected by different
rules, and the difference is the record's own state: RFC 0037 is still `draft` (`rfcs/README.md:46`, its status
line `:5`), and `rfcs/README.md:94-95` says *"that is the last moment its body may be rewritten"* when it becomes
`accepted` — so a draft's citation is corrected in place. The ODD Log in `odd/tasks/` is evidence and is only
ever appended to, so its citation is corrected by an appended line. Requirement: each record names the current
location without rewriting anything the record's state forbids rewriting.

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
| J1 | — | Plan judged blind by two judges before the first source write | `jd-judge-a` + `jd-judge-b`, round 1 | `d845aa3` | done, 7 rows |
| T1 | S2 | Anchor the `continue-on-error` assertion; prove it still fails on the key with a scratch copy of the two files (the case reads the real workflow, so the RED is a temporary edit there, reverted) | inline, test first | — | J2 |
| T2 | S3 | The conflict-only plan in `docs/cli.md`, with the guard that keeps it | inline, test first | — | J2 |
| T3 | S4 | The draft RFC's citation corrected in place, the ODD Log's appended | inline, docs only | — | J2 |
| T4 | S6 | The registry row names where the contract lives; no status change | inline, docs only | — | J2 |
| J2 | — | Each unit's claim set judged before its pull request | `jd-judge-a`, `SINGLE` per work unit | — | pending |
| J3 | — | Closing audit over the batch's records and claims | `jd-judge-a`, `SINGLE` | — | pending |

## Log

- **L1** — owner, verbatim: *"deja todo pulido, si surge una nueva problematica que requiera issue y pr, hazlo,
  dime cuando todo esté al 100. Solo no implementes nada de portfolio aun. Apoyate de jueces para plan, odd y sus
  J[n], afirmaciones, etc, empecemos"*
- **L2** — premises verified by the parent before they became tasks (protocol rule 3): the zero-write return is
  `src/lib/plan.js:302-304` (`sed -n '296,310p'`, read today); both record citations name other lines; the spec
  sentence at `commands.md:110-118` says exit `3` and the I-58 half; `docs/cli.md` denies the conflict-only half
  at `:516-517` while affirming I-58 at `:511-515`. The citation drift a previous advisory blamed on
  `src/lib/plan.js:302` was a misreading of the direction: the records are the ones citing, and their numbers are
  the stale ones.
- **L3 — J1 adjudication** (round 1, frozen `d845aa3` / blob `56ce7421`; judges `jd-judge-a`
  `opencode-go/deepseek-v4.1-flash` and `jd-judge-b` `opencode-go/muse-spark-1.3-contributor`; 9 questions,
  7 rows returned, both judges returned). The verdicts are the parent's, written after verifying each row
  against the tree:
  - **JD-B-001 and JD-A-001 — confirmed** (deterministic): S3's `docs/cli.md:508-511` was the exit-`2`
    paragraph's tail; the refusal list is `:502-509` and the denying sentence `:516-517`. Both judges found it
    independently, which is the strongest signal this protocol has. S3 corrected.
  - **JD-A-002 — confirmed** (inferential): "the opposite of both halves in one sentence" overstated it; the
    page affirms the I-58 half at `:511-515`. S3 corrected to "contradicts one half, never both", and T2 no
    longer claims to restore an I-58 statement the page never lost.
  - **JD-A-003 — confirmed** (deterministic): `rfcs/README.md:46` still says `draft` and "pending: becomes
    §11.2 when the change merges" although the rule is in `docs/spec/commands.md:113` and I-80. The sweep in
    L2 missed it. Becomes **S6/T4** — a defect's second instance, not new work.
  - **JD-A-004 — confirmed** (inferential): RFC 0037 is a `draft`, and `rfcs/README.md:94-95` allows a draft's
    body to be rewritten until it is `accepted`; S4 named the settled-RFC rule for it. S4 corrected, and the
    noun now follows the record's state (in place for the draft, append for the Log).
  - **JD-A-005 — accepted** (deterministic): T1's acceptance named no fixture while the case reads the real
    workflow. T1 now names the scratch copy and the reverted temporary edit.
  - **JD-A-006 — the row stands against the question set, not the artifact** (inferential): Q7 asked about
    GitHub's rendering and `git merge-tree`, which this plan never asserts. The only third-party premise it
    carries is the `scripts/open-pr.js` route, and `AGENTS.md` states it. Lesson recorded, no work.
