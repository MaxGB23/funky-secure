---
name: funky-secure
description: Bootstrap or audit a pnpm repository's supply-chain posture. Use when starting a project, adding dependencies, reviewing a lockfile, hardening CI, or asked whether a repository is safe to install from.
---

# funky-secure

A CLI that reads a pnpm repository and says whether its supply-chain posture matches a policy. It
never installs, never edits your machine, and never rewrites a dependency tree.

`start` is read-only guidance. `init --apply` is the only command that writes, and only inside the
repository. Everything else reports.

## Discover the surface, never recall it

The flags, the rule ids, the wording of every message and the remediation of every finding belong to
the binary. Ask it; do not reconstruct it:

```sh
funky-secure --help                 # commands and flags
funky-secure explain --list         # every rule with its severities
funky-secure explain <rule-id>      # one rule: what it wants, what it cannot see
```

If you find yourself writing a flag or a rule id from memory, run one of those first.

## Starting a project

```sh
funky-secure start
```

It prints the applicable steps in order, and the order is the contract:

1. `git init` — when the directory is not a repository.
2. `pnpm init` — when there is no manifest.
3. `funky-secure migrate` — when another manager's lockfile is still present.
4. `funky-secure init --apply` — the pin, the release-age gate, the ignore block.
5. `pnpm add <first dependency>` — when there is no lockfile yet.
6. `funky-secure scan --preset starter` — the reduced audit.

**Never install before step 4 has run.** `savePrefix: ''` and `minimumReleaseAge` only act on an
install that happens after the managed block exists. Installing first is how a project acquires
caret ranges and an ungoverned resolution on day one.

Follow the steps it prints; do not add steps it did not print, and do not skip one because it looks
redundant.

## Auditing

```sh
funky-secure scan --format json
```

Read `summary.verdict` first, then `findings`. Each finding carries `rule`, `severity`, `status`,
`path`, `line` and `remediation.kind`:

| `remediation.kind` | What to do |
|---|---|
| `auto` | Apply it with `funky-secure init --apply`, then scan again. |
| `manual` | Do not improvise. Show the human `remediation.command`, the file and the line. |
| `none` | Report only; there is no fix. |

Exit codes are part of the contract: `0` clean at the threshold, `1` a policy violation, `2` the tool
could not answer. `2` is never a pass.

`--scope repo` is what a CI gate reads; `--scope all` adds the machine (the pnpm that answers here and
its configuration). Use `--scope repo` in CI, `--scope all` when diagnosing locally.

A reduced preset prints a `not run` line naming the rules it did not run. **Report that line
verbatim.** A `PASS` under a reduced preset is not a full audit, and saying so is the point of it.

## What you must not do

These are the ways a "fix" makes a repository worse. None of them is a valid response to a finding:

- **Do not edit `pnpm-lock.yaml` by hand.** It is generated; a hand-edited lockfile is a lie that CI
  will reproduce.
- **Do not run `pnpm install` to make a missing-lockfile finding disappear.** Install resolves, and
  resolving is a decision with a version in it.
- **Do not weaken the policy to reach a passing verdict** — no lowering `minimumReleaseAge`, no
  removing `minimumReleaseAgeStrict`, no deleting a rule from the config, no `--ignore` on a finding
  you were asked to fix.
- **Do not remove a file from the index (`git rm --cached`) without saying that history keeps it.**
  A committed secret stays committed; rotation is the only remedy.
- **Do not resolve a `conflict`.** A conflict means the tool refused to overwrite a file that says
  something else. Stop and ask the human.

## Closing a task

Finish with `funky-secure scan --scope repo` and show the verdict before and after. If it still fails,
say which finding is left and why it was not fixed — an honest red is worth more than a green nobody
believes.

## Where the rest lives

- `funky-secure --help` and `funky-secure explain` — the only complete reference.
- The repository's `docs/spec/` — the contract the binary owes.
- `not run` lines, `skip` findings and provenance tell you what was **not** verified. Never round
  that up to "clean".
