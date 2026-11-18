# 01 - Before you start

Three things have to exist before the first command works: a terminal, Node 22 or newer, and git. This page is
how you get them, and how you check. Every step is a command you type and an answer you read.

This is the page the path would be broken without. "Run a command" is not an instruction to somebody who has
never typed one.

## When this page is superfluous

If you already open a terminal to work, `node --version` prints `v22` or higher, and `git --version` prints a
version, skip to [02 - Your first command](02-your-first-command.md). Nothing else here will be new.

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
- It prints a message saying the shell cannot find the program - `command not found` in a Unix shell, `not
  recognized as the name of a cmdlet` in PowerShell - or the number is lower than 22. Then install it from
  <https://nodejs.org>: choose the LTS version, run the installer, and **open a new terminal** - the old one
  will not see the new program.

Why 22: this tool uses language features that older Node does not have, and `package.json` declares
`"node": ">=22"`. A lower version fails on the first command, usually with an error that does not mention Node.

The tool does not install itself. `npx` - the program npm ships to run a package without installing it -
downloads `funky-secure`, runs it once, and installs nothing globally. npm may keep a download cache; the tool
never reads it and never keeps state of its own.

## git

```
git --version
```

It should print a version. If it does not, install it from <https://git-scm.com>.

git is not decoration here. `start` builds its advice from facts only a repository has: whether this directory is
one, whether it has a commit, whether there is a branch. Pointed at a directory that is not a repository, it prints
the three boot steps and says why in its own words - *the plan is derived from a repository: the ignore rule and
the clean-tree question are answered only by git* - and asks you to come back.

For a new project this page stops here: it only wanted `git --version` to print something. Page 02 makes the
first folder and runs `git init` in it, where you can watch what it leaves behind.

## pnpm, and why this page will not install it for you

Some of the steps the tool prints begin with `pnpm`. It is a package manager: the program that reads your manifest
and your lockfile and decides what to put on disk. It does not come with Node, and the steps `start` prints do not all exist at once: an empty folder gets three, a
folder with a manifest gets more, and at most two of them begin with `pnpm`.

When a printed step needs it, the tool adds one unnumbered line naming <https://pnpm.io/installation>. That line is
a reference and not a command, and [`../cli.md`](../cli.md) gives the reason in its own paragraph: the only command
that would produce pnpm is an installation, and the tool does not choose one for you.

You do not need pnpm to run `start`. You need it when you act on what `start` tells you.

## When the shell cannot find a program

The message differs by shell, and both forms mean the same thing: *I looked for a program with this name and did
not find one.*

- A Unix shell - bash, zsh, the macOS and Linux terminals - prints `command not found`.
- PowerShell prints `The term 'name' is not recognized as the name of a cmdlet, function, script file, or operable
  program`. A localized Windows prints that sentence in its own language, which is why the words can look
  unfamiliar and still be this message.

There are three causes, and they are worth telling apart:

1. **It is not installed.** The usual one. Install it and open a new terminal.
2. **It is installed, but not on the `PATH`.** The `PATH` is the list of places your shell searches. A fresh
   install often lands outside the terminal you already had open - which is why every fix above ends with
   "open a new terminal".
3. **It is a typo.** `gti --version` produces this message; the program genuinely is not there.

That third item has a lookalike worth knowing, because the messages differ and the cure does too: `git --versoin`
run with git installed prints git's own complaint about the flag. git **was** found, so this is not a lookup that
came back empty. Found and unhappy is one problem; not found at all is another.

The message is not an accusation. It is a lookup that came back empty.

## What you should have now

- a terminal you can open;
- `node --version` printing 22 or more;
- `git --version` printing something;
- no pnpm required yet, and a link for when it is.

If all four are true, you are ready. If one is not, fix it now: page 02 assumes this page, and every later page
assumes page 02.

**Adds:** the terminal, the Node version and the git that every later page assumes, and the reason the tool
refuses to choose an installer for you.

---

Next: [02 - Your first command](02-your-first-command.md).
