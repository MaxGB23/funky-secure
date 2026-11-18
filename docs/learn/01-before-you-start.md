# 01 - Before you start

Three things have to exist before the first command works: a terminal, Node 22 or newer, and git. This page is
how you get them, and how you check. Every step is a command you type and an answer you read.

This is the page the path would be broken without. "Run a command" is not an instruction to somebody who has
never typed one.

## When this page is superfluous

If you already open a terminal to work, and `node --version` prints `v22` or higher, skip to
[02 - Your first command](02-your-first-command.md). Nothing else here will be new.

## A terminal is a box with two halves

You type one line. It answers. That is the whole idea, and everything else about it is detail.

- **Windows.** Press the Windows key, type `Terminal`, press Enter. If there is no Terminal, type `PowerShell`.
- **macOS.** Press Cmd+Space, type `Terminal`, press Enter.
- **Linux.** Usually Ctrl+Alt+T. If nothing opens, look for "Terminal" in your applications menu.

You will see something like `C:\Users\you>` or `you@laptop:~$`. The text before the `>` or `$` is where you are
and who you are, not something you type. The cursor after it is where your line goes.

If none of those worked, that is not a failure on your part: this step is a normal thing to need help with.
Ask someone to sit next to you for five minutes. The rest of the path waits.

## Node 22 or newer

In the terminal, type this and press Enter:

```
node --version
```

Two outcomes, both normal:

- It prints something like `v22.11.0`. If the number before the first dot is **22 or more**, you are done.
- It prints `command not found`, or `no such file`, or the number is lower than 22. Then install it from
  <https://nodejs.org>: choose the LTS version, run the installer, and **open a new terminal** - the old one
  will not see the new program.

Why 22: this tool uses language features that older Node does not have, and `package.json` declares
`"node": ">=22"`. A lower version fails on the first command, usually with an error that does not mention Node.

The tool does not install itself. `npx funky-secure` downloads it, runs it once, and keeps nothing - no global
install, no state, no background process.

## git

```
git --version
```

It should print a version. If it does not, install it from <https://git-scm.com>.

git is not decoration here. The first command you will run - `start` - builds its advice from facts that only a
repository has: is this directory one, does it have a commit, is there a branch. Pointed at a directory that is
not a repository, `start` stops at the boot steps and tells you to create one and come back, because a plan
printed before there was a git would be a count that the next run contradicts.

For a new project, that means:

```
mkdir my-project
cd my-project
git init
```

`cd` means "go into". `git init` makes the current directory a repository. Nothing is uploaded: a repository is
a folder with a history, and it stays on your machine until you decide otherwise.

## pnpm, and why this page will not install it for you

Most steps the tool prints begin with `pnpm`. It is a package manager: the program that reads your manifest and
your lockfile and decides what to put on disk.

It does **not** come with Node. When a printed step needs it, the tool adds one unnumbered line saying so and
naming <https://pnpm.io/installation>. That line is a reference, not a command, and that is deliberate: the only
command that would produce pnpm is an installation, and **this tool does not choose an installation for you**.

You do not need pnpm to run `start`. You need it when you act on what `start` tells you.

## `command not found`, and the three reasons

Every "command not found" is the same sentence: *I looked for a program with this name and did not find one.*
There are three causes, and they are worth telling apart:

1. **It is not installed.** The usual one. Install it and open a new terminal.
2. **It is installed, but not on the `PATH`.** The `PATH` is the list of places your shell searches. A fresh
   install often lands outside the terminal you already had open - which is why every fix above ends with
   "open a new terminal".
3. **It is a typo.** `gi t --version` and `git --versoin` both produce the same message.

The message is not an accusation. It is a lookup that came back empty.

## What you should have now

- a terminal you can open;
- `node --version` printing 22 or more;
- `git --version` printing something;
- no pnpm required yet, and a link for when it is.

If all four are true, you are ready. If one is not, fix it now: page 02 assumes this page, and every later page
assumes page 02.

---

Next: [02 - Your first command](02-your-first-command.md).
