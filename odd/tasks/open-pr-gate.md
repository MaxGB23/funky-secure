# The merge gate

What the ritual refuses, and the evidence behind each refusal.

This record exists because twelve units changed the same seam in one night and only one of them had a
document of its own (`open-pr-candidate-set.md`). The unit that is missing is the whole: what the gate
decides, and which measurement made each rule necessary. `AGENTS.md` states the rules a reader must
follow; `docs/decisions.md` argues them one at a time (`I-73` to `I-76`); this page is the arc.

## Specs

- **S1** A pull request fires more than one run for one commit, so the newest run is not the answer. The
  set of runs past a floor, read before the creation, decides: any red wins, an all-green set is green
  naming every id, and a set still moving when the budget runs out is `2`. (`#231`)
- **S2** A `gh` child without a ceiling does not fail, it hangs, so every child carries one. (`#233`)
- **S3** `pr-policy` reads the labels the pull request has **now**, never the payload of the event that
  fired the run. Measured on `#233`: the `opened` run can see `PR_LABELS` empty even when the label
  travelled in the creation. (`#235`)
- **S4** A child that reaches its ceiling marks **that child** undecided; it never discards a candidate
  that is already known to be red. (`#238`, `#239`)
- **S5** The ritual refuses a branch on the remote that is not the commit in front of it. Measured on
  `#241`: ten minutes and a `2` whose reason was true and useless. (`#243`)
- **S6** `--timeout` is the budget of the whole delivery, not a ceiling per child: every child reads what
  is left of it, floored at one second. Before, a declared ten minutes could hold the ritual open for
  forty. (`#245`)
- **S7** A creation that fails adopts a pull request only on two pieces of evidence: **the creation
  failed**, and **the row is at the commit under test**. `gh`'s refusal wording is not evidence, and a
  creation killed at its ceiling is never adopted. (`#247`)
- **S8** Every message that carries a number carries the number that was **delivered** — the ceiling the
  child was handed, the seconds the wait received. A correct line and a checked line are different
  things. (`#251`)

## Tasks

| id | spec | commit on `main` |
|---|---|---|
| T1 | S1 | `34fab04` |
| T2 | S2 | `60eeb09` |
| T3 | S3 | `05625ac`, then `7e8e36f` for the ceiling on that read |
| T4 | S4 | `725dba8` |
| T5 | S5 | `82f2572` |
| T6 | S6 | `87bd0a1` |
| T7 | S7 | `c40a536` (two commits: the port, then the hardening a review forced) |
| T8 | S8 | `8ef678a` |

## Log

**L1 — the arc's framing instruction, quoted verbatim; the todo list it responded to predates this
context and is not reproduced as if it were the owner's words:**

> continua todo, solo para cuando requieras una decision critica.

**L2 — the correction that produced S5.** The owner noticed a job had run for ten minutes and asked for
it to be looked at. Its cause was the local `HEAD` being watched instead of the pull request's head.

> guarda en memoria, compactare contexto, ya tardo mucho el job, revisalo

**L3 — the order he chose for the port.** Told that `funky-forge` already had the adoption reviewed on a
branch, he chose the copy over writing it again in parallel.

> mergea el pr y arranca, te doy permiso

**L4 — the one maintainer decision the provider asked for.** A native review escalated with two
corroborated findings and one of unknown causality, and stopped terminally. Asked whether to merge
unreviewed, leave the branch, or hunt the findings by hand:

> C

The findings were in `.git/gentle-ai/review-transactions/v2/<lineage>/review-state.json`. Three were
CRITICAL and all three were real. That path is the reason S7 demands two pieces of evidence.

**L5 — the scope of the last pass, including the merge.**

> dale, aplica todo, incluso el merge del paso 0

**L6 — the record itself was his decision, not a tidy-up I volunteered.**

> tocamos docs o no vale la pena? … dale, ambos. Y recuerda a forge tambien

## Slice

`#247` merged 518 authored lines in two commits, past the ~400-line guide, deliberately: the first commit
alone would have shipped the adoption that the review called CRITICAL. Every other unit stayed inside the
slice. This is the boundary the rule asked to be written down.
