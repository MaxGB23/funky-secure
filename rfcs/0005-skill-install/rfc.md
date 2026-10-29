# RFC 0005 — Installing the skill

| | |
|---|---|
| **Status** | `accepted` — asked for by the owner while reviewing `skill`, and implemented on branch `feat/start`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.5 point 7 and §11.8, and [`skills/README.md`](../../skills/README.md). |
| **Supersedes** | nothing. It amends 0004's distribution decision without replacing it. |
| **Superseded by** | nothing. |

> **How to read this file.** It records why this tool now performs one write outside the repository,
> which rule that write bends, and what bounds it.

## Context

0004 made the binary the distribution channel: `funky-secure skill` prints the file, and a redirect
saves it. The owner's objection was not the redirect's correctness but its cost — *I do not like
specifying paths*. A destination the human must remember, type exactly and get right is friction on
the one command whose whole purpose is to be easy.

The objection is also about the product's shape. Every other verb answers a question about the
repository. `skill` is the only verb whose subject is the agent that will run next, and asking a human
to spell out where an agent's instructions live is asking the human to do the tool's job.

## Decision

`funky-secure skill --install` writes the shipped file itself, and the destination is never typed and
never accepted as input:

- **Inside a worktree**, the root is the worktree root: `.agents/skills/funky-secure/SKILL.md` in the
  repository, to be committed, so the repository carries the instructions its agents read.
- **Outside one**, or with `--user`, the root is the home directory: the file applies to every project
  on the machine.

The four segments are a constant. There is no path argument, and passing one is a usage error, so the
write has no input to traverse with: the guard re-checks the composition instead of validating a
string.

### Replacing is a question

A differing installed file is replaced only after an answer. `--force` and `--keep` are that answer
given in advance, for a run with no terminal to ask — and with no terminal and no flag the command is
exit `2`, never a silent overwrite and never a silent skip. Local edits to an installed skill are the
one thing this write can destroy, so it does not destroy them on its own initiative.

An identical file is not rewritten at all. The write is atomic: a temporary file in the same directory,
renamed over the target, removed when the write fails. A symbolic link at the destination is refused
rather than followed.

## What this bends

The hard rule was *no machine writes; every write goes through `validateWriteTarget`*. It becomes: every
write inside the repository goes through the guard, and exactly one write leaves it, asked for by name,
bounded by a constant target, refused on a link, and reported in the message that performs it.

`validateWriteTarget` keeps its job. It answers containment inside a repository, and the home directory
is not one; stretching it to cover a home root would have meant a containment check that can never be
satisfied or a guard that silently allows what it was written to forbid.

## Alternatives rejected

- **Keep printing only.** Zero new surface and zero doctrine change — but it leaves the friction the
  owner named, and the friction is the whole feature.
- **A `postinstall` that installs the skill.** The exact behaviour this tool flags in other packages:
  a script writing into a home directory without being asked. It would also fire on every install,
  including the CI installs that must stay identical everywhere.
- **Ask in every case, including a fresh install.** A question with one possible answer is noise; the
  question exists for the one case that destroys something.
- **Accept a destination path.** One argument turns a constant into input, and input is what point 1
  of 11.5 exists to forbid.
- **A separate `funky-secure-install-skill` package.** A package to copy one file, with its own version
  to keep in step, to avoid one flag.
- **Write to every runtime's own directory.** Naming runtimes means tracking them, and the four fixed
  segments are the one convention they already share.

## Consequences

- The product's pitch changes: it is no longer "writes nothing outside the repository", it is "writes
  one file outside the repository, when you ask it to, and says where".
- `skill` becomes the only command whose behaviour depends on the terminal it runs in — not in its
  output, but in whether it can ask. The flag pair is what keeps a CI run deterministic: `--force` and
  `--keep` produce the same result on a laptop and on a runner.
- Two optional dependencies of the command, in the seam sense: the worktree root (only for `--install`)
  and the home directory. Both are injected in tests, so no test writes to the real one.
- One more write path to keep in the invariants, and a spec section that now has a numbered exception.

## Acceptance

- `skill --install` inside a worktree writes `.agents/skills/funky-secure/SKILL.md` there and says the
  file travels with the repository; outside one, or with `--user`, it writes under the home directory.
- Installing the shipped bytes twice reports the identical copy and writes nothing.
- A differing file is replaced by `--force` or an explicit overwrite answer, and kept by `--keep`, by
  any other answer, or by no flag with no terminal (exit `2`).
- A symbolic link destination is refused, and a failed write leaves no temporary file.
- `--user`, `--force` and `--keep` without `--install` are usage errors, as is `--force` with `--keep`.
