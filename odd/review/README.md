# How a candidate is reviewed

Every change to this repository is a sequence of **work units**, and a work unit is what gets
reviewed. This file states how a candidate is produced, how an oversized one is split, and how the
result is recorded. It exists because the alternative — a reconstruction branch that looks like
another version of the code — invites work against the wrong tree.

## What a candidate is

A candidate is **one commit**, on a branch, containing everything the change needs: the source, its
tests, its documentation and its fixtures. It is not the accumulated feature branch, not a batch of
checkboxes in `odd/tasks/`, and not a diff assembled by hand.

Its size target is about **400 authored lines**. Generated files (goldens, lockfiles) do not count
toward the target, but they do count toward what a reviewer must read.

The task file records, for every verified work unit, the four facts a later audit needs: the
**lineage**, the **base commit** the candidate was diffed against, the measured **line count**, and
the **verdict**. `odd/tasks/funky-secure-v0.1.md` L13–L14 is the reference format:

```
- **Slice 2, `init` and `migrate`** — lineage `review-slice2-init`, base `5ef01bf`, 2,222 lines, four
  lenses, tier medium. Five severe findings, one bounded correction of 125 lines (`9d9e9e8`,
  cherry-picked to `ea09bf1`). Validator approved.
```

## Splitting an oversized candidate

When a unit cannot be made small — a catalog, a scaffolding, a schema shared by everything — split it
**by concern, in dependency order**, so each slice is reviewable alone:

1. Contracts and readers first, then consumers, then commands, then docs.
2. Every slice must build and pass the suite on its own, and the last slice must leave the tree
   byte-identical to what the unsplit candidate would have produced.
3. Each slice gets its own candidate and its own verdict. A finding in slice 2 never reopens slice 1.
4. The split is recorded in the task file next to the slice entries, naming which commits carry which
   part.

The historical case is the nine-rules unit of `0.1.0`: 3,851 lines, split into R1–R4 and R5–R9 so the
candidate could be reproduced at all. That reproduction lived on a local branch and was never pushed;
it is recorded in `odd/tasks/funky-secure-v0.1.md`, and the convention above is what replaces it.

**What is never done:** a reconstruction branch on the remote, a per-slice branch pushed as "the"
candidate, candidate bytes handed over through a temporary file or a scratch path, or a review run
against the live worktree instead of the frozen tree of the commit.

## What a review decides, and what it does not

- Only **candidate-caused severe findings** block. A finding that already exists in the base is a
  follow-up, filed separately; unknown causality escalates instead of being assumed harmless.
- A correction is a **bounded commit** that answers the corroborated findings. It does not become a
  re-review of the same bytes, and it does not silently expand the change.
- **Advisory findings are backlog, not blockers.** `odd/tasks/funky-secure-v0.1.md` records fourteen
  of them for the next release rather than keeping finished candidates open.
- A review is **an outside view, never a substitute for the checks**: the suite, the drift gate, the
  goldens and the self-scan run either way.
- A review outcome never authorizes delivery. Commits, tags, publication and merges stay human
  decisions under section 17 of the RFC.
