# RFC 0015 — the start that can be followed

| | |
|---|---|
| **Status** | `implemented` — `start` prints the commit after the writes, the `pin` step, and the branch `migrate` requires. `0.8.0`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.7. |
| **Supersedes** | 0009's step order. The cause it protected is unchanged; three steps were missing from the path. |

## The problem

A field agent followed `start` on a `create-next-app` project, to the letter. It finished with seven
warnings and no route, and had to improvise three times.

**A verb the path never named.** `create-next-app` writes carets into `package.json`. That is the state
`pin` exists for, and `start` did not mention it: the four steps ended at `scan`, which then reported
what nothing on the path would fix. The tool had the answer and its own guidance withheld it.

**A commit in one position where two are needed.** 0010 added the commit step, because `init --apply`
refuses to write over an uncommitted tree. It printed the commit *before* the writer. But the writer is
what dirties the tree: after `init --apply`, `package.json` carries an uncommitted change, and the next
writer — `pin` — refuses it in turn. The agent used `--allow-dirty` to get past a step the path never
printed, which is exactly the "history nobody asked for" the original step existed to prevent.

**A branch nobody mentioned.** `migrate --apply` refuses to remove a foreign lockfile on `main`. That is
right, and `start` printed the step without the condition, so the refusal was the first the reader heard
of it.

## The decision

**The commit closes the writes it covers.** It keeps its position before `init --apply` when the tree
already carries work — that protects the reader's own state — and it appears again after the writes,
because `init --apply` has just produced the state the next writer refuses. The same command printed
twice is not a mistake; it answers two different questions, and each appearance carries its own line in
`why this order`. A step prints its reason only when it prints.

**`pin --apply` joins the path, after the install.** It is printed when the report carries a
`floating-range` finding, with the count, because the spans come from the same collection the whole
command is derived from. Its position is after step 6 so that a migration has already produced the
`pnpm-lock.yaml` `pin` reads versions from; in a repository that already has one, the step moves up and
the order stays causal.

**`migrate --apply` names its branch in the step itself.** A condition the step cannot be run without
belongs in the step, not in the refusal that teaches it afterwards.

The order is now: `git init`, `pnpm init`, commit (pre-existing work), `init --apply`, commit (the
writes), `pnpm install`, `pin --apply`, `migrate --apply`, `pnpm add`, `scan`. Every step is still
printed only when it applies, and every ordering claim still comes from a cause that is written down.

## What it costs

Two more rows in `start`'s own table, one more reason line, and a test suite whose expectations changed
because the contract did — including one test whose job was to assert that a clean tree is never told to
commit. That test now asserts the opposite, with the reason in its comment: on a clean tree the commit
follows the writes, never precedes them.

It also makes the path longer: a `create-next-app` repository goes from four steps to six. That is the
cost of a path that can be followed, and the alternative was a reader who has to invent the missing
ones.

## Verification

- An empty directory prints six steps, the commit after `init --apply`.
- A pnpm-generated project with carets prints `init --apply`, the commit, `pin --apply`, `scan`.
- An npm-generated project prints the install and the `migrate` step, and that step names the branch.
- An already-dirty tree still prints the commit before `init --apply`, and a second one after.
- `why this order` gains one line per reason and never repeats a reason whose step is absent.
- The full suite and the self-scan are green, and `start` still writes nothing.

## Alternatives rejected

- **Only move the commit after the writes.** Then a tree that already carries someone's work is written
  over, which the writer refuses; the first appearance is not redundant.
- **Let `pin` accept a dirty tree.** It would make the writer that touches `package.json` the one that
  stops being careful. The commit is cheaper and visible in the diff.
- **Print `pin` unconditionally.** A repository already at exact versions would be told to run a step
  that changes nothing. The finding is already computed; refusing to read it would be the same mistake
  this record corrects.
