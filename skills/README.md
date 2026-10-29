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

The binary is the distribution channel. The package carries its skill, and one flag installs it —
no path, no redirect, no install step of its own:

```sh
npx funky-secure skill --install
```

Inside a repository it writes `.agents/skills/funky-secure/SKILL.md` there, so the file travels with
the repository and should be committed; outside one — or with `--user` — it writes the same path under
your home directory, for every project. `npx funky-secure skill` still prints the file byte for byte if
you would rather redirect it yourself.

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

Upgrading is the same command: an identical file is left alone, and a file that differs is replaced only
after it asks, or when `--force` says so. `--keep` leaves an edited copy in place.

Whichever route, a session that is already running notices it only after a restart or a reload, and
most runtimes can be asked to load one skill by name. Nothing here assumes which.

## Changing it

Edit `skills/funky-secure/SKILL.md` here, never the installed copy: the installed one is a copy that
the next install overwrites. If the CLI grows a command the skill should mention, the drift gate fails
until both agree.
