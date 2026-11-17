# Testing — when a test is required, and what makes one admissible

The suite is the repository's record of what the tool promises, and a test is the only place a promise is
executable. `odd/tasks/next-release-backlog.md` wrote the row this page answers: *"no page states when a test is
required or when one is inadmissible"*. This is that page. It binds nothing in `docs/spec/` — the spec says what
the tool does; this says how the repository proves it.

## When a test is required

A test is required when a change alters something a caller can observe:

- an exit code, or which of the four codes a state produces (`docs/spec/report.md` §10.4);
- any byte the tool prints — the human report, a message, a help line, a remediation command;
- any field of the JSON document, including its absence;
- the state of a tree after a command: files written, bytes preserved, files left alone;
- a golden, when the report was meant to change.

One test per rule the change introduces. The assertion is **the effect**, never the implementation: the exit code
*and* the exact stdout/stderr *and*, for a command that rejects input, that the rejected input left stored files
and counters untouched. A test that asserts the exit code alone passes on a tool that prints nothing.

## When a test is not required

- **A page, a comment, a decision row.** Nothing executable moved. The gates that still apply are the drift and
  documentation-contract tests, which check that the pages agree with the catalog.
- **A string the spec already fixes, when the spec is the subject.** Rewriting `docs/spec/` is not a behaviour
  change; the code that must follow is. When the code follows, the test belongs there.
- **A defect the suite could not have seen.** It gets a test at the moment it becomes a rule — and the field loop
  exists to invent it, not to skip it.

What does *not* exist here: a coverage target. A line nobody's promise depends on is a line without a test, and a
percentage would reward the wrong file.

## The five admission tests

A new test is admissible when all five hold.

1. **It pins an observable contract** — one of the five things listed above — through the public interface, not
   internal storage.
2. **It can fail for the right reason.** Delete the line it pins, or the assertion it makes, and it goes red. A
   test that stays green when its subject is removed is documentation with a `test(` in front of it.
3. **One rule carries all its observable effects.** The rule's message, its code, its exit contribution and the
   state it leaves behind are assertions of the same test, because a rule is one promise and half a promise is
   the defect.
4. **It is deterministic**: no clock, no network, no machine state, no absolute path. A fixture lives in the OS
   temp directory and every command runs with that directory as its `cwd`. When a probe genuinely needs the
   machine — pnpm, git — the test says so and resolves it through the project's resolver, never through a bare
   `spawnSync('pnpm')`.
5. **It is named for the contract, never the implementation.** The name says what a caller gets, so a failure
   reads as a broken promise rather than a broken function.

## The test that duplicates another

Two tests may not assert the same contract. When a change makes a second test cover what a first one already
pins, the second is deleted or narrowed — a duplicate doubles the maintenance and tells a reviewer nothing new. The
question to ask is *which promise does this one own that no other test owns?* and "none" is a valid answer.

## What was considered and rejected

Adopted from the skill the backlog cites (`M:/funky-ai/.agents/skills/vitest/SKILL.md:76`): behaviour-named tests,
one unit under test per file, shared helpers in one place, and an empty debt map.

- **Rejected: a blanket "never hardcode copy".** Here the stdout *is* the product, and `docs/spec/commands.md`
  fixes it line by line. The adapted rule is the opposite — assert the bytes the spec fixes, and none it does
  not.
- **Rejected: file-length caps** (500 or 800 lines). Length is not a promise, and a cap teaches splitting rather
  than naming.
- **Rejected: a meta-test policing test names.** A test that greps other tests' names fails on a rename and passes
  on a lie. The review reads the name; a machine reads the assertion.

## Not yet built, and named rather than dropped

The backlog's row also asks for *"a list of tests that cannot fail, found by mutation and forbidden to grow"*.
A mutation round has been run once (`odd/tasks/field-loop-every-rule.md`, eight of eight killed), but there is no
standing list and no gate forbidding it to grow. That is a campaign, not a page, and it stays in the ledger.

## Where this page meets the others

- **The field loop** (`docs/field-loop.md`) discovers what the suite could not see; this page says how a finding,
  once found, becomes a test. The loop's step 3 — *pin it, or pay for it twice* — is an instance of the second
  admission test.
- **`CONTRIBUTING.md`** carries the checklist a pull request runs; its test line is this page applied to a
  change.
- **`docs/spec/`** stays the normative contract. Where this page and the spec disagree about *what* the tool
  promises, the spec wins; this page only says how the promise is proven.
