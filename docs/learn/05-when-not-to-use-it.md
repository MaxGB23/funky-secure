# 05 - When not to use it

Every command page on this path answers six questions in the same order, and the fourth is *when it is
superfluous*. Alone, each answer is one paragraph about one command. Together they are the question this path
exists for: **when does running this tool add nothing?**

This page puts the seven answers in one table so you can compare them, and then writes down the reasoning that
does not fit in a cell. Each line of the third column is something the tool did while I ran it - a read-only or
writes fact, an observed exit code, a refusal, or a line another command had already printed. None of them is a
promise.

## The whole decision

| Command | It adds nothing when | What I observed |
|---|---|---|
| [start](commands/start.md) | a `scan` in the same folder has just named the step you need | `start` printed ten steps, and that folder's `scan` `next` block named the first thing left to do in them |
| [scan](commands/scan.md) | no byte has changed since the last run | two runs, same bytes, exit `1` both times, and `diff` printed nothing |
| [init](commands/init.md) | everything it can write is already written | a second `--apply` printed `nothing to apply` and exited `0` |
| [pin](commands/pin.md) | the manifest is already exact, or the lockfile records no version to pin to | `0 writes · 1 already at policy`, and one range under `not pinned`; exit `0` in both states |
| [migrate](commands/migrate.md) | the foreign lockfile is already gone | a second `--apply` printed `nothing to remove: no foreign lockfile is present` and exited `0` |
| [explain](commands/explain.md) | `--help` is already in front of you, or the rule's own page is open | its thirteen lines reproduce every id `--help` lists; the same bytes in a repository and in an empty folder |
| [skill](commands/skill.md) | nothing in your project is handed to an agent that reads skills | the same scan printed the same bytes after `--install`; a second install printed `–  Current`, exit `0` |

## The three shapes a superfluous run takes

The table has seven rows: three reasons the tool can prove, and one it cannot.

**Read-only, and the input has not moved.** `scan`, `start` and `explain` change nothing, and nothing is
remembered between runs, so the same inputs give the same answer - byte for byte, which I checked with `diff`
rather than assumed. A second opinion would need a changed file; without one, the second run is a copy of the
first.

**It writes, and there is nothing left to write.** `init`, `pin` and `migrate` each print their own zero:
`nothing to apply`, `0 writes · 1 already at policy` with a `not pinned` list, and `nothing to remove`. Each of
those is a line to read, not a failure - and in all three cases the command exits `0`, so the zero is only
visible in the output.

**The answer already exists where you can reach it.** `explain` is the strongest case, because it is a second
copy by design: `--help` prints the same catalog, and the rule's page is the deeper version of the same text.
`migrate`'s step 3 is the same shape - `start` had already printed `pnpm import` for the same repository before
`migrate` did. `pin`'s `next steps` and `scan`'s `next` block are the same line about the same install.

**Nobody is on the other end.** `skill` is the one command whose superfluousness is a fact about you and not
about the folder: it writes instructions for a reader - an agent that reads skills - and if nothing in your
project is handed to such a reader, the file is written for nobody. No rule moves either way: the scan printed
the same bytes before and after `--install`. That is the fourth reason, and it is the only one this page cannot
prove from the tool's own output.

## The exit code is a judgement only once

Of the seven, only `scan` exits `1`. I ran the other six in states where a check would have had to complain - a
repository with five errors, a range the lockfile could not pin, a lockfile that could not be removed, a file
that already existed - and saw `0` (a plan, nothing to write, nothing to remove, already current), `3` (a
refusal, from `init` and from `migrate`) and `2` (from `explain` with an id that is not in the catalog). Never
`1`.

That has a consequence worth stating plainly. A pipeline gated on `start`, `init`, `pin`, `migrate`, `explain` or `skill`
is green in every state it can produce, including the states where nothing was done, so it is not a gate. `scan`
is the command whose exit code means something about your repository, and `--fail-on` is where you say what
counts.

There is a second half to that. The three commands that write also exit `0` from a plan that writes nothing, so
the exit code tells you *the tool answered*, not *you were at policy*. The line that answers the second question
is the summary line, and each of those commands prints one.

## When the tool is not your problem at all

There is a case the table cannot carry, because it is not a fact about a command.

If the folder is a personal exercise - nothing is published, nothing is installed from it by anyone else, there
is no CI and no dependency bot - then most of what the rules describe does not exist in it. There is no runner
whose tree can disagree with yours, no workflow with a token, no default branch an update can reach. Scan it and
you will get answers, and the answers are honest: in a folder with no workflow, four of the six CI rules are
printed under a `–  4 rules not verified:` heading - CI install flags, pull_request_target, Workflow permissions,
Workflow run artifact - which is the tool saying the question does not apply rather than answering it.

What you are buying there is the vocabulary, not a guarantee. Nothing the report finds can be exploited by
anyone, and nothing it fixes can be shipped, so the scan is a quiz you are giving your own folder. That is a
legitimate way to learn this tool - it is how the empty folder in [02 - Your first command](02-your-first-command.md)
teaches you to read a report - and it is not a reason to put it in CI, or to keep running it after the first
time.

## What is left over

If every row above says "nothing", the honest conclusion is that the tool has nothing to add right now: come
back when a byte changes, when a lockfile or a workflow appears, or when someone else installs this repository.
The one thing to keep is the habit of reading the `next` block, because it is the tool's own ordering of what is
left, and it is written whether or not you run anything after it.

**Adds:** the seven superfluous states side by side, sorted into the reasons they actually have - an unchanged
input, a write with nothing left to write, an answer another artifact already prints, and a reader nobody
writes for - plus the one case that is a fact about you: an exercise nobody ships.

---

Next: [06 - Glossary](06-glossary.md), one term, one line.
