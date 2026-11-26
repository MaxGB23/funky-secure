# Polish closeout

The three carried defects that survived the 2026-11-26 batch, closed one work unit at a time, with the plan
judged blind before the first source write. Everything shipping in this repository that is not the portfolio
data file; the portfolio is out of scope on the owner's own word.

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
and that a conflict inside a plan that writes something *"does not change the code"*. `docs/cli.md:508-511`
says the opposite of both halves in one sentence — *"A `conflict` alone does not make the command fail; it makes
the plan a refusal you can read"* — and its exit-`3` list names only the dirty target. Requirement: the page
names the conflict-only case as exit `3` and keeps the I-58 half true, and a test fails if it drifts.

**S4 — two records cite a line that moved.** `src/lib/plan.js` returns `0` for a zero-write plan at
`:302-304`. The records cite `src/lib/plan.js:291-293` (`odd/tasks/next-release-backlog.md:127` and `:232`) and
`src/lib/plan.js:284-287` (`rfcs/0037-a-refused-plan-says-so/rfc.md:22`). AGENTS.md makes both append-only: a
settled RFC is corrected by a dated `## Errata`, and a task Log is only ever appended to. Requirement: each
record names the current location in an appended errata, and no recorded sentence is rewritten.

**S5 — Delivery.** One issue and one pull request per unit, through `node scripts/open-pr.js`, one commit per
unit. Each unit is `Risk: none`: documentation and tests, no product behaviour, no contract.

## Tasks

| ID | Spec | Work | Route | Commit | Judge |
| --- | --- | --- | --- | --- | --- |
| J1 | — | Plan judged by two blind judges before the first source write | `jd-judge-a` + `jd-judge-b` | — | pending |
| T1 | S2 | Anchor the `continue-on-error` assertion and prove it still fails on the key | inline, test first | — | J2 |
| T2 | S3 | The conflict-only plan in `docs/cli.md`, with the guard that keeps it | inline, test first | — | J2 |
| T3 | S4 | Dated errata in the two records, current lines named | inline, docs only | — | J2 |
| J2 | — | Each unit's claim set judged before its pull request | `jd-judge-a` (one work unit each) | — | pending |
| J3 | — | Closing audit over the batch's records and claims | `jd-judge-a` | — | pending |

## Log

- **L1** — owner, verbatim: *"deja todo pulido, si surge una nueva problematica que requiera issue y pr, hazlo,
  dime cuando todo esté al 100. Solo no implementes nada de portfolio aun. Apoyate de jueces para plan, odd y sus
  J[n], afirmaciones, etc, empecemos"*
- **L2** — premises verified by the parent before they became tasks (protocol rule 3): the zero-write return is
  `src/lib/plan.js:302-304` (`sed -n '296,310p'`, read today); both record citations name other lines; the spec
  sentence at `commands.md:110-118` says exit `3` and the I-58 half; `docs/cli.md:508-511` contradicts both.
  The citation drift a previous advisory blamed on `src/lib/plan.js:302` was a misreading of the direction: the
  records are the ones citing, and their numbers are the stale ones.
