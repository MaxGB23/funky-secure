# funky-secure: the `next` line

Specification and tasks for one increment: a human `scan` ends by naming the single command that
moves the repository forward, instead of leaving a FAIL without a next step.

## Specs

S1. After the `summary` and `verdict` lines, the human output of `scan` ends with a `next` block. The
label column matches the existing labels, so `next` occupies the same nine-character gutter as
`summary` and `verdict`, and continuation lines are indented to match.

S2. The `next` block has exactly three shapes, decided by the report and nothing else:

- At least one failing finding whose remediation kind is `auto`:
  `next     funky-secure init` followed, on the same line, by `plan the N fixes it can make (nothing is
  written)`, where N is the number of failing findings with an `auto` remediation.
- Verdict `pass`: `next     nothing to do: everything at or above the policy passes`.
- Verdict `fail` with no `auto` remediation: `next     manual: each finding names the file, its line,
  and the action`.

S3. When the block names `funky-secure init`, a second line names one rule to read next:
`funky-secure explain <rule>`, where `<rule>` is the highest-severity failing finding, ties broken by
catalog order. No other rule is named, so the output stays deterministic.

S4. The block is human output only. The JSON document does not gain a field: the machine contract is
frozen at revision 6 and a reader that wants the plan runs `init` for it.

S5. Determinism holds: no absolute path, no timestamp, no machine-specific value, no wording that
depends on the terminal. Two runs over the same state produce the same bytes.

S6. `docs/cli.md` shows the block in the `scan` sample, `docs/guide.md` says what it means for a reader
who just saw a FAIL, and RFC 10.3 carries the contract.

## Tasks

| Id | Task | Spec | Route | Commit |
| --- | --- | --- | --- | --- |
| T1 | RFC revision 7: 10.3 carries the `next` block, acceptance 21.3 gains its item | S1-S6 | inline | 902c335 |
| T2 | Implementation, tests, docs, Appendix D corrected | S1-S6 | gentle-ai-worker | 902c335 |

## Log

L1 — 2026-10-26, the owner, after running the initialization flow by hand:

> no tenemos un comando que haga un check minimo de la config actual y que sea mas intuitivo o
> amigable?

Measured on a fresh repository: `scan` reported `summary 3 errors · 1 warning · 0 info · 5 passing ·
4 skipped` and `verdict FAIL (threshold: error)`, then stopped. Each finding carries its own
remediation, but nothing named the single next command, and the owner read that as the tool being
unfriendly rather than the repository being at fault.

L2 — 2026-10-26, delivered on `feat/next-line`; the merge commit on `main` is the durable evidence, because the branch commit was amended twice and a recorded SHA would have gone stale on each amend. The worker found the three shapes and the catalog
tie-break, and the parent review fixed what it left: the count read "plan the 1 fixes", the command and
its explanation ran together in one sentence, and two pages contradicted the new block — the
architecture page still claimed the renderers never choose, and Appendix D.1 ended at the verdict while
D.2 still said 0.1.0. Suite 355/355, self-scan PASS, goldens untouched because they are JSON.
