# 00 - The problem

No terminal on this page. No commands. Just the thing this tool is for.

## A kitchen you let strangers into

Imagine you cook at home. You do not grow the vegetables, so you order them. Fine. Now imagine the delivery
person arrives, walks into your kitchen, opens your drawers, installs a new tap, and leaves a note saying
"thanks, by the way, I also changed the locks".

That is what installing software from the internet looks like, and most people never notice, because the visit
is fast and the note is in a language they were never taught.

Three things happen when you add a package to a project:

1. **You do not get one thing, you get hundreds.** The package you asked for needs other packages, which need
   others. A small project can pull in several hundred of them, written by people you have never heard of.
2. **They can run code.** Many packages execute a script during installation - to build themselves, to download
   a binary, to check your environment. That script runs with your permissions, on your machine, before you have
   asked for anything.
3. **The version you test is not always the version you ship.** A friendly declaration like `^1.2.0` means "one
   point two or newer, but not two" - so the machine that installs tomorrow can get code nobody tested today.

None of this is a defect in the package ecosystem. It is how the ecosystem works, and it is why it grew fast.
The point is different: **the code runs on your machine whether or not you know what it does.**

## Why you cannot check this by eye

You could open the packages and read them. In practice nobody does: a few hundred packages is tens of thousands
of files, and most of it is not written for a human to read. Even if you did, the interesting decision - which
version, from where, running which script - is not in the code. It is in three files that sit next to it.

Those three files are the whole subject of this tool:

- **A manifest.** `package.json`. The list of what you asked for. Small, honest, and not the truth: it records
  what you requested, not what you got.
- **A lockfile.** `pnpm-lock.yaml` or `package-lock.json`. The list of what actually arrived, down to the exact
  version of every package, including the ones you never asked for. When it is committed to the repository, it
  is the difference between "this worked on my machine" and "this is what we ship".
- **The configuration around them.** Where packages come from, whether installation scripts may run, how long a
  brand-new release has to exist before it is trusted. It is usually invisible, and it decides more than the
  other two.

A person reading these by hand can catch a mistake. A person cannot do it on every change, in every project, for
years.

## What a tool can do about it

A tool can read those files and answer one question the same way every time: **does this repository install
what it says it installs, from where it says, under rules you chose?**

That is all `funky-secure` does. It prints what it read, the line where it read it, and a verdict. It does not
scan the source of the packages - that is a different tool and a different question. It does not fix anything
until you ask it to.

The refusal to do more is deliberate: a tool that quietly rewrote your project would be a second stranger in
your kitchen.

## When this problem is not your problem

If you are learning to program and your project is an exercise on your own laptop, nobody ships it, and the
worst outcome is a reinstall - then reading this path costs more than the risk it prevents. Keep the three
files in mind, and come back when someone else depends on your code.

The tool itself is honest about the same limit: one of its rules exists only to tell you that a decision was
made by your machine rather than by your repository, and it reports that as a gap instead of a pass.

---

Next: [01 - Before you start](01-before-you-start.md), where the terminal appears.
