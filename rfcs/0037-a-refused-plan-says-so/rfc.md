# RFC 0037 — a refused plan says so

| | |
|---|---|
| **Status** | `draft` — `init --apply` exits `3` when the plan writes nothing and carries a conflict. Issue #303. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.2, the `--apply` safety rules, as amended here. |
| **Supersedes** | nothing. It finishes what I-58 left unnamed: "a conflicted plan that refuses everything is a contract change and is left to its own record". |

## What is true today

`init --apply` exits `0` whether it wrote the plan or refused every item in it. That is correct for one
shape and wrong for another, and the two were never separated.

Measured at `72a8a96`, a plan of two writes and two conflicts — a pin declared with another version, and
`savePrefix` outside the managed block — exits `0` and writes the two items that could be written. I-58
justifies it: exit `3` promises nothing was written, and something was.

A plan where **every** item is a conflict writes nothing, refuses everything, and still exits `0`.
`src/commands/init.js:83` skips the zero-write fast path only when a conflict is present
(`if (apply && writes.length === 0 && !conflicts)`), so such a plan reaches `applyPlan`, prints
`nothing to apply` and returns `0` (`src/lib/plan.js:284-287`).

## Why that is a defect

Exit `3` means "understood and refused, nothing was written" (`docs/spec/report.md:234`). A refused plan
is that definition without a remainder: the tool understood the repository, refused every item it was
asked to write, and wrote nothing. Reporting `0` says the command did what was asked, and a script that
runs `init --apply && funky-secure scan` proceeds as though the repository had been initialised when it
had not.

The distinction I-58 defended survives this record: a plan that writes **anything** still exits `0`,
because the promise attached to `3` would be false there.

## Decision

`init --apply` exits `3` when, and only when, the plan performs zero writes and carries at least one
conflict. It prints the plan first, as it does today, so the reader sees which items were refused and
why; the exit code adds the fact a script needs.

Nothing else moves. A conflict inside a plan that writes something keeps `0` (I-58). A clean plan keeps
`0`. A plan refused for a dirty target keeps `3` before any write is planned. `init` without `--apply`
keeps `0` in every case, because a plan is an offer and nothing was asked to be written — which is also
why this record changes the `--apply` row and not the command's default.

## Conformance

Two tests, one per side of the line: a conflict-only plan under `--apply` exits `3` and leaves every
file byte-identical, and a plan with one write plus one conflict exits `0`, writes the write, and leaves
the conflicted item alone. The second is the one that fails if this record is ever widened.

## What this does not do

It does not decide what to do with a conflict — neither auto-resolving it nor refusing the whole plan
when part of it is writable. It names an outcome the tool already produces and gives it the code the
vocabulary already has.

## Errata

**2026-11-16 — the shape of the refusal.** The claim audit of the implementation (#305) found that the
refusal printed the plan, then `nothing to apply` from `applyPlan`, and then exited `3`: the last line a
script reads said nothing was wrong. Every other refusal of this command ends with a `funky-secure: …`
line and a `reason: …` line (`docs/spec/commands.md` §11.3), and this one now does too, naming the
conflict count. The decision is unchanged; the record never said what the refusal's last line was, and
silence there was read as success.

The same audit found §11.2 worded as "a plan in which every item is a conflict", narrower than this
record's "zero writes and at least one conflict": a plan carrying a `would-skip` beside a conflict writes
nothing and is covered here, but not by that sentence. §11.2 now says what the code does.
