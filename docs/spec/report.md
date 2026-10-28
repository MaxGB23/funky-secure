# Report contract

> Normative. Extracted verbatim from RFC 0001 section 10 (revision 7). The record is at
> [`../../rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the code owes. Change this file, not the record.

## 10. Report contract

### 10.1 Finding

```
{
  rule:       "exact-versions",           // stable id
  status:     "fail" | "pass" | "skip" | "error",
  severity:   "error" | "warn" | "info" | "off",   // effective, after policy
  code:       "lockfile-desync",          // optional, stable within the rule
  scope:      "repo" | "machine",
  target:     "importer",                 // target kind
  path:       "packages/api/package.json",// repo-relative, POSIX separators, no absolute paths
  line:       14,                          // 1-based, omitted when not applicable
  message:    "yaml@^2.9.0 is a floating range",
  evidence:   { specifier: "^2.9.0", resolved: "2.9.0" },
  remediation:{ kind: "manual" | "auto" | "none", command: "pnpm add --save-exact yaml@2.9.0" },
  doc:        "funky-secure explain exact-versions"
}
```

Absolute paths never appear in a report body; they appear only in `--scope machine`'s binary/store
evidence, because there the absolute path *is* the fact. The same holds for a write plan, which is a
separate document (11.2).

`code` is optional and, when present, stable: one rule may produce findings for different reasons
(`exact-versions` → `floating-range`, `lockfile-desync`) and a consumer must be able to tell them
apart without parsing a message. Rule ids are the public contract (6.2); codes are too.

**What is serialized.** `findings[]` carries the `fail`, `skip` and `error` findings only. `pass`
findings are counted in `summary.pass` and never listed: a repository with twelve passing rules does
not print twelve lines of reassurance. A rule set to `off` (9.2) contributes nothing at all — no
finding and no count.

### 10.2 JSON output

```json
{
  "schemaVersion": 1,
  "tool": { "name": "funky-secure", "version": "0.4.0" },
  "scope": "all",
  "policy": { "preset": "baseline", "quarantineMinutes": 1440, "failOn": "error" },
  "provenance": {
    "configPath": "funky-secure.config.json",
    "presetSource": "config",
    "machineIncluded": true,
    "quarantineDeclaredIn": "pnpm-workspace.yaml"
  },
  "targets": [
    { "kind": "machine", "detail": "pnpm 12.3.4" },
    { "kind": "repo-root", "path": "." },
    { "kind": "importer", "path": "." }
  ],
  "summary": { "error": 1, "warn": 2, "info": 0, "pass": 6, "skip": 0, "verdict": "fail" },
  "findings": [ /* Finding[] */ ]
}
```

Determinism rules: no timestamp field; ordering is `scope` (machine, repo) → `target` (root, then
importers sorted by path) → `rule` (catalog order) → `path` → `line`; numbers are integers; strings
are NFC; JSON is 2-space indented with a trailing newline. `--with-timestamp` adds `generatedAt` and
is excluded from golden tests by construction.

`provenance` is additive to `schemaVersion: 1` and carries no unmeasurable claim: `configPath` is the
discovered config file or `null`, `presetSource` is `config`, `flag` or `default`, `machineIncluded`
follows the scope, and `quarantineDeclaredIn` is the repository file that declares the key or `null`.
It is a function of the resolved facts, so it does not break determinism and changes no count.

`summary` counts every rule verdict exactly once: `error`, `warn` and `info` count the failing
findings by their effective severity; `pass` and `skip` count those statuses. A passing finding is
never counted under its rule's severity, and `info` is a severity, never a rendering of a pass
(Appendix D.1 and D.2 follow this rule). `summary.verdict` is `fail` when at least one finding sits
at or above `policy.failOn`, and `pass` otherwise; with `--fail-on none` the verdict is always `pass`
and `policy.failOn` records `none`.

### 10.3 Human output

Grouped by target, one line per finding, remediation indented under it, and a summary that
distinguishes pass / fail / skip. Passing rules are rolled up into a single `passing` line that names
them, never one line each (10.1); skipped rules keep their own line, with the reason. Color is emitted
only when `stdout` is a TTY and `NO_COLOR` is unset; the plain text is valid on its own
(Appendix D.1).

Immediately after the title line, one `provenance` line states the preset and its source, whether the
repository declares the quarantine key, and whether the machine was excluded — the same facts as the
JSON field of 10.2, in one line, never a claim about where an effective value came from.

A skipped rule states what was not verified and the command that verifies it, not only the contract
that excluded it: `--scope repo` omitting the machine is a fact a CI reader has to be able to act on
(7.2).

A human `scan` ends by naming the next command, not only the verdict. After `summary` and `verdict`, one
`next` block uses the same label gutter and says exactly one of three things: when at least one failing
finding carries an `auto` remediation, `funky-secure init` together with the number of fixes it can make
and the fact that nothing is written yet; when the verdict is `pass`, that nothing is left to do; when
the verdict is `fail` and no finding is automatic, that the work is manual and each finding already names
its file, line and action. When the block names `init`, a second line names one rule through
`funky-secure explain <rule>`, chosen as the highest-severity failing finding with ties broken by catalog
order, so the two runs over the same state produce the same bytes. The block is human output only: the
JSON document of 10.2 does not gain a field for it, because a reader that wants the plan asks for the
plan (10.5, 11.2.1).

### 10.4 Exit codes

| Code | Meaning |
|---|---|
| `0` | No finding at or above `--fail-on`. Skips and infos do not fail. |
| `1` | At least one policy violation at or above `--fail-on`. |
| `2` | The tool could not answer: bad usage, unreadable input, malformed config, unavailable required probe under `--strict-probes`. Never used for a policy violation. |

`2` is the fail-closed code. A CI job that only distinguishes zero from non-zero still behaves
correctly, and a job that cares can tell the two apart without parsing text.

Exit codes are a machine contract, not a user interface. Every message a human reads — usage error,
config error, refusal, tool failure — leads with the action and puts the internal diagnosis after a
`reason:` label. A refusal that begins with the reason it could not check the
branch is a defect of the same class as a stale help text: it leaves the reader to translate.

### 10.5 `--fail-on`

`--fail-on error` (default) | `warn` | `info` | `none`. `none` is the pure-reporting mode: `init`'s
planning and `explain` use it internally and do not expose the flag (`scan` is the only command that
accepts it, 11.1). The flag changes the verdict only; every finding is always reported.

---
