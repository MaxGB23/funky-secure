# Scope model and targets

> Normative. Extracted verbatim from RFC 0001 section 7 (revision 7). The record is at
> [`../../rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the code owes. Change this file, not the record.

## 7. Scope model and targets

### 7.1 Targets

A scan does not "walk a repository"; it resolves **targets**, and each rule declares which target
kinds it applies to.

| Target kind | Resolution | Rules that use it |
|---|---|---|
| `machine` | `pnpm --version`, `pnpm config list --json`, `where`/`which pnpm`, `~/.npmrc` | `quarantine` |
| `repo-root` | `git rev-parse --show-toplevel`, else `cwd` | `package-manager-pin`, `lockfile-committed`, `foreign-lockfile`, `quarantine`, `env-not-tracked`, `sensitive-ignored` |
| `importer` | `pnpm-workspace.yaml` `packages:` globs → each `package.json`; plus the root `package.json` | `exact-versions` |
| `ci` | `.github/workflows/*.yml`, `.github/workflows/*.yaml`, `.github/dependabot.yml`, `.github/renovate.json` | `actions-pinned-sha`, `no-bot-auto-merge` |
| `editor` | `.vscode/tasks.json`, `.claude/settings.json` (existence only in v0.1) | none in v0.1 |

Rules that apply to a target kind that does not exist return `skip` with `reason: "no target"`, and a
skipped rule is **not** a pass. The summary counts them separately, because "I did not look" and "I
looked and it was fine" must never print the same.

Importer resolution in v0.1 is intentionally narrow: `pnpm-workspace.yaml` `packages:` entries that
contain `*` are expanded with a single-level glob, and nested globs are reported as
`skip: unsupported-glob` rather than silently ignored. Nine rules do not justify a glob engine; the
report tells the truth instead.

### 7.2 Scope selection

```
funky-secure scan                  # auto: repo if inside git, plus machine (default)
funky-secure scan --scope repo     # repository only (works outside git too)
funky-secure scan --scope machine  # machine only
funky-secure scan --scope all      # repo + machine, explicit
```

`auto` is the default and equals `all`, minus machine rules when a probe is unavailable (reported as
`skip`, never as pass). `--scope repo` inside CI is the supported gate configuration, because a
runner's machine configuration is not the developer's and is outside the contract.

### 7.3 What a scan never does

- Never writes any file, anywhere.
- Never runs a lifecycle script, an install, or a build.
- Never resolves a version (no registry access, no `pnpm view`, no `--dry-run` install).
- Never sends anything over the network.
- Never prints a secret value; tokens are reported as present/absent only (section 12.3).

---
