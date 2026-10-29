# Skills

Agent-facing instructions shipped with the package. A skill is not documentation: it tells an agent
*when* to run the tool and *what it must not do*, and delegates every fact about the CLI to the binary.

## `funky-secure`

`skills/funky-secure/SKILL.md` — bootstrap and audit a pnpm repository, with the prohibitions that keep
a "fix" from making a repository worse.

It deliberately contains no flag list, no rule catalogue and no message text. `--help` and `explain`
own those, so the skill cannot drift from the binary; a drift gate in `tests/drift.test.js` fails if it
names a command that does not exist.

## Installing it

The binary is the distribution channel. The package carries its skill and a command prints it, so a
redirect is the whole installation:

```sh
npx funky-secure skill > .agents/skills/funky-secure/SKILL.md
```

That works with any runtime that reads a directory of skills: no install step, no package manifest of
its own, no agent product named anywhere in the output. stdout is `SKILL.md` byte for byte, so the
redirected file is valid as written; stderr carries two lines naming the project-local
`.agents/skills/funky-secure/` destination and the user-level `~/.agents/skills/funky-secure/` one, and
nothing else. npm has no convention for installing a skill, which is why nothing here claims one and
nothing writes into a home directory on your behalf.

The file also ships in the tarball, which is the source to copy from if you prefer copying:
`node_modules/funky-secure/skills/funky-secure/SKILL.md`. For a bare checkout of this repository the
same file is `./skills/funky-secure/SKILL.md`. A copy is a copy: rerun it after upgrading.

For Pi specifically, the package declares `pi.skills`, so `pi install npm:funky-secure` also works and
keeps the installed skill in step through `pi update`; that manifest is inert metadata for npm and is
not the documented path.

Whichever route, a session that is already running notices it only after a restart or a reload, and
most runtimes can be asked to load one skill by name. Nothing here assumes which.

## Changing it

Edit `skills/funky-secure/SKILL.md` here, never the installed copy: the installed one is a copy that
the next install overwrites. If the CLI grows a command the skill should mention, the drift gate fails
until both agree.
