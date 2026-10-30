# RFC 0018 — the path prints every command it requires

| | |
|---|---|
| **Status** | `implemented` — `start` prints the re-sync after `pin`, the branch `migrate` needs, and stages the removal it caused. `0.8.3`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.7 (13-row step table); §10.4 (the refusal's action). |
| **Supersedes** | nothing. It completes 0015 ("the path is followable") and 0016 ("the commit closes the writes it covers") on the two steps they left. |

## What a field agent found

A third round ran the whole path in a generated npm project and finished green — the first time neither
entry needed a source repair. It also reported, in its own words, where it had to invent:

> crear la rama para el paso 5. El texto del paso dice "on a feature branch", pero no imprime el
> `git switch -c`. Sin él, el paso 5 se niega con exit 3.

> `pnpm install --lockfile-only` … lo imprime `pin` en sus next steps, pero `start` no lo lista. Lo corrí
> en ambos proyectos; sin él el lockfile queda desincronizado del manifest.

> el paso 6 … sale 0, pero no stagea la baja de `package-lock.json`. El flujo termina en verde con el
> árbol aún sucio: ` D package-lock.json`.

Three findings, one shape: **a step that requires a state did not print how to reach it**, and the last
one left the working tree dirty after a path that claims to have closed the loop.

## The three gaps

1. **The branch was a requirement, not a command.** `start` printed
   `funky-secure migrate --apply  on a feature branch: …` and nothing else. `migrate --apply` refuses on
   the default branch with exit 3, so the step could not be executed as printed. The refusal itself had
   the same hole: `switch to a feature branch and re-run migrate --apply` names a state without naming a
   branch or a command.
2. **`pin`'s re-sync lived only in `pin`'s own output.** Step 7 writes exact specifiers over a lockfile
   that recorded a range — a desync by construction (0011) — and the resolve that fixes it was printed by
   `pin`, not by the path. A reader who follows only `start` runs the final scan over a desynced lockfile.
3. **The closing commit did not stage the removal it caused.** Step 10 (`migrate --apply`) deletes
   `package-lock.json`. The closing step staged `pnpm-lock.yaml` and `package.json` and committed, so the
   deletion stayed in the index: `scan` passed, the tree was dirty, and the next commit would have swept
   an unrelated `D` into it. This is the exact class 0016 closed for the writing commit — a commit must
   stage everything its own step changed — one step later.

## The decision

**A step that requires a state prints the command that produces it, and a commit stages everything the
steps it closes changed.**

- The path prints `git switch -c chore/supply-chain-bootstrap` immediately before `migrate --apply`, and
  `migrate`'s refusal names the same command. The branch name is fixed, so two readers following the same
  path do not invent two branches; it is the name a human already chose without being told.
- The path prints `pnpm install --lockfile-only` after `pin --apply` whenever `pin` had something to
  write. It uses `--lockfile-only` and not `pnpm install`, because the resolve is the point and
  `node_modules` is not.
- The closing commit stages `foreign` — the lockfiles step 10 removes — beside the one it tracks.

The order is unchanged. Only the text of three steps changed, plus one field in the commit.

## What it costs

The npm path grows from seven printed steps to nine, and the pnpm path from four to five. That is a real
cost in a path whose whole value is being short. It is paid because each added step is a command the
reader would otherwise have to guess, and a guess is what the agent did.

## Verification

- The npm-generated path prints, in order: `init --apply`, commit, `pnpm install`, `pin --apply`,
  `pnpm install --lockfile-only`, `git switch -c chore/supply-chain-bootstrap`, `migrate --apply`, a
  commit staging `pnpm-lock.yaml package.json package-lock.json`, `scan --preset starter`.
- Executing the closing `git add` after removing `package-lock.json` stages the deletion (`D` in the
  index, not the worktree).
- `migrate --apply` on the default branch refuses with exit 3 and its action names the `git switch -c`
  command.
- The pnpm-generated path grows by exactly the re-sync step and still ends at the scan.
- Full suite and self-scan green.

## Alternatives rejected

- **Print the branch name and let the reader write the command.** The step already did that for the
  command it was describing; a requirement is not a step.
- **Fold the re-sync into the `pin` step** (`funky-secure pin --apply && pnpm install --lockfile-only`).
  It would hide a second command inside a step whose label is one command, which is what made the path
  unfollowable in the first place.
- **`git add -A` in the closing commit.** It would stage the removal and everything else with it,
  including any untracked scratch file — the reason 0016 stopped using it for the writing commit.
