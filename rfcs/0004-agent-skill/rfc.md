# RFC 0004 — An agent skill

| | |
|---|---|
| **Status** | `accepted` — agreed by the owner before the work; ships on branch `feat/start`. |
| **Revision** | 1 |
| **Present contract** | [`skills/funky-secure/SKILL.md`](../../skills/funky-secure/SKILL.md) and [`skills/README.md`](../../skills/README.md). |
| **Supersedes** | nothing. |
| **Superseded by** | nothing. |

> **How to read this file.** It records why the package ships instructions for agents, what those
> instructions may contain, and the one rule that keeps them from drifting.

## Context

The CLI is already usable by an agent: stable JSON, three exit codes, and a remediation command on
every finding. What it cannot express is *judgement* — the order to do things in, which findings an
agent may apply alone, and which repairs are worse than the finding.

The observed failure mode is specific: to reach a passing verdict, an agent weakens the policy. It
lowers `minimumReleaseAge`, deletes a rule from the config, or runs `pnpm install` so a missing
lockfile stops being missing. The tool cannot prevent that; it has no opinion about who reads its
output.

## Decision

Ship `skills/funky-secure/SKILL.md` with the package, containing three things and nothing else:

1. **When to run which command** — the start path, the audit path, the scope a CI gate reads.
2. **The prohibitions** — the ways a "fix" makes a repository worse.
3. **The instruction to ask the binary** — `--help`, `explain --list`, `explain <id>` — so that no flag,
   rule id or message text is recalled from memory.

It is a skill, not documentation: the documentation set of 13.4 is unchanged, and the skill deliberately
duplicates none of it.

### The rule that keeps it honest

The skill names **commands** and no flags, no rule ids, no message text. A drift gate in
`tests/drift.test.js` reads every `funky-secure <word>` occurrence and fails when the word is not a
command the CLI dispatches. Adding a command the skill should mention therefore cannot be forgotten
silently, and adding a flag never invalidates the skill at all.

## Alternatives rejected

- **A skill that documents the flags.** It would be a third copy of the CLI surface, after `--help`
  and `docs/cli.md`, and the one with no gate that can tell it is stale.
- **A skill that lists the rules and their remediations.** The catalogue already answers both through
  `explain`, with the severity table and the limits; a copy in prose would rot in one revision.
- **A plugin or an MCP server.** A new executable integration point for what is a paragraph of
  judgement, and one more thing to install.
- **No skill at all.** Defensible, and it is where this started: the CLI is enough to *act*, but not to
  act well under pressure to reach a green verdict.

## Consequences

- The tarball grows by two files, and `files` in `package.json` gains `skills/`.
- The skill is installed by copying, because Pi discovers skill directories and has no install
  command; `skills/README.md` carries the one-line copy for each platform. An installed copy is a copy,
  and the next install overwrites it.
- The documentation set of 13.4 is untouched: a skill is not a page a user reads first.
- One more artifact the drift gate owns, and the first one that describes behaviour it does not own.

## Acceptance

- `skills/funky-secure/SKILL.md` loads, names only commands the CLI dispatches, and contains no flag,
  no rule id and no message text.
- The gate fails when a non-existent command is named, proven by mutating the file.
- `package.json` ships `skills/`, and the release guard still sees a coherent `files` list.
- The skill states the start order, the `remediation.kind` table, the exit codes, the scope split and
  the prohibitions; nothing in it restates the contract.

## Amendment — 2026-10-28

The first revision said the skill is installed by copying, on the belief that Pi had no package
command. It does: an npm package with a `skills/` directory and the `pi` manifest is a Pi package, and
`pi install npm:funky-secure` declares it in Pi's settings, loads it on the next start and keeps it in
step through `pi update`.

So `package.json` gains `"pi": { "skills": ["skills"] }` and the `pi-package` keyword, and the copy
instruction is demoted to what it actually is: the fallback for agent runtimes that have no package
mechanism, which read a directory. The shipped tarball is what makes that fallback possible — the
canonical path is `node_modules/funky-secure/skills/funky-secure/SKILL.md`.

The decision itself is unchanged: judgement in the skill, surface in the binary.
