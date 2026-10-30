---
name: funky-secure
version: 0.9.1
description: Bootstrap or audit a pnpm repository's supply-chain posture. Use when starting a project, adding dependencies, reviewing a lockfile, hardening CI, or asked whether a repository is safe to install from.
---

# funky-secure

A CLI that reads a pnpm repository and says whether its supply-chain posture matches a policy. It
never installs, never edits your machine, and never rewrites a dependency tree.

`start` is read-only guidance. Inside the repository `init --apply` and `pin --apply` are the writers,
and each writes only when it is asked. Outside it,
`skill --install` places this file where an agent runtime reads it, and only when asked. Everything
else reports.

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

1. `git init`, then `pnpm init` — when either is missing.
2. A commit — only when the tree already carries uncommitted work, because the writer refuses it.
3. `funky-secure init --apply` — the pin, the release-age gate, the ignore block.
4. A commit naming the files that step wrote — because it just dirtied the tree, and the next writer
   refuses that. It names them, so an untracked tool cache beside them stays out.
5. `pnpm import` — when another manager's lockfile is still present. Import reads that lockfile and
   keeps the versions it pins; `pnpm install` never reads one, so it would resolve from the manifest.
6. `funky-secure pin --apply` — when the manifest still carries ranges; the workspace block governs
   the dependencies added next, and nothing else clears the ones already there.
7. `pnpm install --lockfile-only` — after `pin`, when it wrote: exact specifiers over a lockfile that
   recorded a range are a desync, and this is what re-resolves it without touching `node_modules`.
8. `git switch -c chore/supply-chain-bootstrap` — when a foreign lockfile is present, because the next
   step refuses to remove one on the default branch. The command is printed, not just the requirement.
9. `funky-secure migrate --apply` — on that feature branch: it refuses to remove a lockfile on `main`.
10. A commit staging the lockfile — the last step reads a tracked one. When step 9 removed a foreign
    lockfile, the commit stages that removal too, or the tree ends the path still dirty.
11. `funky-secure scan --preset starter` — the reduced audit.

**Never install before the block exists.** `savePrefix: ''` and `minimumReleaseAge` only act on an
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
could not answer, `3` the tool understood the situation and refused to act, writing nothing. Neither
`2` nor `3` is a pass, and `3` names the action that lifts it: do that, then re-run.

Ranges that already exist are a second debt, and it has its own verb: `funky-secure pin` prints the
plan, `funky-secure pin --apply` performs it, and the plan ends with the install that re-records the
lockfile. The gate in `pnpm-workspace.yaml` governs the dependencies you add next; it does not touch
the ones already there.

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
- **Do not run a writer because it looked like the next step.** `init --apply` and `pin --apply` are
  run because the human asked for that change, not because a plan printed it. A plan is an offer.

## Closing a task

Finish with `funky-secure scan --scope repo` and show the verdict before and after. If it still fails,
say which finding is left and why it was not fixed — an honest red is worth more than a green nobody
believes.

## Where the rest lives

- `funky-secure --help` and `funky-secure explain` — the only complete reference.
- The repository's `docs/spec/` — the contract the binary owes.
- `not run` lines, `skip` findings and provenance tell you what was **not** verified. Never round
  that up to "clean".
