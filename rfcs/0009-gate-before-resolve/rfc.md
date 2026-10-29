# RFC 0009 — The gate precedes the first resolve

| | |
|---|---|
| **Status** | `implemented` — `start` puts the block before the install, and `migrate` before neither. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.7, and the step table beside it. |
| **Supersedes** | [`0003`](../0003-first-ten-minutes/rfc.md) §11.7, in the order of two steps. |

## The problem

`start` printed `funky-secure migrate` before `funky-secure init --apply` for any repository another
package manager had generated. The rationale was in the code: *the posture is written once the
repository has one package manager*.

The migration's own plan contradicts it. `migrate --apply` prints a human step 3:

```
3. human step (this tool never runs it)
   pnpm install   # resolves and downloads; writes pnpm-lock.yaml
```

and refuses to remove the foreign lockfile while `pnpm-lock.yaml` is absent, because a lockfile that is
the only one is never deleted. So the sequence was: install and resolve everything, then delete the npm
lockfile, then write the block that governs resolution. The first tree of every migration was resolved
with no `savePrefix`, no `minimumReleaseAgeStrict` and no quarantine floor — in the one situation the
tool exists for, and never in greenfield.

This is not an ordering preference. It is the only place in the product where the tool's own advice made
its central guarantee impossible to keep, and it was reported by an agent that had to reason around it:
*"en la migración, el primer resolve ocurre ANTES de que exista el bloque que lo gobierna"*.

## The decision

**The block first, then one resolve under it, then the removal.**

| Old order | New order |
|---|---|
| 1 `funky-secure migrate` | 1 `funky-secure init --apply` |
| 2 `funky-secure init --apply` | 2 `pnpm install` |
| 3 `funky-secure scan --preset starter` | 3 `funky-secure migrate --apply` |
| | 4 `funky-secure scan --preset starter` |

Both constraints are satisfiable in exactly one order, and it is this one:

- the block has to exist before the install that reads it, so `init --apply` comes first;
- `migrate --apply` needs a `pnpm-lock.yaml` to keep, so it comes after the install that writes one.

`start` therefore prints `pnpm install` itself for the migrating repository, instead of leaving the
reader to discover it inside `migrate`'s own plan after the fact.

**No new flag and no new writer.** `init --apply` already writes the block and is already the only
writer inside the repository; `migrate --apply` already refuses when it would delete the only lockfile.
The steps were right and the order was wrong. Teaching `migrate` to write the gate would have been a
second writer for one fact, which is the defect the tool reports elsewhere.

## What it costs

A migration now runs two commands that write — `init --apply` and `migrate --apply` — where it ran one
before the scan. Both print their plan first and both refuse on a dirty tree, so a reader sees the same
evidence twice; that is the price of doing the safe thing in an order that is safe.

`start` grows one line and one `why this order` sentence, and the sentence changed its claim: a migration
does not lead because two lockfiles resolve two trees, it follows the install because the install is what
writes the lockfile it keeps.

## Verification

In a scratch repository with `package-lock.json`, a manifest and a commit, on a feature branch:

1. `start` prints `init --apply`, `pnpm install`, `migrate --apply`, `scan --preset starter`, numbered
   continuously from 1.
2. `init --apply` writes `pnpm-workspace.yaml` with `minimumReleaseAgeStrict: true`, `savePrefix: ''`,
   and the `.gitignore` block, and says `pnpm install` is the next step.
3. `migrate --apply` then refuses only for the lockfile it does not yet have — the case step 2 creates —
   and succeeds once it exists.

The regression test pins the sequence and both inequalities (`init --apply` before `pnpm install` before
`migrate`), because the order is the whole behaviour and a list of steps would pass in any order.

## Alternatives rejected

- **Let `migrate --apply` write the block.** Two writers for one fact, and a command whose name says
  "leave the other manager" would start deciding policy.
- **Print `init --apply` first but keep the old rationale in `why this order`.** The rationale was the
  defect; leaving it would re-teach the wrong order.
- **Leave `start` alone and document the order in the guide.** The command is what people run; the
  guide is what they read after it went wrong.
