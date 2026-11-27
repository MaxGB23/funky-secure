---
name: funky-secure
version: 0.15.1
description: Bootstrap or audit a repository's supply-chain posture, from npm to a pnpm target. Use when starting a project, adding dependencies, reviewing a lockfile, hardening CI, or asked whether a repository is safe to install from.
---

# funky-secure

A CLI that reads a Node repository and says whether its supply-chain posture matches a policy, and
what stands between it and pnpm. It never installs and never rewrites a dependency tree; the only
writes are the ones it was asked for (below).

`start` is read-only guidance. The writers are `init --apply`, `pin --apply` and `skill --install`, and
each writes only when it is asked: the first two inside the repository, the third inside it or under
`~/.agents/skills/`, whichever scope it is asked for.

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
2. A commit — only when the files the plan writes carry uncommitted work, because the writer refuses
   those. Unrelated work elsewhere in the tree does not block it.
3. `funky-secure init --apply` — the pin, the release-age gate, the ignore block.
4. A commit naming the files that step wrote — because it just dirtied the tree, and the next writer
   refuses that. It names them, so an untracked tool cache beside them stays out.
5. `pnpm add <your first dependency>` — when no lockfile is present yet and no foreign one produced
   it, because the block governs what is added after it and `pin` reads versions from a lockfile. A
   repository that already carries `pnpm-lock.yaml`, or one whose lockfile `import` will produce,
   skips this.
6. A commit for that dependency — the plan prints its own note: when the manifest already declared the
   package, this commit has nothing to do and exits `1`.
7. `pnpm import` — when another manager's lockfile is still present. Import reads that lockfile and
   keeps the versions it pins; `pnpm install` never reads one, so it would resolve from the manifest.
8. `funky-secure pin --apply` — when the manifest still carries ranges; the workspace block governs
   the dependencies added next, and nothing else clears the ones already there. It names the ranges
   `package.json` declares, not the ones it will manage to write: a range the lockfile records no
   version for is listed as not pinned, with its reason.
9. `pnpm install --lockfile-only` — before `pin` when a `pnpm-lock.yaml` is already present and no
   foreign lockfile produced it, because `pin` reads the version it writes from the lockfile and one
   that records none gives it nothing to copy; and again after `pin`, when it wrote, because exact
   specifiers over a lockfile that recorded a range are a desync and this is what re-resolves it
   without touching `node_modules`.
10. `git switch -c chore/supply-chain-bootstrap` — when a foreign lockfile is present, because the next
   step refuses to remove one on the default branch. The command is printed, not just the requirement.
11. `funky-secure migrate --apply` — on that feature branch: it refuses to remove a lockfile on `main`.
12. A commit staging the lockfile — the last step reads a tracked one. When step 11 removed a foreign
    lockfile, the commit stages that removal too, or the tree ends the path still dirty.
13. `funky-secure scan --preset starter` — the reduced audit.

The list is what the plan can print, in the order it prints it; no single repository prints all of it,
and the printed plan is the contract. A repository that starts from pnpm prints nine steps, one
carrying a foreign lockfile prints ten.

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
`path` and `remediation.kind`; `line` is present only when the finding names one, and a `manual`
finding often names none:

| `remediation.kind` | What to do |
|---|---|
| `auto` | Apply it with `funky-secure init --apply`, then scan again. |
| `manual` | Do not improvise. Show the human `remediation.command` and the file — and the line when the finding carries one. |
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

A reduced preset prints a `not run` line naming the rules it did not run, and it closes with one
continuation saying those rules were turned off by a policy decision - not skipped, not missing from
the catalog - and that `--preset strict` turns none off by itself. The last clause is bounded on
purpose: the preset is one lever, and a repository whose own config sets a rule `off` keeps it off
under every preset. **Report the whole line verbatim,
continuation included.** A `PASS` under a reduced preset is not a full audit, and saying so is the
point of it.

## What you must not do

These are the ways a "fix" makes a repository worse. None of them is a valid response to a finding:

- **Do not edit `pnpm-lock.yaml` by hand.** It is generated; a hand-edited lockfile is a lie that CI
  will reproduce.
- **Do not run `pnpm install` to make a missing-lockfile finding disappear.** Install resolves, and
  resolving is a decision with a version in it.
- **Do not weaken the policy to reach a passing verdict** — no lowering `minimumReleaseAge`, no
  removing `minimumReleaseAgeStrict`, no deleting a rule from the config, no `--ignore` on a finding
  you were asked to fix, no `--fail-on` raised past what the policy asks for.
- **Do not remove a file from the index (`git rm --cached`) without saying that history keeps it.**
  A committed secret stays committed; rotation is the only remedy.
- **Do not treat a refusal (`exit 3`) as a wall to route around.** It names its own way out —
  `commit <paths> or pass --allow-dirty` — and `funky-secure explain <rule>` says why it refused.
  `--allow-dirty` is for a tree whose state you understand, never for one you were told to clean up.
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
- `docs/learn/` — the path this package ships for a reader who has never opened a terminal, starting at
  `docs/learn/README.md`. Send the human there when the question is what a command is for, rather than
  what it printed.
- `not run` lines, `skip` findings and provenance tell you what was **not** verified. Never round
  that up to "clean".
