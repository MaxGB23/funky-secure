# RFC 0016 — close the loop

| | |
|---|---|
| **Status** | `implemented` — the writing commit names its paths, and the path closes with a commit that tracks the lockfile. `0.8.1`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.7. |
| **Supersedes** | 0015's step list, in two rows. |

## The problem

0015 made `start` followable. A field agent then walked it on a generated Next project and reported two
things left over, both visible in one run.

**The path ended in red.** Step 6 ran `scan --preset starter` and it failed — one error, because
`pnpm-lock.yaml` was not tracked. The finding said so (`→ git add pnpm-lock.yaml`), so it was actionable,
but a path that starts at an empty directory and finishes at a failing scan finishes unfinished. Every
generated repository reaches that exact state, so this was not a corner.

**The writing commit was too broad.** It printed `git add -A`, which stages everything untracked that no
ignore rule covers — in that run, a `.atl/` tool cache sitting beside the generated files. The agent
staged the three files by hand instead. Its reading was right: the tool should not ask for a commit that
sweeps in something it never looked at.

## The decision

**The writing commit names the paths the plan wrote.** `start` already derives the plan and already
knows the absolute path of every `would-write` item; spelling them relative to the working directory is
the same computation `applyPlan` performs for `git status`. Precision costs nothing here and removes a
class of surprise.

**The path closes with a commit that stages the lockfile**, after the install and the writers, before the
scan. It is printed from a fact and not from symmetry: either the install above is about to write a
`pnpm-lock.yaml`, or the report already carries a `lockfile-committed` finding. A repository whose
lockfile is already tracked gets no such step, because a commit that would stage nothing is not a step.

**The first commit keeps `git add -A`.** It runs before the writers, when the tree carries the reader's
own uncommitted work; there the whole state is the subject, and naming files would be guessing.

## What it costs

One more conditional row, one more constant, and a `trackLockfile` boolean threaded from the report.
A generated repository's path grows from six steps to seven — and ends green.

## Verification

- An empty directory prints the writing commit, the first dependency, the lockfile commit, the scan.
- A generated repository with carets prints `init --apply`, the writing commit naming
  `package.json pnpm-workspace.yaml .gitignore`, the install, `pin --apply`, `migrate --apply` with its
  branch, the lockfile commit naming `pnpm-lock.yaml package.json`, and the scan.
- A repository whose lockfile is already tracked gets no lockfile commit.
- A repository already at policy and already tracking its lockfile prints no steps at all.
- The commit after the writers never prints `git add -A`.
- Full suite and self-scan green; `start` still writes nothing.

## Alternatives rejected

- **Print the lockfile commit unconditionally.** In a repository that already tracks it, the step stages
  nothing and the commit fails with "nothing to commit" — a step that cannot succeed is worse than a
  missing one.
- **Keep `git add -A` and document the risk.** The plan already knows its paths. Asking the reader to
  prune a commit the tool proposed is work the tool can do.
- **Let the scan's own remediation be the last step.** It works, but the path would end by explaining
  what it left undone, and the reader would have to run one more command than the path printed.
