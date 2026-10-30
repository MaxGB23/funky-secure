# Documentation

Where a change goes. This page is a map, not a contract: the contract is
[`spec/`](spec/README.md), and the reasoning is in [`../rfcs/`](../rfcs/README.md).

## I changed something. Where does it belong?

| I changed… | Update |
|---|---|
| a command, or a flag | [`cli.md`](cli.md), the command's own section, and the section of [`spec/commands.md`](spec/commands.md) that owns it |
| what a message says, or how the report is laid out | [`spec/report.md`](spec/report.md) §10.3, and the capture in [`cli.md`](cli.md) that shows it |
| a rule's detection, severity or remediation | [`rules/<id>.md`](rules/), then `explain <id>` in a diff to prove the rendered text moved with it |
| a behaviour the spec already states differently | [`spec/`](spec/README.md) **first**. A behaviour the record never decided starts the next numbered [`rfc`](../rfcs/README.md) |
| a decision I made while implementing | a row in [`decisions.md`](decisions.md). If it changes behaviour, the record too |
| the layout, a file's role, or a data path | [`architecture.md`](architecture.md) |
| the first ten minutes of a new project | [`guide.md`](guide.md) |
| what an agent must know before touching a repository | [`../skills/funky-secure/SKILL.md`](../skills/funky-secure/SKILL.md), including its `version` |
| how a defect the tests could not see gets found before a release | [`field-loop.md`](field-loop.md) |

Nothing on that list fits? Then the page you want probably should not exist, and the rule belongs in
[`spec/`](spec/README.md).

## Three habits, in the same commit

1. **The docs move with the code.** A command that exists and a section that does not is the bug the
   suite already catches; a section that exists and says the old thing is the one it cannot.
2. **A capture is pasted from a real run.** Never typed from memory and never edited to look right:
   the diff then shows the output change, which is the point of having it.
3. **A decision is written the day it is made.** A row in [`decisions.md`](decisions.md) costs a
   sentence; reconstructing it three weeks later costs the reason it was made.

## What already fails the build

These are gated, so you do not have to remember them — `node --test` is the reminder:

- a command with no section in [`cli.md`](cli.md), no flow in [`architecture.md`](architecture.md), or
  no row in the README
- a flag the parser accepts that [`cli.md`](cli.md) does not document
- a skill that names a command the CLI does not dispatch, or a skill version that disagrees with
  `package.json`
- a spec section mapped to a record that is missing or still `draft`, or a mapped file that drifted
  from the record it was copied from
- a golden report that no longer matches the collector

## What no gate can check

Three things, which is why they are habits above rather than tests below:

- a capture that was true last release
- a sentence that paraphrases a rule instead of quoting the section it belongs to — a paraphrase can
  cite the right section and still be wrong
- a decision nobody wrote down
