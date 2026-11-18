# init

`init` is the only command on this path that changes your files, and it will not change one until you add
`--apply`. Without it, the command is a plan: it prints what it would write, and writes nothing.

## What it answers

*What would this tool change in my repository, and can I read it before it lands?* The answer is a list. Each
item names a file, the change, and a line of reasoning; a `conflict` names a value it will not touch and why;
`next steps` names the commits and the command that follow the writes.

## What it does

With no flag it plans and stops: the title line says `plan only (nothing has been written)`, and after the run
below `git status --porcelain` printed nothing. With `--apply` it performs exactly the items it just printed, in
that order, printing each one with its absolute path and the SHA-256 of the bytes it is about to write. With
`--apply` it also refuses, exit `3`, writing nothing: when a target carries uncommitted changes, and when the
plan holds conflicts and no writable item. It never overwrites a value it did not write - that becomes a
`conflict`, printed, left alone, and not written, because two sources for one setting is the thing it exists to
prevent. Which writes exist, and every flag, are in [`../../cli.md`](../../cli.md).

## When you use it

- Right after `start` prints it, as `funky-secure init --apply` carrying the number of writes the plan is
  holding.
- When `scan`'s `next` block says `funky-secure init  plan the 1 fix it can make`: the plan is that fix, made
  visible before it happens.
- Before you hand the repository to anyone else. It is what puts the workspace block and the ignore block in
  place, and those two decide what the next install is allowed to do.
- As one habit: plan, apply, commit. The plan is read once, applied once, and recorded once, and `init` prints the
  commit that does the recording.

## When it is superfluous

- **In plan mode the exit code is not a verdict.** Without `--apply` it exits `0` with three writes, `0` with no
  write, and `0` with a conflict and nothing writable - all three observed below. So `0` from `init` means "I
  printed a plan". The line that answers whether there is anything to do is `summary  0 writes · ...`, and that
  line is what the command is for.
- **At policy it prints `nothing to apply` and exits `0`.** That was the same folder `scan` had just summed up as
  `next  nothing to do`. And a plan applied twice prints `nothing to apply` the second time, because a write it
  already made is a write it will not repeat.
- **A conflict ends the automatic part.** `--apply` over a plan with conflicts and nothing writable exits `3`
  (the third capture below): understood, refused, nothing written. Running it again changes none of that - the
  cure is an editor, and the plan already named the file and the reason.
- **A dirty target is the same kind of stop.** I edited `package.json` without committing and ran `--apply`: it
  printed the whole plan, then `refusing to write over uncommitted changes: package.json`, and exited `3`.
  Commit first - the plan's own `next steps` is exactly that commit.
- **Do not reach for it before `scan`.** The plan tells you what would change and not whether the change is the
  one you want; the report is what makes the plan judgeable.

## What you will see

Three runs, each in a scratch repository in the system temp directory.

The first has a `package.json` and a `.gitignore` that already ignores everything the rule asks for, so the plan
holds only the manifest and the workspace block:

```
funky-secure init  ·  preset baseline  ·  plan only (nothing has been written)

would write
  C:\Users\cb147\AppData\Local\Temp\gp3qojzH\ga94zLPy\fs-learn-capture\plan-a\package.json
    set packageManager   (sets packageManager to "pnpm@12.3.4")
  C:\Users\cb147\AppData\Local\Temp\gp3qojzH\ga94zLPy\fs-learn-capture\plan-a\package.json
    set devEngines.packageManager   (sets devEngines.packageManager to {"name":"pnpm","version":"12.3.4"} and writes no onFail)
  C:\Users\cb147\AppData\Local\Temp\gp3qojzH\ga94zLPy\fs-learn-capture\plan-a\pnpm-workspace.yaml
    managed block   (minimumReleaseAgeStrict: true, minimumReleaseAge: 1440 and savePrefix: '' turn the quarantine into a gate, declare the day the repository waits and stop a later pnpm add from saving a caret; creating pnpm-workspace.yaml makes this repository a pnpm workspace root)

summary  3 writes · 0 already at policy · 0 conflicts

next steps
  git add package.json pnpm-workspace.yaml && git commit -m "chore: apply funky-secure"
  funky-secure start
```

Exit `0`, and the folder was untouched: `git status --porcelain` printed nothing afterwards.

The second repository declares `minimumReleaseAge` in the workspace file, outside the block `init` manages, so
the only item is a conflict:

```
funky-secure init  ·  preset baseline  ·  plan only (nothing has been written)

conflicts
  C:\Users\cb147\AppData\Local\Temp\gp3qojzH\ga94zLPy\fs-learn-capture\conflict-b\pnpm-workspace.yaml
    managed block   (pnpm-workspace.yaml already declares minimumReleaseAge outside the managed block; two sources for one setting are not written)

summary  0 writes · 0 already at policy · 1 conflict
```

That is exit `0`: a plan you can read, and a refusal you can act on. The same plan with `--apply`:

```
funky-secure init  ·  preset baseline  ·  applying the plan below

conflicts
  C:\Users\cb147\AppData\Local\Temp\gp3qojzH\ga94zLPy\fs-learn-capture\conflict-b\pnpm-workspace.yaml
    managed block   (pnpm-workspace.yaml already declares minimumReleaseAge outside the managed block; two sources for one setting are not written)

summary  0 writes · 0 already at policy · 1 conflict
funky-secure: resolve the 1 conflict in the plan by hand, then re-run init --apply
reason: refusing to write: the plan carries 1 conflict and no writable item
```

Exit `3`. Nothing was written, and `git status --porcelain` printed nothing in that folder after both runs.

The third is the folder where everything is already at policy:

```
funky-secure init  ·  preset baseline  ·  plan only (nothing has been written)

nothing to apply

summary  0 writes · 0 already at policy · 0 conflicts
```

Exit `0`, nothing written, and no `next steps` block - because there is no step after nothing.

## What you do next

Commit what it wrote, using the commit line it printed, and then run `start` again: the state changed, so the
plan has changed too. If the plan carried a conflict, your next action is by hand on the file it named, and then
`init` again to watch the conflict disappear. When the plan is empty, everything `init` can write is already
written; [`scan.md`](scan.md) is where the rest of the repository is judged.

**Adds:** the plan as something you read before anything is written - plan mode exiting `0` over three writes,
no write, and a conflict - and the three states in which the command cannot change your repository at all: at
policy, conflicted, and dirty.

---

Next: `pin`, the command that clears a floating version of its own, when this path reaches it.
