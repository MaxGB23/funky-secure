# RFC 0008 — Refusal and verification honesty

| | |
|---|---|
| **Status** | `implemented` — a refusal is its own exit code, and a verdict names what it did not verify. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/report.md`](../../docs/spec/report.md) §10.4 and §10.3, and [`docs/cli.md`](../../docs/cli.md) "Exit codes". |
| **Supersedes** | nothing. It separates two outcomes §10.4 had conflated, and adds a count §10.3 left to the body. |

## The problem

Two places where the report said less than it knew, both found by an agent auditing a real repository
and both invisible to anyone reading the output the way its author read it.

**A refusal shared the code of a crash.** `migrate --apply` on the default branch printed
`switch to a feature branch and re-run migrate --apply` and exited `2`. §10.4 reserves `2` for "the tool
could not answer … Never used for a policy violation", and the tool answered perfectly: it read the
branch, understood what it meant, and decided not to delete a lockfile. A script or an agent branching
on the exit code could not separate that decision from a crash, and `git` failing to report the branch —
the actual unanswerable case — produced the identical code.

**A verdict claimed more than it checked.** `scan --scope repo` printed `verdict  PASS` while two rules
were `not verified`. The skip lines below said which, and the `summary` line counted them, so nothing
was false. But the verdict is the line a reader stops at and the line a CI log greps, and it read as
"checked".

## The decision

**An exit code names one thing, and a refusal gets its own.**

| Code | What it names |
|---|---|
| `0` | a report within the threshold |
| `1` | a report past it |
| `2` | a question the tool could not answer |
| `3` | a decision not to act: understood, refused, nothing written |

The line between `2` and `3` is drawn per call site, not per command, because the same command can do
both: `migrate --apply` refuses when the branch is the default one (`3`) and cannot answer when `git
rev-parse` fails (`2`). Both still print the action first and the diagnosis after `reason:`, so a human
reading either is unaffected.

**A verdict names the rules it did not verify.** `PASS (threshold: error · 2 rules not verified)`. The
count appears only when it is not zero, so a scan that verified everything renders byte-identically to
what it rendered before, and the skip listing stays where it is: the header states the coverage, the
body states the reason.

## What it costs

One new exit code, which is a contract addition rather than a break: `0` and non-zero keep their
meaning, so a CI job that only distinguishes them behaves as it did. The `2` row loses "or a refused
write", which was the conflation itself.

The JSON document does not move — `summary` already carried the skip count — so every golden is
unchanged except where the human rendering is captured, which it is not.

## Verification

- `migrate --apply` on the default branch exits `3`; the same command with `git rev-parse` failing
  exits `2`. Both print two lines and leave every file in place.
- `init --apply` over a dirty target exits `3`.
- `skill --install` over a symbolic link exits `3`; `skill` that cannot ask (no terminal) stays `2`,
  because there the tool genuinely could not ask.
- A malformed config still exits `2`.
- `scan --scope repo` on a repository with two unverified rules now reads
  `verdict  PASS (threshold: error · 2 rules not verified)`; a full scan renders as before.

## Alternatives rejected

- **Keep `2` for refusals and document it.** The code would still name two different outcomes, which is
  what made the field report possible.
- **Exit `1` for a refusal.** A refusal judged nothing about the repository; reusing the violation code
  would make an agent treat a dirty tree as a security finding.
- **Name the unverified count only in `summary`.** It was already there, and it was not read. The
  verdict is the line that gets quoted.
