# Machine scope contract

> Normative. Extracted verbatim from RFC 0001 section 12 (revision 7). The record is at
> [`../../rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the code owes. Change this file, not the record.

## 12. Machine scope contract

### 12.1 Closed probe list

| Probe | Purpose |
|---|---|
| `pnpm --version` | active version, if it answers |
| `pnpm config list --json` | effective configuration (age policy, store, registry, `ignoreScripts`) |
| `where pnpm` (win32) / `which pnpm` (POSIX) | installations visible in `PATH` |
| `git rev-parse --show-toplevel` | repository root |
| `git ls-files -z` | tracked files |
| `git check-ignore --no-index --stdin -z` | behavioral ignore evaluation, never with `-v` (E3) |
| `git ls-files --error-unmatch` | tracked-or-not for one path |
| `git status --porcelain -z -- <paths>` | dirty-tree refusal for `init --apply` and `migrate --apply` |
| `git rev-parse --abbrev-ref HEAD` | current branch for `migrate --apply` |
| `git symbolic-ref --short refs/remotes/origin/HEAD` | default branch for `migrate --apply` (may fail: no remote) |
| bounded file reads | `package.json`, `pnpm-workspace.yaml` (existence), `pnpm-lock.yaml` (specifier scan), `.gitignore`, workflows, `~/.npmrc` (registry/auth evidence and the R7 token check only — it cannot answer the quarantine question, E8), and the resolved `pnpm` shim on win32 (to discover the real executable, E7) |

Every probe is spawned with an argument array and **`shell: false`**. On win32 the mechanics are the
measured ones (E7): a `.cmd` shim spawned with `shell: false` fails with `EINVAL`; the real executable
sits behind the shim at `%LOCALAPPDATA%\pnpm\global\v11\<hash>\node_modules\@pnpm\exe\pnpm.exe` and is
**not** on `PATH`, so it is reached by reading the resolved shim, never by searching; and the
`%ComSpec% /d /s /c` form works only with `windowsVerbatimArguments: true`, plus a doubled-quoted
argument (`""<path>" <args>"`) when the path contains a space. `shell: true` is never the fallback:
a path with a space breaks it and Node emits `DEP0190`. This replaces the old `shell: true` path
(`runner.js`), which produced `DEP0190` on every run and put a concatenated command line between the
tool and the argument list. When no executable can be resolved, the machine fact returns `skip`, never
a guess.

Probes are cached per run. A probe is never retried with different arguments, and the tool never
falls back to a second command to answer the same question: if the declared probe fails, the fact is
unavailable and the rules that need it return `skip` or `error` accordingly.

### 12.2 Version ambiguity is a first-class report

Appendix C records an observed disagreement on the author's machine: `pnpm --version` answered
`11.5.0` from inside a repository that pins `packageManager`, while the effective configuration
reported `userAgent: pnpm/12.3.4`, and `pmOnFail: download` means the pin can download and switch a
version at run time. The machine section therefore reports **both** observations and marks
`machine.versionAmbiguous: true` when they disagree, instead of claiming one number. A single-probe
answer is a guess, and pretending otherwise would be exactly the kind of stale assertion this RFC
exists to remove. That observation no longer reproduces on the same machine (C.1), so the behaviour
is pinned by an injected collector in tests, never by live evidence.

### 12.3 Redaction

Never printed: any value of `_authToken`, `_auth`, `_password`, `//<registry>:_authToken`, or any
environment variable matching `*_TOKEN`, `*_SECRET`, `*_KEY`. Presence is reported as `present` and
the value is replaced by `<redacted>`. A report is safe to paste into an issue.

### 12.4 The machine is never written

No environment variable, no global config file, no `setx`, no `corepack enable`, no `pnpm store`
command. Recommendations name the exact command and the report verifies the *next* run, which is the
only verification loop a read-only tool can honestly offer.

### 12.5 Machine facts that are not rules

`where`/`which pnpm` feeds `machine.installations` — the count and the resolved binary paths — and
`pnpm --version` versus `userAgent` feeds `machine.versionAmbiguous` (12.2). Both are **facts of the
report**, not findings: v0.1 has no rule for duplicated installations (the old design had one, and it
is not among the nine of section 8.2). They are printed in the machine section, they never change the
verdict, and `--fail-on` cannot fail because of them. G2 is satisfied by the facts, not by a rule.

---
