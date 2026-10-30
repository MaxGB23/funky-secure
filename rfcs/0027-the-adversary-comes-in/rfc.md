# RFC 0027 — the adversary comes in

| | |
|---|---|
| **Status** | `implemented` — seven defects a tester found by trying to break the tool, each closed with the reproduction that found it. `0.9.2`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R1 and R5, as amended here. |
| **Supersedes** | nothing. It hardens reads that four releases of testing had only exercised from the inside. |

## What the adversary found

Every field round until now asked an agent to *use* the tool on a real repository. This one asked an
agent to **break** it: nineteen directories built by hand, eighty commands, twelve prescribed shapes and
seven of its own.

Two containers came back clean, and they are the two the product promises: no case hung, the slowest
run taking 267 ms against a 20 s timeout, and no `scan` created, modified or deleted a file in any case.
No output carried a stack trace. That is the read-only guarantee (0019) surviving input designed to
break it, not input chosen to respect it.

Seven defects were real.

**`init --apply` destroyed a value it could not read.** `packageManager` was read as "absent" whenever
it was not a string, so `{"name":"pnpm","version":"10.0.0"}` became `"pnpm@12.3.4"`, exit 0, with the
plan reporting zero conflicts. A writer that treats "I do not understand this" as "there is nothing
here" is the same mistake as a reader that treats an unread lockfile as an empty one, and this product
had already written a record about the second (0025).

**A `packages:` entry of `..` read outside the repository.** The workspace expander accepted the literal
`..`, so the scan reported `../package.json` — a file outside the root it promises to stay inside — as a
finding target. Nothing below it had a containment check because nothing had ever asked for a path that
escaped.

**An unreadable `package.json` was a passing repository.** Truncated JSON, or a byte-order mark, yielded
verdict `PASS` and exit 0; the parse error was collected in `targets.js` and read by no rule. The tool
answered "nothing at or above the policy" about a file it had failed to open.

**`"packageManager": "pnpm"` was classified as another manager.** The message read *"package.json
declares pnpm, so this repository is not on pnpm"*: a sentence that contradicts itself, produced by a
reader that only recognised `pnpm@<version>`.

**Three skips named nothing.** `unsupported-lockfile-shape` carried no path, so `expected "key:
value" at line 3` was attached to no file; an unreadable manifest produced one global skip for all
importers; and after the escape was refused, the refused entry vanished from the output with no word at
all — the quieter version of the defect the previous round had fixed.

**A truncated lockfile was accepted as supported.** The hand-reader stops at the importer subset it
needs, so a document that ended inside a block parsed as the part it managed to read. Sampled at every
ninth line: 35 of 71 fixture cut points and 777 of 806 on a real 806-line lockfile were accepted as
supported before the change, and none after.

**A label grew past its column.** `not verified` is twelve characters in a nine-character gutter, and
the count was appended with no separator, so every human run that skipped a rule printed
`not verified1 rule did not answer`.

## The decision

- **A value that cannot be interpreted is never treated as absent.** The writer refuses with a
  `conflict` naming the field and the value it found, and the file stays byte-identical. The exit code
  stays `0`, because `init --apply` writes the other items of the plan and exit `3` promises that
  nothing was written (10.4, 0008); converting a conflicted plan into a total refusal is a contract
  change, and it is recorded as one rather than folded into this record.
- **A path outside the root is refused, and the refusal is reported.** The expander asks the repository's
  existing write guard (`validateWriteTarget`) rather than growing a second containment rule — a read
  and a write disagreeing about what "inside" means is how a tool writes where it promised not to.
- **An unreadable manifest is a failure the verdict names**, in its own words: a byte-order mark is not
  "invalid JSON", and saying which one it is is the difference between a message a user can act on and
  one they cannot.
- **A lockfile shape is refused when the document is not whole.** Structure-only, so a
  `bundledDependencies:` sequence and an ignored section carrying lists still parse (0012). The limit is
  stated: a cut at a line boundary that leaves every block it opened closed is not detectable without
  inferring which sections a lockfile should have, and the record says so instead of implying otherwise.
- **Every refusal carries the file it came from.** A skip without a path is a sentence with no subject.

## What this round did not change

A repository migrating from npm or yarn with `workspaces` in its manifest still needs a
`pnpm-workspace.yaml` carrying `packages:`, and `migrate` still does not say so — recorded in 0026 and
deliberately left there. Negations in `packages:` (`!**/test/**`) are not applied at all today, so
surfacing them would produce a message that is false; the limitation stays documented and unreported
until its own record decides whether to honour or to declare them.

## Why an adversary, and why once

The suite passed 504 tests while the tool destroyed a `packageManager` object. That is not a gap in any
one test: it is the shape of testing you write when you are the same person who wrote the code. An agent
whose brief is "break this" costs one session and found seven defects, two of them severity 1. It is
worth running once per release that changes a read or a write path — and not worth running on every pull
request, for the same reason the field loop is not.
