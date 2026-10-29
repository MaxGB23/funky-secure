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

Pi discovers skills in `~/.agents/skills/` (every project) and `.agents/skills/` (this repository from
its root down). There is no install command: place the directory and restart Pi, or run `/reload` in a
live session. `/skill:funky-secure` invokes it explicitly when a model does not pick it up on its own.

From this repository, one line for the current user copes the source of truth into the global
location. Run it again after pulling changes; it overwrites.

```powershell
Copy-Item -Recurse -Force .\skills\funky-secure "$HOME\.agents\skills\funky-secure"
```

```sh
mkdir -p ~/.agents/skills && cp -r skills/funky-secure ~/.agents/skills/
```

To keep it per-project instead, copy the same directory to `.agents/skills/funky-secure` in that
repository and commit it, so the whole team gets it.

## Changing it

Edit `skills/funky-secure/SKILL.md` here, never the installed copy: the installed one is a copy that
the next install overwrites. If the CLI grows a command the skill should mention, the drift gate fails
until both agree.
