# Command line

One binary, `funky-secure`, with four commands: `scan`, `init`, `migrate` and `explain`. Every
command is defined by the contract of the RFC (`rfcs/funky-secure-rfc.md`, sections 10 and 11); this
page is the operating manual, not a second specification.

```text
funky-secure <command> [options]
funky-secure --help
```

`--help` and an invocation with no command print the static help and exit `0`. The help text is
generated from the same command and flag tables the parser uses, so it cannot describe a previous
release (RFC 13.1, 13.3).

## Commands

### `scan`

```text
funky-secure scan [--scope auto|repo|machine|all] [--preset baseline|strict]
                  [--format human|json] [--fail-on error|warn|info|none]
                  [--only <ids>] [--ignore <ids>] [--strict-probes] [--with-timestamp]
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

### `init`

```text
funky-secure init [--preset baseline|strict] [--format human|json] [--apply] [--allow-dirty]
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

It refuses — exit `2`, naming the file or the reason, and writing nothing:

- a target with uncommitted changes, unless `--allow-dirty` is passed;
- a working tree `git status --porcelain -z` cannot report, because the check above cannot be made;
- a plan item whose content changed between planning and writing, or that carries no content.

It never overwrites a value it did not write. A value that exists and differs is a `conflict`: it is
printed in the plan, left untouched, and is not a write. That covers a conflicting `packageManager`,
a `minimumReleaseAge` or `minimumReleaseAgeStrict` declared outside the managed block, an
unparseable or differently-configured `funky-secure.config.json`, and a config file discovered
somewhere other than the repository root. A `conflict` alone does not make the command fail; it makes
the plan a refusal you can read. A second `--apply` over the same state performs zero writes.

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
funky-secure explain <rule-id> [--format human|json]
funky-secure explain --list [--format human|json]
```

`explain <id>` prints the rule id and title, its friction and baseline/strict severities, and its
`question`, `detection`, `evidence`, `remediation`, `limits` and `docs` fields. A field the rule
module does not declare prints `(not documented)`. `--list` prints one line per catalog rule,
`id  baseline/strict  title`. An unknown id, a missing id, two ids, or `--list` together with an id
is a usage error (exit `2`).

## Flags

Every flag below is in the closed list of `src/cli.js`. A flag used with a command that does not
accept it is a usage error, never a silently ignored argument. Enumerated values are exact.

| Flag | Accepted by | Values | Meaning |
|---|---|---|---|
| `--help` | `scan`, `init`, `migrate`, `explain` | boolean | print the static help and exit `0` |
| `--scope` | `scan` | `auto`, `repo`, `machine`, `all` | target scope; default `auto` |
| `--preset` | `scan`, `init` | `baseline`, `strict` | policy preset; default from config, else `baseline` |
| `--format` | `scan`, `init`, `explain` | `human`, `json` | output format; default `human` |
| `--fail-on` | `scan` | `error`, `warn`, `info`, `none` | verdict threshold; default `error` |
| `--only` | `scan` | comma-separated rule ids | run only these rules; repeats accumulate |
| `--ignore` | `scan` | comma-separated rule ids | never run these rules; repeats accumulate |
| `--strict-probes` | `scan` | boolean | unavailable required probe becomes `error` |
| `--with-timestamp` | `scan` | boolean | add `generatedAt` to the JSON report |
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
| `0` | No finding at or above `--fail-on`. Skips and infos do not fail. `--help`, no command, `init` without `--apply`, and a successful `explain` also exit `0`. |
| `1` | At least one policy violation at or above `--fail-on`. Never used for a tool failure. |
| `2` | The tool could not answer: bad usage, unknown command or rule id, malformed config, unreadable input, unavailable required probe under `--strict-probes`, or a refused write. Fail closed. |

There is one code per outcome and no code is reused: the RFC defines `0`, `1` and `2`, and
everything that is neither a violation nor a tool failure exits `0` (see the `0` row above).

A code `2` is two lines on stderr: `funky-secure: <the action to take>` and `reason: <the internal
diagnosis>`. The action comes first because the reader needs it first; the diagnosis is what the tool
knows and the human may not, and it is complete — there is no verbose mode to ask for more. The same
shape applies to every refusal (`init` over a dirty target, `migrate` on the default branch): the first
line names the fix, the second names the condition that refused.

## JSON documents

### Scan report

`scan --format json` prints the report document of RFC 10.2. Field-by-field semantics, ordering and
the determinism rules live there; in outline:

```json
{
  "schemaVersion": 1,
  "tool": { "name": "funky-secure", "version": "0.4.0" },
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
  "tool": { "name": "funky-secure", "version": "0.4.0" },
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
  "tool": { "name": "funky-secure", "version": "0.4.0" },
  "rules": [{ "id": "…", "title": "…", "friction": 0, "severity": { "baseline": "error", "strict": "error" }, "docs": "docs/rules/….md" }]
}
```

`explain <id> --format json` uses the same envelope with one rule and adds the rule's `question`,
`detection`, `evidence`, `remediation` and `limits` fields.
