# RFC 0031 — the path needs a repository

| | |
|---|---|
| **Status** | `implemented` — outside a repository the path creates it and asks again. |
| **Revision** | 1 |
| **Present contract** | none. [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.7 prints `git init` as step 1 and never says what the rest of the path means in a directory that step has not yet run in. |
| **Supersedes** | nothing. It amends 0015 in the one place 0015 did not reach: a directory that is not a repository yet. |

## What a reader meets today

`start`'s promise since 0015 is that the numbered path can be followed, and that each step is printed
from a fact. Its plan is derived from the same collection and the same write plan `init` uses, and the
spec says so in as many words: *"It measures no fact of its own, so it cannot contradict the report
about the same repository."*

Step 1 of that path is `git init`, printed when the directory is not a repository. So the command
knowingly plans in a directory where the collection it plans from is **not the collection `init` will
see**. Four independent sessions, each handed nothing but the printed output on a freshly generated
project — `create-next-app` with npm, `vite`, `create-t3-app`, and a directory holding only a
`package.json` — all stopped at step 2, none of them in the same way twice:

```
2  funky-secure init --apply  plan the 3 writes (nothing is written)
3  git add package.json pnpm-workspace.yaml && git commit -m "chore: apply funky-secure"
```

`init --apply` then planned **four** writes and refused: `refusing to write over uncommitted changes:
.gitignore, package.json`. Step 3 stages a file that step 2 would have created and did not:
`fatal: pathspec 'pnpm-workspace.yaml' did not match any files`.

The mechanism is one line of the derivation, and it is deliberate in the rule that carries it. R7
`sensitive-ignored` declares, in its own `detection` and `limits`:

> Outside git, skip.

so W2 — the managed `.gitignore` block — is planned only once a repository exists. Outside one, the
plan is short by that item, and the commit that would clear the untracked tree is not printed at all:
the dirty-tree question is asked of git, and there is no git to ask.

## The measurement that decides it

The same directory, before and after `git init`, with nothing else changed:

```sh
node bin/funky-secure.js init --format json   # 3 items — package.json ×2, pnpm-workspace.yaml
git init -q .
node bin/funky-secure.js init --format json   # 4 items — the same three plus .gitignore
```

And in a repository whose tree is untracked, the path is **correct** — everything the field loop
called a lie is right once step 1 has run:

```
1  git add -A && git commit -m "chore: baseline before funky-secure"
2  funky-secure init --apply  plan the 4 writes (nothing is written)
3  git add package.json pnpm-workspace.yaml .gitignore && git commit -m "chore: apply funky-secure"
```

So this is not a defect in the derivation, the plan, or the commit steps. It is a defect in **what the
path claims before its own first step has been taken**.

## Why the obvious repair is not available

The tempting fix is to plan as if the repository existed — a hypothetical context with zero commits and
everything untracked — so one screen still shows the whole path. That is not implementable under this
repository's hard rules: R7 answers through `git check-ignore`, and the only way to ask git is to have
a repository. Creating one to ask, even temporarily, is a machine write, and §11.5 point 7 leaves this
tool exactly one write outside the repository (`skill --install`). A plan guessed from a directory that
is about to change is the same class of lie in a new costume: the count is still asserted, the rule
still cannot answer, and a reader with an unusual tree would get a number that was never measured.

## The decision

**Outside a repository, the path prints only the steps that create the repository and the manifest, and
ends by asking again.**

```
  1  git init
  2  pnpm init                     (when there is no package.json)
  3  funky-secure start            the plan needs a repository: one rule and the
                                   dirty-tree question are answered only by git
```

The second run begins inside a repository, where every step of §11.7 is derived from facts that exist.
Inside a repository nothing moves: the steps, their order, their counts and the baseline commit are the
ones printed today.

This is 0015's own rule applied to the one command 0015 did not name: a step that requires a state
prints the command that produces it, and a step that cannot be justified is not printed.

## What it costs

- A reader in an empty directory reads the path twice, not once. The first screen is honest and short;
  the second is the whole path, and it is the path that runs.
- The refusal the field loop hit — `init --apply` refusing a tree whose state is not recorded — stops
  being something a fresh project can meet. It is a guard for a repository, and a fresh project is not
  one until step 1 has run.
- `start`'s step count in that state drops from seven to two or three, and the spec gains the sentence
  that says why, so the two can be checked against each other.

## What it does not change

The plan, the writers, the rule states, the commit steps and their messages, the scan advice. The only
repository shape whose output changes is one with no `.git`, and in that shape every number printed
after step 1 today is unmeasured.

## Evidence

Field loop over the `start` path, four fresh sessions, four scenarios, on Windows:

| Scenario | Generated by | Stopped at |
|---|---|---|
| `create-next-app` | npm | step 2, `refusing to write over uncommitted changes` |
| `vite` | npm | step 2, same refusal |
| `create-t3-app` | npm, `packageManager: npm@11.13.0` | step 2, same refusal |
| a directory with only `package.json` | hand | step 2, same refusal |

Recorded as issue [#110](https://github.com/MaxGB23/funky-secure/issues/110). The same loop filed three
defects this record does not decide: [#111](https://github.com/MaxGB23/funky-secure/issues/111) (pnpm
steps printed under an npm pin), [#112](https://github.com/MaxGB23/funky-secure/issues/112) (`pin
--apply` counted before a lockfile exists), [#113](https://github.com/MaxGB23/funky-secure/issues/113)
(pnpm resolving to an enclosing workspace).
