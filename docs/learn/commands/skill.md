# skill

`skill` prints the instructions this tool wants an agent to follow, and with `--install` it puts them in your
repository. It is the only command on this path that changes nothing about your supply chain and everything about
who is reading the tool: the audience is an agent, and the human running it is delivering a file.

## What it answers

*What does this version of the tool want an agent to know, and does the copy on my disk match this version?* With no
flag the answer is the file itself, byte for byte, so the reader is an agent and the command is a delivery. With
`--install` the answer is one of three facts about the copy already there: it carries this exact version, it carries
an older one, or it carries local changes - and the tool says which, because they are three different decisions.

## What it does

With no flag it writes the packaged file, `skills/funky-secure/SKILL.md`, to stdout with nothing added and two hint
lines on stderr, and touches nothing on disk. I compared its stdout with the file in `skills/funky-secure/SKILL.md`
in this repository and `cmp` printed nothing: it is the same bytes, which is what makes a redirect or a pipe safe.
With `--install` it writes those bytes to `.agents/skills/funky-secure/SKILL.md` at the root of the worktree it
stands in, so the file travels with the repository, and the hints it prints on the print path name the `~/.agents/`
copy as the one that applies to every project. No path is ever typed and none is accepted. Because the file
declares its own version, an install compares versions before bytes: an older copy is an upgrade, a newer one is a
downgrade the command refuses, exit `3`, and the same version with different bytes is a local edit it will not
discard without an answer. When it cannot ask - stdin is not a terminal - it refuses with the two flags that settle
it instead of guessing. `--force`, `--keep` and `--user` without `--install` are usage errors, exit `2`, and so is
`--force` with `--keep`. Every flag is in [`../../cli.md`](../../cli.md).

## When you use it

- When you hand work to an agent and want it to know this tool's contract from the version you actually run, without
  pasting documentation into a prompt.
- When you want the instructions committed with the project: `--install` prints `commit it, so the repository
  carries the instructions its agents read`, and that is the whole point of putting the file in the tree.
- After you upgrade `funky-secure`. The version line in the file is compared, so a stale copy is reported as an
  upgrade rather than silently refreshed, and an edited copy is a decision instead of an accident.
- When the machine, not the project, is the unit - `--user` installs once for every project on it.

## When it is superfluous

This is the page where the honest answer is partly about you, and the tool is the first to admit it.

- **If you do not hand your work to an agent that reads skills, the command is not addressed to you.** Nothing in
  your repository changes because of it: `skill` reads no `package.json`, no lockfile and no report, and no finding
  moves. I ran it in a scratch repository that held nothing but a commit, and the only change it made in the whole
  folder was `.agents/` - one file, for a reader that was not me. The tool works, and its report is identical, in a
  repository with no `.agents/` directory at all.
- **A second `--install` is not a second act.** It printed `–  Current  ·  .agents/skills/funky-secure/SKILL.md
  (0.13.0)` with `nothing to do: it already carries this exact version`, exit `0`. So the useful runs are the first
  one and the one after an upgrade; running it out of habit adds a line of output and nothing else.
- **It is not a check on your repository.** Exit `0` for printed, installed and already current; `3` only when it
  refused to act; `2` only for a flag that contradicts another. Nothing was measured in any of those, so it belongs
  in a setup step and never in a gate.
- **Printing it is the same as reading it.** `cmp` between its stdout and `skills/funky-secure/SKILL.md` printed
  nothing, so the print path exists for pipes, not for a different answer: if you can open the file in the package,
  you have already read what the command would print.

So: superfluous for a reader who has no agent, superfluous a second time after it is installed, and never evidence
about anything. It is a delivery, and a delivery is only as useful as the recipient.

## What you will see

Three runs in one scratch repository in the system temp directory, empty except for one commit. The first install,
whose report goes to stderr because stdout is reserved for the file itself:

```
✓  Installed  ·  .agents/skills/funky-secure/SKILL.md (0.13.0)
     commit it, so the repository carries the instructions its agents read
```

Exit `0`, and `git status --porcelain` in that folder printed `?? .agents/`: one new directory, and the file inside
it is the same file the print path emits. The second run, on the state the first one produced:

```
–  Current  ·  .agents/skills/funky-secure/SKILL.md (0.13.0)
     nothing to do: it already carries this exact version
```

Exit `0`. The symbol is the report's "not run" mark, and the sentence says the version matched - the bytes were not
compared, because the version already answered.

Then I appended a line to the installed file by hand, leaving its version at `0.13.0`, and ran the same command with
stdin not a terminal:

```
funky-secure: pass --force to replace it, or --keep to leave it as it is
reason: cannot ask whether to replace .agents/skills/funky-secure/SKILL.md: .agents/skills/funky-secure/SKILL.md carries local changes on version 0.13.0 and stdin is not a terminal
```

Exit `3`, and the file was not touched: a local edit is a decision, and a command nobody could answer cannot make
it. The same two lines arrive for an older copy; for a newer one the action instead names the flag a downgrade
needs, which was also exit `3` when I left a copy declaring `9.0.0` in place. What the print path adds on stderr is
the two destinations, in its own words:

```
funky-secure skill: install it with funky-secure skill --install
funky-secure skill: .agents/skills/funky-secure/SKILL.md in this project, ~/.agents/skills/funky-secure/SKILL.md for every project
```

## What you do next

Put it in the repository with `--install` and commit the file, so the instructions an agent reads are the ones your
project carries. Then re-run it after each upgrade of `funky-secure`: `–  Current` is what you want, and a refusal is
the command telling you a newer copy is already there. After that this path is done: the sixth question every
command page ends on is what to do next, and the fourth - when the command is superfluous - is collected for all
seven in [05 - When not to use it](../05-when-not-to-use-it.md).

**Adds:** who the command is for - a reader who hands work to an agent that reads skills - and what it does when
nobody needs it: a second `--install` printing `–  Current`, a newer copy refused with exit `3` instead of replaced,
and one file written in a folder where nothing else changed.

---

Back to [the path](../README.md): the destination is your own repository, and the fourth question on every page is
the one to keep.
