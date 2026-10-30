# RFC 0011 — `pin`

| | |
|---|---|
| **Status** | `implemented` — `funky-secure pin` plans the exact-version pins and performs them with `--apply`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.9, and [`docs/cli.md`](../../docs/cli.md) under `pin`. |
| **Supersedes** | nothing. It adds the route that 8.2 R5 described and left to the reader. |

## The problem

`exact-versions` reports that a specifier floats and prints the `pnpm pkg set` that fixes one of them.
That is the right answer to *"what is wrong"* and a poor answer to *"fix my repository"*: a project
created a year ago has every dependency on a caret, so the reader runs one command per finding, forty
times, copying a name and a version each time. Record 0007 made each of those commands work; it did not
make the work smaller.

The owner's framing is the design constraint: *"tener un comando que los limpie manualmente es
interesante, pero siempre con aprobación, por eso se ejecuta"*. Running the command **is** the approval.
What is missing is not a prompt, it is a verb.

There is also a property to protect. `savePrefix: ''` in the managed block governs every **future**
`pnpm add` — measured: `pnpm add is-number` writes `7.0.0`, not `^7.0.0` — but it never touches a
specifier that already exists, and `pnpm update` keeps the caret of a range it updates. So an old
repository has two separate debts: the future, which `init --apply` already pays, and the past, which
nothing paid.

## The decision

**A separate verb, not a flag on `init --apply`.**

```
funky-secure pin            # the plan: file, count, and every specifier with the version it takes
funky-secure pin --apply    # exactly that plan
```

`init` answers "put the repository at policy"; `pin` answers "clean the ranges it already has". Folding
the second into the first would make `init --apply` rewrite forty dependency lines on a repository whose
author asked for the quarantine gate, which is the kind of surprise this tool exists to prevent.

**Running the command is the approval, and the plan is the diff.** No prompt, no `[y/N]`: `pin` with no
flags writes nothing, and `pin --apply` is an explicit second instruction. That is the same shape as
`init` and `migrate`, so there is one convention to learn.

**The version comes from the lockfile or is not written.** The pins are `recordedVersion` of
`pnpm-lock.yaml` — the same function `exact-versions` reads — so a command that fixes specifiers cannot
pin to a number the report never mentioned (4.9).

**One write per file.** A plan item carries the whole rewritten manifest, so two items for one
`package.json` would leave only the last one's change. Indentation, key order and line endings survive;
only the specifiers change.

**Root `package.json` only, and the plan says so.** A workspace importer's pins are counted and named as
not pinned. Reading another manifest would need a probe that only this command uses, and a silently
incomplete pin is worse than a stated one.

**It ends by naming the install.** Writing an exact specifier desyncs the lockfile on purpose: its
`specifier` field still records the range. `pin` never runs an install (11.6), so the plan's next step
is `pnpm install --lockfile-only`, after which `scan --only exact-versions` is clean.

## What it costs

One more command in the help, one more write path with the same dirty-tree guard as `init`, and a
conceptual pair a reader must keep apart: `pin` fixes the specifiers, `pnpm install --lockfile-only`
re-records the lockfile. The plan prints both, in that order.

No allowlist is added, deliberately. A per-package exception is the author's decision in `package.json`,
visible in the diff and reported by the next scan; an allowlist for ranges is how the property decays
into a repository that looks audited and is not.

## Verification

- A manifest with three floating specifiers and a lockfile that records all three: the plan names each
  one with its range and its version, and `--apply` writes exactly those versions.
- A floating range with no recorded resolution is listed as not pinned and left untouched.
- A workspace importer is named as not pinned with its count.
- An uncommitted manifest refuses with exit `3` and writes nothing; `--allow-dirty` proceeds.
- A second `--apply` performs zero writes.
- `--format json` prints the plan document and no prose.
- After `--apply`, `scan --only exact-versions` reports the desync the next step fixes, not a floating
  range.

## Alternatives rejected

- **A flag on `init --apply`** (`--pin-existing`). Same reason as the separate verb: the blast radius of
  `init` should not depend on a flag a reader might not notice.
- **`pin` running `pnpm install --lockfile-only` itself.** The tool never runs an install, and that
  guarantee is worth more than the convenience (11.6).
- **Pinning from the registry's latest.** That is a resolve, and a resolve is what the lockfile exists
  to prevent.
- **An `exact-versions` allowlist for the ranges a team wants to keep.** A range that someone wants is
  a decision the diff already shows; a config file that hides it makes the report lie.
