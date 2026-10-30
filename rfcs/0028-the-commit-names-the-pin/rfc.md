# RFC 0028 — the commit names the pin

| | |
|---|---|
| **Status** | `accepted` — agreed 2026-10-30; the pin gets a commit of its own before any code moves. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.7, row 12: `git add pnpm-lock.yaml [package.json] [<the removed lockfile>] && git commit -m "<message>"`. |
| **Supersedes** | nothing. It amends 0016 and 0018 in one place: which commit carries the pin. |

## What a reader meets today

A repository arriving from npm runs `start` and gets a numbered path. Step 7 is `pin --apply`; step 12 is
the commit that closes the path. Between them sit `pnpm install --lockfile-only`, `git switch -c
chore/supply-chain-bootstrap` and `migrate --apply`, all of them over a working tree that carries the
pin's rewrite of `package.json`, and nothing the path prints says so.

The owner's agent, reading the path and then the commits it produced, put it in one sentence:

> No hay un commit dedicado a "pin" en este flujo de 9 pasos; el pin --apply del paso 4 queda en el
> working tree y se commitea recién en el paso 8. Si alguien se detiene entre los pasos 4 y 8, tiene el
> árbol sucio sin saber por qué.

Two facts explain how the path got here, and neither is an accident:

- **Row 12 already lists `[package.json]`.** 0016 decided that the closing commit stages what the path's
  own steps changed, and 0018 decided that a commit which closes a migration must also carry the removal
  or it leaves the index dirty while reporting green. The pin is a third thing that happens to be in the
  same commit.
- **The path is not broken by it.** `migrate --apply` refuses on uncommitted changes to the *foreign*
  lockfiles only (`src/commands/migrate.js`), so the dirty window does not block a step. What is missing
  is not a guard: it is an explanation and a name.

The message is where the defect is sharpest. `chore: track the lockfile` is printed for a commit that
also carries the rewrite of `package.json`. 0016 established that a commit names what it covers and
stages those paths rather than `git add -A`; a message that names one of its two subjects is the same
failure in the other direction — a reader who loses the pin to a revert has no message to grep for.

## The decision

**`pin --apply` gets a commit of its own, immediately after the resolve it requires, and the closing
commit stops staging `package.json`.**

```
7   funky-secure pin --apply            pin the N ranges this repository already has
8   pnpm install --lockfile-only        (the resolve that re-syncs the lockfile pin desyncs)
9   git add package.json && git commit -m "chore: pin the ranges"
...
13  git add pnpm-lock.yaml [<the removed lockfile>] && git commit -m "<message>"
```

Four properties, each one the reason for a detail:

- **It is its own step and not a line of prose.** 0015 and 0018 established the rule this follows: a step
  that requires a state prints the command that produces it. After byte 8 the state is "the manifest is
  dirty and the next writer refuses it", which is exactly the state the second commit of `init --apply`
  already answers — so the path prints the same shape twice more, with two different messages.
- **It stages `package.json` and nothing else.** `git add -A` is refused for the reason 0016 gives: a
  generated repository's untracked tool cache must not be committed under this tool's message. The
  command is not conditional on `pins > 0` because the step only prints when `pins > 0`.
- **The message names the pin**, in the same dull register as the two commits beside it, because the
  message belongs to the repository and not to this tool.
- **The closing commit keeps naming what it covers.** It loses `[package.json]` entirely: after this
  change nothing else on the path writes the manifest, so a `package.json` in that `git add` would be a
  path that is staged but never changed — and a commit that stages nothing is not a step (0016).

## What this record does not change

- **`migrate`'s dirt check.** It refuses on the foreign lockfiles, which is what it needs to keep; a dirty
  `package.json` is not its business and must not become its business, or the migration becomes
  unstartable in the state the path itself produces.
- **The two commits of `init --apply`** (rows 3 and 5). Their double appearance is 0015's subject: one
  before the write because the writer refuses a dirty tree, one after because the writer produces one.
- **`pin` itself**, its plan, its `--apply` contract, and the numbers it reports (0011, 0026).
- **The order of the steps.** Nothing moves; one commit is inserted where its own state is produced.

## Cost, and what pays for it

One more step on the printed path, so the numbering shifts by one for every repository where `pin` still
has work to do, and the goldens change once. What pays for it is the two questions the current path
answers badly: *which commit holds the pin* (now `git log --grep`), and *why is my tree dirty* (now the
step immediately before it says so, in its own line).

## Evidence

The observation is quoted verbatim above; the two code facts it rests on are
[`src/commands/start.js`](../../src/commands/start.js) (`trackFiles`, the `pins > 0` branch that adds
`package.json` to the closing commit) and [`src/commands/migrate.js`](../../src/commands/migrate.js)
(`applyRemoval`, which asks `statusPorcelain` about the foreign lockfiles only).
