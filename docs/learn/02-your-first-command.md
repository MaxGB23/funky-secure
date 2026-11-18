# 02 - Your first command

You have a terminal, Node 22 or newer, and git. This page runs the tool once, in an empty folder, and then
reads what it answered, in the order it answered.

## A folder to stand in

Two lines, one after the other:

```
mkdir my-first-project
cd my-first-project
```

`mkdir` makes a folder and `cd` walks into it. Everything on this page happens inside that folder, so it is
worth knowing how to look at what a folder holds:

```
ls -A
```

Nothing. `ls` lists the folder's contents, and `-A` adds the hidden entries a plain listing leaves out. A folder
you just made holds nothing, and that silence is the "before" of a check further down this page. In PowerShell
`ls -A` stops with an error about a parameter; the same question there is `Get-ChildItem -Force`.

## The command

Type this:

```
npx funky-secure start
```

Here is what it printed, in a new, empty folder on this machine:

```
funky-secure start  ·  guidance, nothing is written

  1  git init
  2  pnpm init
  3  funky-secure start

  pnpm does not come with Node; if it is not on your PATH, see https://pnpm.io/installation

  the plan is derived from a repository: the ignore rule and the clean-tree question are answered only by git

not run  6 of 13 rules; off by policy: Environment files, Pinned actions, Bot
         auto-merge, CI install flags, pull_request_target, Workflow permissions,
         Workflow run artifact
```

I made that capture with a copy of this repository, `node bin/funky-secure.js start`, rather than through
`npx`: the package's `package.json` declares `funky-secure` as the name for `bin/funky-secure.js`, so both
spellings reach the same program. Everything it printed came from the folder it stood in, and that folder was
empty.

## Reading it, line by line

**The first line names the command and makes one promise.** `funky-secure start  ·  guidance, nothing is
written`. `start` is the command, "guidance" is the kind of answer, and "nothing is written" is a promise you
can check, below.

**Then three steps, numbered, and the numbering is the point.** This is not a menu. Each line depends on the
one above it, so the order is part of the answer. Step 1 is `git init` because two of the tool's questions can
only be answered by a repository: whether your ignore rule really ignores what it claims to, and whether the
working tree is clean. Step 2 gives the folder a manifest, the `package.json` page 00 introduced, and it
belongs to pnpm rather than to this tool. Step 3 is the same command you just ran, because the two steps above
it changed the folder, and the plan is read from the folder.

**Then an unnumbered line beginning with `pnpm`.** It is a reference and not a step, and it names the condition
it answers: if pnpm is not on your `PATH`, the install page is at that address. If pnpm is already there, the
line is not addressed to you.

**Then one plain sentence about where the list came from.** *the plan is derived from a repository: the ignore
rule and the clean-tree question are answered only by git*. That is the tool saying why the list stops at three
steps: there is no repository to ask yet. It is also why step 3 exists, and why the list will be longer the next
time.

**Then the coverage block.** `not run  6 of 13 rules; off by policy: ...`. The number counts the rules that do
run: six of the thirteen. The names after the colon are the seven that do not, because `starter` - the preset
`start` recommends - switches them off. Read it as a warning about a green report later: that pass will be a
pass over six rules, not thirteen. [`../guide.md`](../guide.md) goes through this block properly.

## It exits 0 and writes nothing

Two claims, and you can check both.

- **It wrote nothing.** `ls -A` in the same folder still prints nothing. The title line said so and the folder
  agrees.
- **It exited 0.** In a Unix shell, put `echo $?` on the next line: it prints the number the last command left
  behind. In PowerShell the same number is `echo $LASTEXITCODE`. Both print `0` after this run.

Read the `0` as "I answered", not as "your project is fine". `start` exits `0` whatever state the folder is in,
because it is advice and advice cannot fail; the only nonzero code it can produce is a usage error, `2`, from a
mistyped flag. A verdict is what `scan` is for, on page 03.

## Now git init

If your folder is still not a repository, type the first step:

```
git init
```

It answers with a line naming the folder it made, the one ending in `.git/`. Look with `ls -A` and this time
there is exactly one entry: `.git`. That folder is the repository - the history, the branch, and the settings
git will read next time - and it sits inside your folder like any other. None of your own files move or change.

Nothing leaves your machine. `git init` builds all of that on your disk: there is no account, no server, and
nothing sent anywhere. You can see the last part for yourself: `git remote -v` prints nothing, which is how you
check that this repository has no other home yet. A copy elsewhere appears only when you name an address
yourself and run a command that sends it.

Now run `funky-secure start` again, in the same folder. The list is different: seven steps, and `git init` is
not one of them, because it is done. That is the whole reason the plan is numbered and read from the folder -
after each step, the next answer changes.

## What this page is not

This is a concept page, not a command page. The command pages come later in this path, and each answers six
questions in one fixed order: `What it answers`, `What it does`, `When you use it`, `When it is superfluous`,
`What you will see`, `What you do next`. `start` gets one of those pages, and there those six are the
structure. A concept page has a different job: to leave you able to read your own run without one.

**Adds:** the first run of a first command: what an empty folder prints, why those three steps come in that
order, and the two checks - the folder still empty, the exit code `0` - that show the run did what it said.

---

Next: [03 - Reading the output](03-reading-the-output.md).
