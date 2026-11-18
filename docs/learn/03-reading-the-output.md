# 03 - Reading the output

`funky-secure scan` is the audit: it reads your repository and prints one report, with one answer for each of
its thirteen questions, or fewer when the policy switches some off. `start` told you what to type; `scan` tells
you what it found.

## One real run

Run it in the folder you have been working in:

```
npx funky-secure scan --scope repo
```

`--scope repo` says which half of the world to look at: the repository, and not this computer.

Here is what it printed in this project's own repository:

```
funky-secure scan  ·  preset strict  ·  scope repo
provenance  preset strict (funky-secure.config.json)  ·  quarantine not verified (machine
            excluded)  ·  machine excluded
summary  0 errors · 0 warnings · 0 info · 11 passing · 2 skipped
verdict  PASS (threshold: error · 2 rules not verified: package-manager-pin, quarantine)
──────────────────────────────────────────────────────────────────────────────────────────

REPO-ROOT
  –  2 rules not verified: Package manager, Quarantine
     → funky-secure scan --verbose, each names what was not verified and how to verify it

IMPORTER
     all 1 rule pass

CI
     all 6 rules pass

next     nothing to do: everything at or above the policy passes
```

I made that capture with the copy of the program this repository builds, `node bin/funky-secure.js scan --scope
repo`, so it describes the tool's own folder and not yours. The first line says `preset strict` because this
repository carries its own `funky-secure.config.json`; a repository with no such file runs `baseline` instead.
In the empty folder from page 02 the same command reports two errors, `Lockfile` and `Sensitive files`, seven
rules not verified, and exits `1`.

Your numbers will differ from both. What this page is about is the shape, and the shape does not move.

## Thirteen answers, taken one at a time

Imagine thirteen people, each with a different question and the same folder. Nobody may look at anyone else's
sheet. Each one reads the folder, decides, and writes an answer. At the end somebody collects thirteen sheets
and prints them.

That is the scan. Each rule is handed the resolved context - the facts the tool read, from your repository and,
for two of the questions, from this machine - and it returns its own answer. Nothing a rule decides is passed
to the next one. So `11 passing · 2 skipped` is not eleven rules agreeing with two: it is thirteen answers,
each taken alone, over the same folder. A rule can be wrong; it cannot be led.

Nothing is remembered between runs either. Run the same scan twice over the same folder, without changing a
file in between, and the two reports are byte for byte identical.

One scoping note, because it is easy to over-read this: independence is a property of the scan. The write plan
behind `funky-secure init` is not independent of these answers - it is derived partly from what two of them
said. The report you have just read is the part where nothing depended on anything else.

## Why the answers come in that order

Two things decide where an answer is printed, and neither of them is how bad the answer is.

**Where it was measured.** The report is grouped: the machine when it is in scope, printed first, then the
repository root, then each package.json, then your CI workflows. The capture shows three of those groups, in
that order: `REPO-ROOT`, `IMPORTER`, `CI`.

**Inside a group, the catalog.** Each rule has a fixed place in an ordered list, and the answers follow it. The
list is `src/rules/index.js`, and its first lines state what that order is for: it is the report order, it is
part of the public contract, and it is explicitly neither alphabetical nor import order. You can see the
non-alphabetical part in the list itself - `lockfile-committed` comes before `foreign-lockfile`.

Severity never enters that comparison. Each answer begins with a symbol showing how severe it is, and the
position of the answer is decided by the two things above, without looking at the symbol. A warning can print
above an error when its rule comes first in the catalog, and that is not a bug: the report is an inventory in a
fixed order, not a list sorted by alarm. Which finding to act on first is a different question, and the `next`
block is where the tool answers it.

That is the shape, and it is worth stating what it is not: the order is not a ranking, not a to-do list, and
not the tool's opinion of your project. It is the order the questions are asked in, and a position in it names
a question, not a degree of danger.

## What the report deliberately does not say

Two of the thirteen questions need a fact that is not in your repository. One compares the pnpm version your
manifest declares with the pnpm that actually answers on this machine. The other is the release-age gate, which
pnpm's own configuration can set on the machine itself. `--scope repo` says the machine is out of scope, so
neither rule guesses: both answer *not verified*, which is the one line under `REPO-ROOT` and the
`2 rules not verified: package-manager-pin, quarantine` inside `verdict`. `--scope all` runs them.

A tool that filled those answers in from the repository alone would be inventing them, and an invented answer
in a report is worse than a missing one.

## Where the rest of the report is explained

This page is about the shape and stops there. For what each line means - the provenance line, the counters, the
verdict, the symbols, the `next` block - [`../guide.md`](../guide.md) walks the report field by field, and
[`../cli.md`](../cli.md) is the contract behind it.

**Adds:** why the report has that shape: thirteen questions answered one at a time, grouped by where they were
measured and printed inside a group in catalog order, so a finding's position is a place in a list and never a
rank of how bad it is.

---

Next: [04 - Why the rules exist](04-why-the-rules-exist.md).
