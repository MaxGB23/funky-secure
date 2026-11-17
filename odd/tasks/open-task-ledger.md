# open-task-ledger — recover the three orphaned tasks, and stop the next one being orphaned

Three tasks were found open in `odd/tasks/next-release-backlog.md` while the `defect-backlog` campaign was
closing: `T11`, `T16`, `T17`. None of the three has a GitHub issue, and open issues are zero, so nothing — not
`gh issue list`, not a todo list, not a pull-request gate — could surface them. This feature gives each one its
issue, and adds the mechanical check that would have failed the day they were left behind.

## Specs

**S1** — the owner's instruction, verbatim: «por qué se ha olvidado de realizar? hay mas tareas olvidadas?
para meter todo en backlog nuevo. dame un analisis primero, sin implementar nada».

**S2** — the owner's approval, verbatim: «me gusta el plan, ya sabes que hacer, jueces para el plan y para
afirmaciones, a empezar».

**S3** — the three tasks, in the words their own document gave them, and nothing re-scoped:

- **`T11`** — `odd/tasks/next-release-backlog.md:172`, whose row says *«Debt (b) — the five one-sided rules are
  measured or declared — S15. **Still open.** Spec: the page itself. Judge: plan, before the sweep. Commit: —»*.
- **`T16`** — `odd/tasks/next-release-backlog.md:309-322`: the verdict prints `16 rules not verified` while
  `plural(summary.skip, 'rule', 'rules')` counts skip **findings**, measured at `PASS … 16 rules not verified`
  over **10** names in a repository with two unparseable workflows. *«Spec: 10.3 and the 0008 errata it needs.
  Judge: plan, STANDARD. Commit: —»*.
- **`T17`** — `odd/tasks/next-release-backlog.md:329-348`: a testing policy. *«Today the rules are scattered —
  `CONTRIBUTING.md:87-107` asks for a green suite with its counts, test-first for a behaviour change, the drift
  and docs-contract gates, goldens, and determinism — and no page states when a test is required or when one is
  inadmissible. Proposed, not yet judged.»*

**S4** — one issue per task, opened before any work, and named in the task's own row. A task that has no issue
is not in this feature.

**S5** — the mechanical check. A test reads `odd/tasks/*.md` and fails when a row is **open** — it says
`Still open`, `Proposed`, `not yet judged`, or carries `Commit: —` with no commit named in `## Errata` — and
names **no** `#<issue>`. It must fail on the tree as it stands today, for `T11`, `T16` and `T17`, and that RED
is the evidence the leak was real; it must pass once the three rows name their issues.

**S6** — repository policy is not re-decided here: a behaviour change starts in `docs/spec/` in its own pull
request (`CONTRIBUTING.md`, `AGENTS.md`), and the judges read the plan and the claims as `funky-judge-protocol`
says — blind to each other, before implementation.

## Tasks

| id | task | specs | route | commit |
|---|---|---|---|---|
| T0 | freeze this plan and have two blind judges rule on it, then adjudicate every finding in the Log | S2, S6 | one | — |
| T1 | open the three issues, one per task, and write each issue number into its row | S3, S4 | one | — |
| T2 | the leak check: a test over `odd/tasks/*.md` that fails today on `T11`, `T16`, `T17` and passes when they name issues | S5 | test-first | — |
| T3 | `T16`: the verdict names what it did not verify instead of counting findings as rules — spec 10.3 plus the 0008 errata it needs, then the code | S3 | spec, then code | — |
| T4 | `T17`: the testing policy page and the two links — `AGENTS.md`'s Paths table and `CONTRIBUTING.md`'s checklist both reach `docs/field-loop.md` | S3 | one | — |
| T5 | `T11`: the five one-sided rules measured or declared, the page carrying the result | S3 | one | — |
| T6 | claim audit over the whole feature before it closes | S2 | one | — |

## Log

**L1** — the owner's request, verbatim, is `S1`; the approval is `S2`. `S1` set the order — analysis first, no
implementation — and `S2` named the instrument: judges for the plan and for the claims.

**L2** — the analysis that produced `S3`, from the repository and not from memory. `grep -rc "Commit: —"` over
`odd/tasks/*.md` returned nine rows, of which **six are false positives**: `T2`, `T5`, `T6`, `T8`/`T15a` carry
`Commit: —` because their commits are recorded in the document's own `## Errata`, and two more are sentences
*about* that errata in `release-0.13.0.md:129` and `post-release-debt.md:192`. The remaining three are `T11`,
`T16` and `T17`. The mechanism of the loss, which is the part worth writing down: `T17` sits under a heading
`## Tasks opened after the release` **below** `L16`, which opens *«The campaign closed with three artifacts it
should not have opened»* — an open list inside a document that declares itself closed — and no document
mentions the other, so the `defect-backlog` campaign could not see it. None of the three has an issue, and open
issues are zero, so no surface existed on which they could appear.

**L3** — the plan was frozen at `a59f7539fe964905…` (sha256 of this file before any judgment) and sent to
`jd-judge-a` and `jd-judge-b`, blind to each other, with the same ten questions. Their findings and the
adjudication follow before a line of any task is written.
