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

The package carries its skill, so installing the package is installing the skill. An npm package with
a `skills/` directory and the `pi` manifest of `package.json` is a Pi package:

```sh
pi install npm:funky-secure
```

That writes the declaration to Pi's settings, loads the skill on the next start, and `pi update`
keeps it in step with the installed version. No copying. `pi remove npm:funky-secure` undoes it. Add
`--local` to declare it in a project's `.pi/settings.json` instead, which is the version a team
commits.

Other agent runtimes have no package mechanism, so they read a directory. The skill is in the tarball,
which makes the installed path the place to copy from:

```powershell
# Windows, after npm install funky-secure
Copy-Item -Recurse -Force .
ode_modulesunky-secureskillsunky-secure "$HOME.agentsskillsunky-secure"
```

```sh
# POSIX
mkdir -p ~/.agents/skills
cp -r node_modules/funky-secure/skills/funky-secure ~/.agents/skills/
```

For a bare checkout of this repository, the same copy works against `./skills/funky-secure`. A copy is
a copy: rerun it after upgrading.

Whichever route, a running session needs `/reload` to notice it, and `/skill:funky-secure` invokes it
by name when a model does not reach for it on its own.

## Changing it

Edit `skills/funky-secure/SKILL.md` here, never the installed copy: the installed one is a copy that
the next install overwrites. If the CLI grows a command the skill should mention, the drift gate fails
until both agree.
