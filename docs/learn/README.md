# Learn funky-secure

This is a path, not a reference. It starts from nothing: no terminal, no Node, no idea what a lockfile is. It
ends with you running this tool on your own project and understanding every line it prints.

Read it in order. Each page assumes the one before it.

## What you will be able to do

By the last page you can:

- open a terminal and run a command without guessing;
- read a report and say which finding matters and why;
- fix what the tool can fix, and know what it deliberately will not touch;
- recognise the moment when using this tool adds nothing.

That last one is the reason this path exists. Every **command** page answers six questions, in the same order, and
one of them is **when it is superfluous**. The pages before them are concepts and do not carry the six.

## The path

| # | Page | Read it when |
|---|---|---|
| 00 | [The problem](00-the-problem.md) | always. It needs no terminal |
| 01 | [Before you start](01-before-you-start.md) | you have not opened a terminal on this machine |
| 02 | [Your first command](02-your-first-command.md) | you have a terminal and Node 22 or newer |
| 03 | [Reading the output](03-reading-the-output.md) | you have run your first command and want to see what an audit answers |
| 04 | [Why the rules exist](04-why-the-rules-exist.md) | a finding surprised you and you want the attack behind it |
| 05 | [When not to use it](05-when-not-to-use-it.md) | before you put it in CI, or before you run it for the tenth time |
| 06 | [Glossary](06-glossary.md) | a word in the report means nothing to you |
| — | Commands, one page each: [start](commands/start.md) · [scan](commands/scan.md) · [init](commands/init.md) · [pin](commands/pin.md) · [migrate](commands/migrate.md) · [explain](commands/explain.md) · [skill](commands/skill.md) | you know what you are doing and want one command in detail |

The last row is seven pages - one per command, in the order the path meets them - and each answers the same six
questions, the fourth of which is the one no other page in this repository answers.

## What this is not

- **Not the reference.** Every flag, exit code and message lives in [`../cli.md`](../cli.md). This path links
  there instead of copying it - and where a page has to repeat a fact, it says where the fact comes from.
- **Not a security guarantee.** The tool reads the files that decide what your machine installs, and it shows
  you what it read. It does not read the source of the packages themselves, and it never installs or resolves
  anything.
- **Not a tutorial you can skim.** Page 00 has no commands and page 01 has nothing but setup. They are short on
  purpose: the rest of the path assumes them.

**Adds:** the order. Three other pages already describe this tool: [`cli.md`](../cli.md) says what each command
does, [`guide.md`](../guide.md) gets a working repository to a passing scan in ten minutes, and [`rules/`](../rules/)
explains each rule. None of them says which to read first, and none is written for a reader who has never opened a
terminal.

Start here: [00 - The problem](00-the-problem.md).
