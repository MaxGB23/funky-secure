# RFC 0041 — the report says where it runs

| | |
|---|---|
| **Status** | `accepted` — the owner decided on issue #540 that the JSON report keeps its contract and only the human rendering states the directory a printed command runs in. It lands with the spec it names, which is the shape the registry already carries for `0038` and `0040`, so it is `accepted` and not `draft`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/report.md`](../../docs/spec/report.md) §10.1, what a finding carries and what a body may name, and §10.3, where the human text is stated to be presentation. |
| **Supersedes** | nothing. |
| **Superseded by** | nothing. |
| **Amends** | [`0001`](../0001-funky-secure-v1/rfc.md) §10.1 and §10.3: a command in a report body is stated to be written for the repository root, and the human rendering states the directory a printed command runs in. |

## What is true today

The spec annotates `path` as repository-relative and non-absolute (`docs/spec/report.md:19` at
`542a331`), defines `remediation.command` without an annotation (`:23`), and then forbids absolute
paths in a body (`:28`) without saying what a relative one is relative to. The gap is the middle
fact: every command a rule builds is written for the repository root, and the spec never says so.

The rules build those commands from facts they read at the root, and the shape of each one assumes it:

| command | built from | where it acts when pasted below the root |
|---|---|---|
| `git rm --cached <path>` (`src/rules/env-not-tracked.js:105`) | a `path` that is repository-relative | a pathspec the reader's directory does not contain |
| `git add pnpm-lock.yaml` (`src/rules/lockfile-committed.js:82-83`) | the lockfile's own name at the root | not the lockfile the finding is about |
| `pnpm install` (`:64`) | the root's missing lockfile | the nearest project at or above the reader |
| `pnpm -C <importer> …` (`src/rules/exact-versions.js:222-225`) | the importer's path inside the root | a project named relative to a directory it was not measured in |

Measured on a workspace fixture, five commands by three directories: `scan`'s human output is
**byte-identical** from the repository root, from a member `packages/a` and from
`packages/a/src/deep`, and six of its path tokens resolve to nothing from a member. The sweep is
parent-run and its full record is unmerged; the numbers are restated here so nothing in this record
rests on that branch.

The renderer has no repository to state: `renderHuman` (`src/lib/render-human.js:667`) is called with
the report alone (`src/commands/scan.js:47`), and the report carries no directory — the root is the
run's own (`ctx.root`, `src/lib/scan.js:118`).

## Why that is a gap

A report is a list of things to do, and the line a reader pastes is the whole of the doing. The
measured fact leaves that line correct only where the reader happens to stand, while the body's own
contract forbids fixing it by writing an absolute path into the report: a report that changed with
the directory `scan` ran in would not be the same report about the same repository (10.1). Two
requirements meet, and neither yields: the body stays repository-relative, and the line works where
the reader stands.

What separates them is the axis this repository already uses to settle such a case — *"The JSON report
is the machine contract; the human text is presentation and may change"* (`AGENTS.md`). A presentation
rule that states a fact about a line — where it runs — needs no knowledge of what the line contains,
and the machine contract keeps every byte. That is the decision #540 records: the JSON stays
repository-relative, and the human rendering states the directory.

## The rule

**A command the human rendering prints is prefixed with the directory it runs in, and nothing else
about it is inspected.** The prefix is `(cd "<the repository root, absolute>" && <command>)`.

Three cases, and no fourth:

- **below the root, the prefix is present at both print sites.** A sub-threshold finding prints its
  remediation twice — the action line, composed as `ACTION + command` (`src/lib/render-human.js:40`,
  `:165-168`), and the `next` block, whose head is `gutter('next')` (`:617`) and whose lines are
  `head + line` (`:639-641`) — so one command has one spelling in one report, and a reader never has
  to notice that the same step was written two ways;
- **at the repository root nothing is added.** Every byte the report prints there is today's byte, and
  the tests that pin those strings render at the root, so they stay as they are. The `next` block's
  96-column bound holds when the prefix is present, because the prefix is part of the string the
  renderer wraps and the same arithmetic lays it out;
- **fail-closed.** The prefix is applied only when the command's first token is a tool this tool
  prints commands for: `pnpm`, `git`, `corepack`. Any other first token prints today's bytes, so a
  command the list does not know is never worse than the status quo — only unprefixed, and never
  rewritten into a string that means something else. This direction is chosen on purpose: the change
  may add a directory a reader can follow, and may not change what a command does.

The list is not a classification of rules or findings. No shape is declared per rule, no per-finding
target is computed, and no path inside a command is rewritten; only the command's first token is
read. Two alternatives were rejected and are named so the trade is visible: a vocabulary of shapes
declared per rule — two judged rounds showed one rule emits several and that a rule-level field cannot
select among them — and inserting `-C` after each tool name, which needs a second parse and leaves
`corepack`, which has no such flag.

**The directory is absolute because of a measurement, not a preference.** The grouping is a new
assumption, while the `&&` is not: §11.7 already joins a `git add` and a `git commit` on one line with
it. But the two shells do not agree on the parentheses. In `cmd`, `(cd ..) & cd` ends at the
parent — its parentheses group commands and are not a subshell — while the POSIX form leaves the
reader where they were. A **relative** prefix therefore breaks the second line on `cmd`: from the root
it resolves one level above the root and `&&` keeps the command from running. An absolute spelling is
idempotent — the second line sets the same directory again, on both shells — it survives a path with
spaces because it is quoted, and it needs no arithmetic over the reader's directory at all, because
the root is already known to the run.

**Two commands are left unprefixed, and that leaves them correct.** `funky-secure init --apply` and
`funky-secure migrate --from <manager> --apply` resolve the repository root themselves from wherever
they run, so they do not need a directory and the list does not give them one: `funky-secure` is not a
token it knows.

## What this does not do

It changes no byte of the JSON document of 10.2. `path` stays repository-relative and non-absolute,
`remediation.command` keeps the spelling the rules build, and no field is added: the rendering states
the directory instead, which is the reason the document may stay as it is.

It does not touch `explain`, and not by a special case. `explain` reads no repository fact by contract
(`src/commands/explain.js:4-5`) and renders through its own `renderRule`/`renderList` (`:76-108`),
never through `renderHuman`, so the rule cannot reach its lines at all: the module boundary protects
it, not the token check. What it prints is a label followed by catalogue prose, and no reader pastes
that.

It does not restate §11.7. That section governs the rows of a write plan, with their own rebase and
their own `-C`; the commands of a report are not rows, and this record says nothing about the plan.

It does not claim a behaviour the code does not have yet. The record and the spec it names state the
rule; the renderer that applies it lands in a later change, and until then a report prints every
command exactly as it always has, at every directory.
