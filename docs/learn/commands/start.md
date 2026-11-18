# start

`start` tells you what to type next in a folder. Not what is wrong with it - that is `scan`'s question. This page
is about the first command, and about the moment it has nothing left to say.

## What it answers

*What do I type next, in this folder?* One answer: the steps that still apply, numbered in the order that makes
them work. It does not say whether your project is good. It says which commands come next, and why that order is
the order.

## What it does

It reads the folder it stands in - whether this is a git repository, whether it has a commit, a manifest, a
lockfile, another manager's lockfile, a version that floats, the block `init` manages - and prints the steps that
are still missing. It writes nothing at all, installs nothing, and touches nothing on the machine. It accepts
`--help` and no other flag: a flag that belongs to another command is a usage error, and the two lines it prints
name the command that does take it. Where the list has more than one step it adds `why this order`, and it ends
with the coverage line of the preset its last step recommends. Every flag, and what each step means, is in
[`../../cli.md`](../../cli.md).

## When you use it

- The first time you open a folder you have not set up. This is the command that tells you where to begin.
- After each step it printed. The list is read from the folder, so it changes as the folder changes, and a step
  you have finished is a step it no longer prints.
- When you do not know whether a folder is a repository, has a manifest, or has a lockfile. It answers all three
  in one look, in the order they have to be fixed.

## When it is superfluous

The command is read-only, so running it never costs more than a second - but harmless is not the same as useful,
and three facts make it the second one.

- **It cannot fail, so it is not a check.** It exits `0` in every state, including a repository that needs
  nothing: I ran it in two folders, one with seven steps left and one with none, and both left `$?` at `0`. A `0`
  from `start` means "I answered", never "your project is fine". If your question is whether the project is fine,
  this is the wrong command; `scan` is the one with a verdict.
- **Past the start, the whole answer is one line.** It says `the repository is past the start; the next step is
  funky-secure scan --preset starter` and prints no list at all (the second capture below). At that point it has
  nothing the report's own `next` block does not already say.
- **The last step of its own plan is a scan.** `funky-secure scan --preset starter` is always the final line, so
  a reader who has just followed the plan and is now wondering whether to run `start` again is wondering whether
  to be told to scan a second time. And the failing report on [`scan.md`](scan.md) shows the `next` block naming
  `funky-secure init` for the fix it can make: the same advice, from the report itself.

The concrete case: you already followed the list, committed the writes, and `scan` prints `next  nothing to do`.
Then `start` prints its one past-the-start line, and you have learned nothing you did not already know.

## What you will see

This ran in a scratch repository in the system temp directory: `git init`, one commit, a `README.md`, and no
manifest. The plan starts at `pnpm init` because the two git questions are already answered.

```
funky-secure start  ·  guidance, nothing is written

  1  pnpm init
  2  funky-secure init --apply  plan the 2 writes
  3  git add pnpm-workspace.yaml .gitignore && git commit -m "chore: apply funky-secure"
  4  pnpm add <your first dependency>
  5  git add package.json && git commit -m "chore: add the first dependency"
     if the manifest already declares the package, this commit has nothing to do and exits 1
  6  git add pnpm-lock.yaml && git commit -m "chore: track the lockfile"
  7  funky-secure scan --preset starter

  pnpm does not come with Node; if it is not on your PATH, see https://pnpm.io/installation

why this order
  the workspace block has to exist before the install that reads it, and a lockfile can
  only exist after the first add
  a writer refuses a tree with uncommitted work, so the commit after the writes is what lets the next one run

not run  6 of 13 rules; off by policy: Environment files, Pinned actions, Bot
         auto-merge, CI install flags, pull_request_target, Workflow permissions,
         Workflow run artifact

  if a writer refuses, funky-secure explain <rule> names the reason; pass --allow-dirty only when you understand it
```

It exited `0`, and a `git status --porcelain` in that folder printed nothing afterwards: the title line promised
"nothing is written", and the folder agrees.

The same command in a folder where everything has been done - manifest, workspace block, ignore block, lockfile,
all committed:

```
funky-secure start  ·  guidance, nothing is written

the repository is past the start; the next step is funky-secure scan --preset starter

not run  6 of 13 rules; off by policy: Environment files, Pinned actions, Bot
         auto-merge, CI install flags, pull_request_target, Workflow permissions,
         Workflow run artifact
```

Also exit `0`. One line of answer, then the coverage block, which describes the preset and not your repository.

`start` takes no other flag, and the refusal is short:

```
funky-secure: drop --preset or pass it to scan or init
reason: --preset is not accepted by start (accepted by scan, init)
```

Exit `2`, and nothing was written either, because a usage error never reaches the folder.

## What you do next

Run step 1, then run `start` again: the numbering is not decoration, and the shorter list after the first step is
the proof. When the answer is the one-line past-the-start version, the command has handed you to `scan`. Read
[`03-reading-the-output.md`](../03-reading-the-output.md) for the shape of that report, and [`scan.md`](scan.md)
for the command itself.

**Adds:** the decision in place of the description: two folders side by side, seven steps and one line, both
exit `0` - so the plan is advice to re-run after each step, never a check on your repository.

---

Next: [scan](scan.md), the audit the plan ends at.
