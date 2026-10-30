# Command line

One binary, `funky-secure`, with six commands: `start`, `scan`, `init`, `migrate`, `explain` and
`skill`.
Every command is defined by the contract in [`spec/report.md`](spec/report.md) and
[`spec/commands.md`](spec/commands.md) — the record behind them is
`rfcs/0001-funky-secure-v1/rfc.md`, sections 10 and 11, amended by records 0002 and 0003. This page is
the operating manual, not a second specification.

The flow of each command is drawn in [`architecture.md`](architecture.md#command-flows).

```text
funky-secure <command> [options]
funky-secure --help
```

`--help` and an invocation with no command print the static help and exit `0`. The help text is
generated from the same command and flag tables the parser uses, so it cannot describe a previous
release (RFC 13.1, 13.3).

## Commands

### `start`

```text
funky-secure start [--help]
```

Read-only, always: no file written, nothing installed, nothing touched on the machine. This is the
entry point for a repository that has nothing yet. It prints the steps that still apply, numbered from
`1`, in the order that makes them work, and it exits `0` whatever state the repository is in — it is
guidance, not a gate. `--help` is the only flag it accepts; a `--preset` on `start` is a usage error
(exit `2`), because the preset it recommends is named in the answer.

The steps are `git init`, `pnpm init`, `funky-secure init --apply` with the number of writes it is
holding, `pnpm install` and `funky-secure migrate --apply` when another manager's lockfile is still
there, `pnpm add <your first dependency>` when it is not, and `funky-secure scan --preset starter`
last. Each one prints only while its condition holds: a repository that already has a
manifest, a lockfile and a commit, but no managed block, is told to run `init --apply` and then
`scan`, numbered from `1`. An empty directory, from a real run:

```text
funky-secure start  ·  guidance, nothing is written

  1  git init
  2  pnpm init
  3  funky-secure init --apply  plan the 1 write (nothing is written)
  4  pnpm add <your first dependency>
  5  funky-secure scan --preset starter

why this order
  the workspace block has to exist before the install that reads it, and a lockfile can
  only exist after the first add

not run  6 of 12 rules; off by policy: Environment files, Pinned actions, Bot
         auto-merge, CI install flags, pull_request_target, Workflow permissions
```

A project a framework generator left behind is the case the order turns on. It has a manifest and a
lockfile, and the lockfile belongs to another manager, so `migrate` comes first — the posture is
written once the repository has one package manager — and the first add is never asked for, because
adding now would write a second lockfile beside the npm one. A `pnpm-lock.yaml` that appears during
the migration is the migration's business, not this step's. A repository of the shape
`npm create next-app` leaves behind, from a real run:

```text
funky-secure start  ·  guidance, nothing is written

  1  funky-secure init --apply  plan the 3 writes (nothing is written)
  2  pnpm install
  3  funky-secure migrate --apply
  4  funky-secure scan --preset starter

why this order
  the workspace block has to exist before the install that reads it, and a lockfile can
  only exist after the first add
  migrate comes after the install, because the install is what writes the lockfile it keeps

not run  6 of 12 rules; off by policy: Environment files, Pinned actions, Bot
         auto-merge, CI install flags, pull_request_target, Workflow permissions
```

`why this order` is the reason the sequence is not a list: the managed block has to exist before the
install that reads it, a lockfile can only exist after the first add, and a migration puts the block
first because the install it needs has to read one. The `not run` block is the same line the report prints (RFC
10.3), describing `starter` — the preset the last step runs — so the reader knows what the recommended
preset does not check before running it. A repository past the start is told so in one line in place
of the list, `the repository is past the start; the next step is funky-secure scan --preset starter`,
never handed a stale checklist; `why this order` and the `not run` block follow either way, because
they describe the command and the preset rather than the repository.

`start` derives everything from the same collection and the same write plan `scan` and `init` use, so
it cannot contradict the report about the same repository (RFC 11.7). Exit `0` in every state,
including a repository at policy; `2` only for a usage error.

### `scan`

```text
funky-secure scan [--scope auto|repo|machine|all] [--preset baseline|strict|starter]
                  [--format human|json] [--fail-on error|warn|info|none]
                  [--only <ids>] [--ignore <ids>] [--strict-probes] [--with-timestamp]
                  [--verbose]
```

Read-only audit. It resolves targets, runs the active rules and renders one report. Defaults are
`--scope auto`, `--format human`, `--fail-on error`, and the preset from `funky-secure.config.json`
or `baseline`.

- `--only` and `--ignore` take comma-separated rule ids and accumulate across repeats;
  `--ignore` wins over `--only` (RFC 9.2).
- `--strict-probes` turns an unavailable required probe from `skip` into `error`; CI uses it to
  refuse a green build that measured nothing.
- `--with-timestamp` adds `generatedAt` to the JSON document. It is the only non-deterministic field
  and is excluded from golden tests by construction.
- `--verbose` restores what the default human report leaves out: every rule id, the ids of the
  passing rules, the reason and the verifying command of each skipped rule, and the machine block's
  full binary path. The JSON document is byte-identical with and without it (RFC 11.1).

#### Human output

A human report is presentation, not contract: the JSON document below is the contract, and this text
may change in a minor release as long as it remains valid on its own (RFC 10.3). It is written to be
read without the rule catalog, and it answers three questions in the order a reader asks them — what
is wrong, in which file, and what command fixes it.

The header is the title line, the `provenance` line, `summary`, `verdict`, then a separator of 90
`─`. Both labels keep their names and their nine-character gutter, so a script that greps `summary`
or `verdict` still lands on them; only their position moved, from the bottom of the report to the top.
Then one block per target, and the `next` block last:

```text
funky-secure scan  ·  preset baseline  ·  scope repo
provenance  preset baseline (default)  ·  quarantine not verified (machine excluded)  ·  machine excluded
summary  2 errors · 0 warnings · 0 info · 4 passing · 6 skipped
verdict  FAIL (threshold: error)
──────────────────────────────────────────────────────────────────────────────────────────

REPO-ROOT
  ✖  Lockfile  ·  pnpm-lock.yaml
     pnpm-lock.yaml is missing from the repository root; installs are not reproducible
     without it
     → pnpm install

  ✖  Sensitive files  ·  .gitignore
     .env, .env.local, .env.production, secrets.pem, server.key, .npmrc are not ignored by
     git
     → funky-secure init --apply

  –  2 rules not verified: Package manager, Quarantine
     → funky-secure scan --verbose, each names what was not verified and how to verify it

CI
  –  3 rules not verified: CI install flags, pull_request_target, Workflow permissions
     → funky-secure scan --verbose, each names what was not verified and how to verify it

next     funky-secure init  plan the 1 fix it can make (nothing is written)
         funky-secure explain lockfile-committed   what this rule wants, and why
```

- **One finding is three lines.** The heading carries the severity symbol, the rule's short label from
  the catalog (`Lockfile`, `Sensitive files`) and the location, `path` or `path:line`. The message
  hangs five columns in and wraps with a hanging indent. The last line is the action,
  `→ <command>`, at the same five columns. No finding shares its line with another finding or with a
  rule id.
- **The rule id is not printed.** It names a rule for the tool, not a finding for a person: it stays
  in the JSON document, in `--help`, in `explain`, and in `scan --verbose`.
- **The label comes from the catalog**, beside the rule's `title`, so there is no second list to keep
  in sync. `title` stays where a rule is explained (`--help`, `explain`) because it is a statement
  about the repository, and a heading needs the subject of the finding instead.
- **The target kind is the heading of its block**: `REPO-ROOT`, `IMPORTER <path>`, `CI`, `MACHINE`.
- **A reduced preset states its own coverage.** When the effective policy turns at least one rule
  `off`, one `not run` line sits between `verdict` and the separator, in the gutter, naming how many
  rules still run and which ones do not, in catalog order. `--only` and `--ignore` never produce it,
  because narrowing one run is not a policy change, and the JSON document gains nothing (RFC 10.3).
  The same line for the `starter` preset:

```text
not run  6 of 12 rules; off by policy: Environment files, Pinned actions, Bot
         auto-merge, CI install flags, pull_request_target, Workflow permissions
```

- **A clean target is two lines.** The heading, then `all 5 rules pass` at the same five columns a
  finding hangs from, never one line per rule: the passes are counted in `summary`. A repository at
  policy, from a different run:

```text
funky-secure scan  ·  preset strict  ·  scope repo
provenance  preset strict (funky-secure.config.json)  ·  quarantine not verified (machine
            excluded)  ·  machine excluded
summary  0 errors · 0 warnings · 0 info · 8 passing · 4 skipped
verdict  PASS (threshold: error)
──────────────────────────────────────────────────────────────────────────────────────────

REPO-ROOT
  –  4 rules not verified: Package manager, Quarantine, Environment files, Sensitive files
     → funky-secure scan --verbose, each names what was not verified and how to verify it

CI
     all 5 rules pass

next     nothing to do: everything at or above the policy passes
```

- **Skips collapse by target.** Two or more skipped rules print one `–` line naming the labels that
  were not verified and the command that expands them; the JSON is untouched. Exactly one skipped
  rule keeps its own block — symbol `–`, the reason, and the command that verifies it — because a
  single reason costs three lines and no flag.
- **No rendered line exceeds 96 columns.** Messages and actions wrap, never truncate. The one value
  shortened is a machine path — the executable in the `MACHINE` block, and the store when it does not
  fit — cut in the middle with `…` as in `C:\Users\…\pnpm.exe`, because its length is not ours to
  bound and a fixed cut point stays deterministic. `--verbose` prints it whole, and the JSON keeps
  it whole.
- **`--verbose` is the escape hatch.** It restores the rule id under each finding (`     ·  <id>`),
  the reason and the verifying command of every skipped rule instead of the collapsed line, the ids
  of the passing rules in one `passing` line, and the machine block's paths unshortened. It changes
  no count, no ordering and no JSON byte (RFC 11.1). The same run as the capture above with it on:

```text
funky-secure scan  ·  preset baseline  ·  scope repo
provenance  preset baseline (default)  ·  quarantine not verified (machine excluded)  ·  machine excluded
summary  2 errors · 0 warnings · 0 info · 4 passing · 6 skipped
verdict  FAIL (threshold: error)
──────────────────────────────────────────────────────────────────────────────────────────

REPO-ROOT
  ✖  Lockfile  ·  pnpm-lock.yaml
     pnpm-lock.yaml is missing from the repository root; installs are not reproducible
     without it
     → pnpm install
     ·  lockfile-committed

  ✖  Sensitive files  ·  .gitignore
     .env, .env.local, .env.production, secrets.pem, server.key, .npmrc are not ignored by
     git
     → funky-secure init --apply
     ·  sensitive-ignored


  –  Package manager  ·  package.json
     skipped: the machine is out of scope, so the declared packageManager pin was not
     compared with the pnpm that answers; run funky-secure scan --scope all to verify it
     ·  package-manager-pin

  –  Quarantine
     skipped: the quarantine was not verified because the machine configuration is out of
     scope; run funky-secure scan --scope all to verify the release-age gate
     ·  quarantine

CI

  –  CI install flags
     skipped: there is no workflow and no root .npmrc, so no CI install fact exists
     ·  ci-no-safety-overrides

  –  pull_request_target
     skipped: there is no .github/workflows directory, so no workflow can declare a trigger
     ·  pull-request-target

  –  Workflow permissions
     skipped: there is no .github/workflows directory, so no workflow can declare
     permissions
     ·  workflow-permissions

passing  4 rules (foreign-lockfile, env-not-tracked, actions-pinned-sha, no-bot-auto-merge)

next     funky-secure init  plan the 1 fix it can make (nothing is written)
         funky-secure explain lockfile-committed   what this rule wants, and why
```

**The `next` block** names exactly one command, and it has one of three shapes, decided by the report
alone:

- at least one failing finding carries an `auto` remediation: `funky-secure init`, the number of
  fixes it can plan, and the fact that nothing is written yet, followed by one
  `funky-secure explain <rule>` line. `<rule>` is the highest-severity failing finding, ties broken by
  catalog order, so the same state names the same rule on every run.
- the verdict is `pass`: `nothing to do: everything at or above the policy passes`.
- the verdict is `fail` and no finding is automatic: `manual: each finding names the file, its line,
  and the action`.

The block is human output only: the JSON document of RFC 10.2 gains no field for it, because a
reader that wants the plan runs `init` for it. The rule it names is an id, never a label, because it
is an argument to `explain` and ids are the names a command accepts (RFC 11.4). Since the block
carries no path, timestamp or machine value, two runs over the same state print the same bytes.

### `init`

```text
funky-secure init [--preset baseline|strict|starter] [--format human|json] [--apply] [--allow-dirty]
```

Default is a plan: it runs the same scan, derives the writes that would fix the fixable findings,
prints them and exits `0`. A plan is an offer, not a verdict, so `init` uses the `--fail-on none`
semantics internally and does not accept that flag. An empty plan prints `nothing to apply` and writes
nothing.

With `--apply` it performs exactly these writes, in this order (RFC 11.2). Every write is printed to
the ledger with its absolute path, its operation and the SHA-256 of the exact bytes before it
happens.

| Write | Target | Content |
|---|---|---|
| W1a | `pnpm-workspace.yaml` | `minimumReleaseAgeStrict: true` in the managed block: the gate flip (D-16) |
| W1b | `pnpm-workspace.yaml` | `minimumReleaseAge: 4320` in the same block; `--preset strict` only |
| W2 | `.gitignore` | the managed block with the six candidate paths of `sensitive-ignored` |
| W3 | `package.json` | `packageManager: pnpm@<version pnpm --version reported>`; only when the pin is missing |
| W4 | `funky-secure.config.json` | `{ "preset": "strict" }` so CI agrees with the run; `--preset strict` only |

It refuses — exit `3`, naming the file or the reason, and writing nothing:

- a target with uncommitted changes, unless `--allow-dirty` is passed;
- a working tree `git status --porcelain -z` cannot report, because the check above cannot be made;
- a plan item whose content changed between planning and writing, or that carries no content.

It never overwrites a value it did not write. A value that exists and differs is a `conflict`: it is
printed in the plan, left untouched, and is not a write. That covers a conflicting `packageManager`,
a `minimumReleaseAge` or `minimumReleaseAgeStrict` declared outside the managed block, an
unparseable or differently-configured `funky-secure.config.json`, and a config file discovered
somewhere other than the repository root. A `conflict` alone does not make the command fail; it makes
the plan a refusal you can read. A second `--apply` over the same state performs zero writes.

### `pin`

```text
funky-secure pin [--format human|json] [--apply] [--allow-dirty]
```

The complement of `exact-versions`: it takes the specifiers that float and writes the version
`pnpm-lock.yaml` already records for each, so the same install resolves to the same tree without
anyone retyping `pnpm pkg set` once per finding. Running the command is the approval; the `--apply`
split is the family convention, so nothing is written on the first invocation.

Default is a plan: it names `package.json`, the number of specifiers and the line list, and exits `0`.

```text
$ funky-secure pin

would write
  /repo/package.json
    set exact versions   (pins 3 specifiers to the version pnpm-lock.yaml records)

summary  1 write · 0 already at policy · 0 conflicts

pins
  dependencies.left-pad  ^1.3.0 → 1.3.0
  dependencies.is-odd  ^3.0.1 → 3.0.1
  devDependencies.typescript  ~5.9.2 → 5.9.2

next steps
  pnpm install --lockfile-only
```

Three properties are the whole contract:

- **The version comes from the lockfile or is not written.** A floating range with no recorded
  resolution is listed under `not pinned` with its reason; the tool never guesses a version (RFC 4.9).
- **One write per file**, because a plan item carries the whole rewritten manifest. Indentation, key
  order and line endings survive; nothing but the specifiers changes.
- **Root `package.json` only.** Workspace importers are named under `not pinned` with their count,
  because their manifests are outside the files the scan collects — the plan says so instead of leaving
  a silently incomplete pin.

It refuses — exit `3`, writing nothing — on uncommitted changes to the target, unless `--allow-dirty` is
passed, exactly as `init --apply` does. A second `--apply` over the same state performs zero writes.

Writing an exact specifier desyncs the lockfile on purpose: its `specifier` field still records the
range. `pin` never runs an install (RFC 11.6), so the plan ends with the step that re-records it —
`pnpm install --lockfile-only` — after which `scan --only exact-versions` is clean.

With `--format json` stdout carries the plan document and nothing else; the ledger of writes goes to
stderr. The `pins` and `not pinned` blocks are human presentation and never reach the document.

### `migrate`

```text
funky-secure migrate [--from npm|yarn|auto] [--apply] [--allow-dirty]
```

Prints the five steps of RFC 11.3 in order:

1. **evidence** — foreign lockfiles, `package.json` `packageManager`, `.npmrc` manager lines;
2. **report-only** — `.npmrc` keys pnpm no longer reads, each with where the setting does work;
3. **human step** — `pnpm import` for a yarn lockfile, `pnpm install` otherwise (never executed);
4. **removal** — the foreign lockfile(s), only after `pnpm-lock.yaml` exists;
5. **CI follow-up** — workflow lines that mention npm or yarn, quoted as `file:line` suggestions.

`migrate` refuses outside a git repository, because step 4 needs a tree and a branch. `--apply`
performs step 4 only, and refuses — naming the reason — when `pnpm-lock.yaml` is absent (never delete
the only lockfile), when the tree is dirty for the files it would remove (unless `--allow-dirty`),
when the branch is the default one, when `HEAD` is detached, or when git cannot report the tree. A
repository with no foreign lockfile prints `nothing to remove` and exits `0`. There is no `--format`
for `migrate`; its output is always the human plan.

### `explain`

```text
funky-secure explain [<rule-id>] [--format human|json]
funky-secure explain --list [--format human|json]
```

`explain <id>` prints the rule id and title, its friction and baseline/strict severities, and its
`question`, `detection`, `evidence`, `remediation`, `limits` and `docs` fields. A field the rule
module does not declare prints `(not documented)`. `--list` prints one line per catalog rule,
`id  baseline/strict  title`.

A missing rule id is not an error. `explain` with no id prints the same catalog `--list` prints,
byte for byte, and exits `0`; `--list` stays as the explicit synonym, including under `--format json`,
where both routes print the same document. The catalog is what the command is for, and a human who
types the command alone is asking for it:

```text
$ funky-secure explain | head -6
package-manager-pin     error/error  package.json declares the pnpm that answers
lockfile-committed      error/error  pnpm-lock.yaml is present, tracked and not ignored
foreign-lockfile        warn/warn  No other package manager shapes this repository
quarantine              warn/error  Quarantine is a gate, not an approval list
exact-versions          warn/error  Dependency specifiers are exact
env-not-tracked         error/error  No environment file is committed
```

An unknown id, two ids, or `--list` together with an id is a usage error (exit `2`).

## Flags

Every flag below is in the closed list of `src/cli.js`. A flag used with a command that does not
accept it is a usage error, never a silently ignored argument. Enumerated values are exact.

| Flag | Accepted by | Values | Meaning |
|---|---|---|---|
| `--help` | every command | boolean | print the static help and exit `0` |
| `--scope` | `scan` | `auto`, `repo`, `machine`, `all` | target scope; default `auto` |
| `--preset` | `scan`, `init` | `baseline`, `strict`, `starter` | policy preset; default from config, else `baseline` |
| `--format` | `scan`, `init`, `explain` | `human`, `json` | output format; default `human` |
| `--fail-on` | `scan` | `error`, `warn`, `info`, `none` | verdict threshold; default `error` |
| `--only` | `scan` | comma-separated rule ids | run only these rules; repeats accumulate |
| `--ignore` | `scan` | comma-separated rule ids | never run these rules; repeats accumulate |
| `--strict-probes` | `scan` | boolean | unavailable required probe becomes `error` |
| `--with-timestamp` | `scan` | boolean | add `generatedAt` to the JSON report |
| `--verbose` | `scan` | boolean | show rule ids, per-rule skip reasons and the machine binary path |
| `--apply` | `init`, `migrate` | boolean | perform the write plan instead of only printing it |
| `--allow-dirty` | `init`, `migrate` | boolean | allow writing over uncommitted target files |
| `--from` | `migrate` | `npm`, `yarn`, `auto` | declared origin; default `auto` |
| `--list` | `explain` | boolean | list the catalog instead of explaining one rule |

`--flag value` and `--flag=value` are both accepted. A boolean flag with a value, an unknown flag, a
missing value, or a value outside its enum is a usage error naming the flag.

## Exit codes

The exit code is the stable contract for CI and for agents (RFC 10.4).

| Code | Meaning |
|---|---|
| `0` | No finding at or above `--fail-on`. Skips and infos do not fail. `--help`, no command, `start`, `skill`, and `init` without `--apply` also exit `0`. |
| `1` | At least one policy violation at or above `--fail-on`. Never used for a tool failure. |
| `2` | The tool could not answer: bad usage, unknown command or rule id, malformed config, unreadable input, or an unavailable required probe under `--strict-probes`. Fail closed. |
| `3` | The tool understood the situation and refused to act: the branch is the default one, the target is dirty, the foreign lockfile is the only one, the skill destination is a symbolic link. Nothing was written. |

There is one code per outcome and no code is reused: `0` is a report within the threshold, `1` is a
report past it, `2` is a question the tool could not answer, and `3` is a decision not to act. A refusal
is not a `2`: it is a policy outcome about a situation the tool read correctly, and a script that
branching on the exit code must be able to tell a decision from a crash. It is not a `1` either,
because no finding crossed the threshold and nothing about the repository was judged.

Codes `2` and `3` are two lines on stderr: `funky-secure: <the action to take>` and `reason: <the
internal diagnosis>`. The action comes first because the reader needs it first; the diagnosis is what
the tool knows and the human may not, and it is complete — there is no verbose mode to ask for more.

## JSON documents

### Scan report

`scan --format json` prints the report document of RFC 10.2. Field-by-field semantics, ordering and
the determinism rules live there; in outline:

```json
{
  "schemaVersion": 1,
  "tool": { "name": "funky-secure", "version": "0.7.1" },
  "scope": "all",
  "policy": { "preset": "baseline", "quarantineMinutes": 1440, "failOn": "error" },
  "provenance": {
    "configPath": null,
    "presetSource": "default",
    "machineIncluded": true,
    "quarantineDeclaredIn": null
  },
  "targets": [],
  "summary": { "error": 0, "warn": 0, "info": 0, "pass": 0, "skip": 0, "verdict": "pass" },
  "findings": []
}
```

Only `fail`, `skip` and `error` findings are serialized; passes are counted in `summary.pass`.
`--with-timestamp` adds `generatedAt`; nothing else varies between runs on the same repository state.

### Write plan

`init --format json` prints the plan document of RFC 11.2, not a scan report:

```json
{
  "schemaVersion": 1,
  "tool": { "name": "funky-secure", "version": "0.7.1" },
  "command": "init",
  "policy": { "preset": "baseline", "quarantineMinutes": 1440, "failOn": "none" },
  "plan": [
    {
      "target": "pnpm-workspace.yaml",
      "operation": "managed block",
      "path": "/absolute/path/to/pnpm-workspace.yaml",
      "digest": "<sha256 of the exact bytes>",
      "reason": "…",
      "state": "would-write"
    }
  ],
  "refused": []
}
```

`state` is `would-write`, `would-skip` (already at policy) or `conflict`. Plan paths are absolute and
carry a digest, because a write plan without them cannot be checked; the scan report body never
contains an absolute path (RFC 10.1, 11.5).

With `--format json`, stdout carries this document and nothing else. The ledger of a following
`--apply` — the `write  <path>  <operation>  <digest>` lines — goes to stderr, because a second
document on stdout would make the plan unparseable (F4, I-10). With `--format human` the ledger stays
on stdout, where the plan was printed.

### Rule list

`explain --list --format json` prints the catalog:

```json
{
  "schemaVersion": 1,
  "tool": { "name": "funky-secure", "version": "0.7.1" },
  "rules": [{ "id": "…", "title": "…", "friction": 0, "severity": { "baseline": "error", "strict": "error" }, "docs": "docs/rules/….md" }]
}
```

`explain <id> --format json` uses the same envelope with one rule and adds the rule's `question`,
`detection`, `evidence`, `remediation` and `limits` fields.

### `skill`

```text
funky-secure skill [--install [--user] [--force | --keep]] [--help]
```

Prints the agent skill this package ships, `skills/funky-secure/SKILL.md`, byte for byte on stdout —
no header, no wrapper, no trailing note — so `pnpm dlx funky-secure skill --install`, or a redirect, still produces that
file itself. stderr says that `--install` exists and names the two destinations:

```text
funky-secure skill: install it with funky-secure skill --install
funky-secure skill: .agents/skills/funky-secure/SKILL.md in this project, ~/.agents/skills/funky-secure/SKILL.md for every project
```

That path needs no install step, no agent product and no repository: the file is resolved relative to
the installed module, never from the working directory. An agent can read its own contract from the
version it is running.

#### `--install`

Writes the same bytes to `.agents/skills/funky-secure/SKILL.md`, and **no path is ever typed or
accepted**. Inside a worktree the destination is the worktree root, so the file travels with the
repository; outside one, or with `--user`, it is the home directory.

```text
$ funky-secure skill --install
✓  Installed  ·  .agents/skills/funky-secure/SKILL.md (0.7.1)
     commit it, so the repository carries the instructions its agents read
```

Nothing to do is a different line from something done, and it uses the symbol the report already uses
for "not run":

```text
$ funky-secure skill --install
–  Current  ·  .agents/skills/funky-secure/SKILL.md (0.7.1)
     nothing to do: it already carries this exact version
```

The file declares its version, so an install compares versions before bytes. That distinction is the
whole point: "the bytes differ" is three different situations.

```text
$ funky-secure skill --install < /dev/null          # an older copy is an upgrade
funky-secure: pass --force to replace it, or --keep to leave it as it is
reason: cannot ask whether to replace .agents/skills/funky-secure/SKILL.md: .agents/skills/funky-secure/SKILL.md is version 0.3.0; this binary ships 0.7.1 and stdin is not a terminal
```

```text
$ funky-secure skill --install < /dev/null          # same version, edited by hand
funky-secure: pass --force to replace it, or --keep to leave it as it is
reason: cannot ask whether to replace .agents/skills/funky-secure/SKILL.md: .agents/skills/funky-secure/SKILL.md carries local changes on version 0.7.1 and stdin is not a terminal
```

```text
$ funky-secure skill --install < /dev/null          # a newer copy is not downgraded
funky-secure: install the newer funky-secure to keep that version, or pass --force to downgrade the installed skill
reason: refusing to replace .agents/skills/funky-secure/SKILL.md: it is version 9.0.0, and this binary ships 0.7.1
```

With a terminal the command asks instead. The menu is numbered because a number is unambiguous on any
keyboard, each line states what the answer does, and the default is visible and safe:

```text
funky-secure skill: .agents/skills/funky-secure/SKILL.md carries local changes on version 0.7.1
funky-secure skill: replacing it discards whatever is there now

  1  keep it as it is, and change nothing
  2  replace it with version 0.7.1

funky-secure skill: choose 1 or 2 [1]:
```

The answer is forgiving on purpose: `1`, `k` and `keep` keep; `2`, `o`, `overwrite`, `replace`, `y` and
`yes` replace; an empty answer is the default, which keeps. Anything else is not guessed at — it is
asked again, up to three times, and then the file is kept.

Declining is reported, never silent:

```text
$ funky-secure skill --install --keep
ℹ  Kept  ·  .agents/skills/funky-secure/SKILL.md
     the file was not changed
```

`--force` replaces, `--keep` leaves it as it is, and `--user` chooses the home directory from inside a
repository. Any of the three without `--install` is a usage error, and so is `--force` with `--keep`.
The write is atomic and refuses a symbolic link destination, so a link is never written through.
