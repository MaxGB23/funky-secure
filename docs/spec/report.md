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
  "tool": { "name": "funky-secure", "version": "0.10.1" },
  "scope": "all",
  "policy": {
    "preset": "baseline",
    "quarantineMinutes": 1440,
    "failOn": "error",
    "requireVerified": false
  },
  "provenance": {
    "preset": "baseline",
    "presetSource": "funky-secure.config.json",
    "quarantine": "declared in pnpm-workspace.yaml",
    "machine": "included"
  },
  "targets": [
    { "kind": "machine", "detail": "pnpm 12.3.4" },
    { "kind": "repo-root", "path": "." },
    { "kind": "importer", "path": "." }
  ],
  "summary": { "error": 1, "warn": 2, "info": 0, "pass": 6, "skip": 3, "verdict": "fail" },
  "findings": [ /* Finding[] */ ]
}
```

Determinism rules: no timestamp field; ordering is `scope` (machine, repo) → `target` (root, then
importers sorted by path) → `rule` (catalog order) → `path` → `line`; numbers are integers; strings
are NFC; JSON is 2-space indented with a trailing newline. `--with-timestamp` adds `generatedAt` and
is excluded from golden tests by construction.

`policy` carries the effective `preset`, the `quarantineMinutes` floor it applies, the `failOn`
threshold and `requireVerified`, which records whether `--require-verified` made an unverified rule a
failure (0023). `provenance` is additive to `schemaVersion: 1` and carries no unmeasurable claim:
`preset` is the effective preset, `presetSource` is `--preset`, `default`, or the name of the config
file the preset was read from, `quarantine` states whether this repository's own `pnpm-workspace.yaml`
declares the age — or that the question was not verified because the scope excluded the machine or the
repository — and `machine` is `included` or `excluded`. It is a function of the resolved facts, so it
does not break determinism and changes no count. The human rendering of the same object is the
`provenance` line of 10.3.

`summary` counts every rule verdict exactly once: `error`, `warn` and `info` count the failing
findings by their effective severity; `pass` and `skip` count those statuses. A passing finding is
never counted under its rule's severity, and `info` is a severity, never a rendering of a pass
(Appendix D.1 and D.2 follow this rule). `summary.verdict` is `fail` when at least one finding sits
at or above `policy.failOn`, and `pass` otherwise; with `--fail-on none` the verdict is always `pass`
and `policy.failOn` records `none`.

### 10.3 Human output

**Four shapes, four questions.** Human output is not one template with optional parts: each shape
answers a different question, and using another shape's scaffolding is how a two-line confirmation
ends up wearing a header and a verdict. A command either produces a document about a subject,
narrates what it just did, prints a plan to follow in order, or prints a table to look something up.

| Shape | Question | Who | Structure |
|---|---|---|---|
| document | *what is true about this target* | \`scan\`, \`init\` | header, findings, 90-\`─\` separator, \`next\` — the rest of this section |
| narration | *what just happened* | \`skill\` | one symbol, the fact, the destination; one indented consequence line; no separator, no verdict, no command prefix repeated |
| numbered plan | *what do I do, in what order* | \`start\`, the steps of \`migrate\` | a \`funky-secure <command>  ·  <subtitle>\` line, then numbered steps; \`migrate\` carries evidence columns under each step, \`start\` stays flat because its steps are commands |
| table | *what exists* | \`explain --list\` | aligned columns, one row per rule, no judgement and no summary |

Order is the reason the plan is not a narration: a symbol cannot carry sequence, and a plan whose
steps can be read out of order is not a plan. A table is not a document: it lists, and listing is not
reporting.

**Shared across all four:** the symbols \`✖ ⚠ ℹ ✓ –\` and no others, \`·\` as the field separator, a
96-column ceiling, colour only on a TTY, and no emoji. A narration line borrows the symbols and the
five-space indent of a finding and nothing else — \`✓\` marks something done, \`–\` something with nothing
to do, \`ℹ\` a decision that changed nothing, and a document never uses \`✓\`, because a document states
facts rather than accomplishments.

**Failure is the fifth shape but not a shape of the report:** exit \`2\` writes
\`funky-secure: <action>\` then \`reason: <diagnosis>\` and nothing else, never decorated, because a script
greps those two prefixes and a human reads them first.

### 10.3 (original text follows)


One header block, then one block per target, then the `next` block below. The header is the title
line, the `provenance` line, `summary`, `verdict`, then a separator of 90 `─`. `summary` and
`verdict` keep the names and the nine-character gutter they have always had; only their position
moved, so a reader or a script that greps either label reads the counts before the evidence and is
not broken by the move.

When the effective policy sets at least one rule `off`, the header gains exactly one `not run` line
between `verdict` and the separator, in the same nine-character gutter:

```
not run  6 of 12 rules; off by policy: Environment files, Pinned actions, Bot auto-merge,
         CI install flags, pull_request_target, Workflow permissions
```

The two numbers are how many catalog rules still run and how many the catalog has. A rule at `off`
does not run, is not counted and prints nothing (9.2), so the line states the coverage the verdict
actually has: a `PASS` under a reduced preset would otherwise claim rules nobody measured. The labels
are in catalog order (8.2, 13.1) and are the same labels a finding heading carries, so the line names
the rules exactly as the rest of the report would. The text wraps at 86 columns with every
continuation indented to the gutter — ten columns narrower than the rest of the report, because this
is a set the reader scans against the catalog rather than a sentence to be read. A policy that
disables nothing prints no such line, and its header is exactly what it was. Narrowing one run with
`--only` or `--ignore` never prints it: those flags choose what to look at in this run and do not
claim the policy checks less, so a coverage a flag made shorter is not a policy statement. The line is
human output only; the JSON document of 10.2 gains no field for it, because a machine reader already
has `policy.preset` and the counts that preset produced.

A finding is at most three lines, and no finding shares a line with another finding or with a rule
id:

```
  ✖  Sensitive files  ·  .gitignore
     .env, .env.local, .env.production, secrets.pem, server.key, .npmrc are not ignored by git
     → funky-secure init --apply
```

The heading carries the severity symbol, the rule's short human `label` and the location — `path`, or
`path:line` when one line is the subject; the message is indented five columns and wraps with a
hanging indent; the action is `→ <command>` at the same five columns, and every `fail` finding
carries one (4.6). A block's heading is the target kind in upper case: `REPO-ROOT`,
`IMPORTER <path>`, `CI`, `MACHINE`.

The rule id is not shown to a human by default. It is a public identifier (6.2) and a name for the
tool, so it stays in the JSON document (10.2), in `--help`, in `explain` and in `scan --verbose`
(11.1). The label is a second field of the same catalog entry (13.1), so the catalog stays the only
source and no second list of names exists to drift.

A target with nothing to report is two lines: the heading, and the count under it at the same five
columns a finding hangs from — `CI` then `     all 5 rules pass` — so a clean block reads like every
other block instead of like a sentence with a colon. Passing rules are counted in `summary` and never
printed one line each (10.1); `--verbose` restores their ids in a single `passing` line.

Skips collapse by target. Two or more skipped rules in one target print one `–` line naming the
labels that were not verified and the command that expands them, `funky-secure scan --verbose`,
instead of one block per skip. A target with exactly one skipped rule prints that rule's own block,
symbol `–`: one reason and its verifying command fit in three lines, and a human should not have to
pass a flag to read them. Neither shape changes the JSON document.

No rendered line exceeds 96 columns, and the `not run` line above is bounded more tightly still, at
86. Messages and actions wrap, never truncate. The single exception is a machine path — the store and
the executable of the `MACHINE` block, whose absolute form is the fact (10.1) — shortened in the middle
with `…`, because its length is not ours to bound and a fixed cut point keeps the rendering
deterministic. `--verbose` prints it whole and the JSON keeps it whole.

Color is emitted only when `stdout` is a TTY and `NO_COLOR` is unset; the plain text is valid on its
own (Appendix D.1).

Immediately after the title line, one `provenance` line states the preset and its source, whether the
repository declares the quarantine key, and whether the machine was excluded — the same facts as the
JSON field of 10.2, in one line, never a claim about where an effective value came from.

A skipped rule states what was not verified and the command that verifies it, not only the contract
that excluded it: `--scope repo` omitting the machine is a fact a CI reader has to be able to act on
(7.2). When the skips of a target are collapsed — two or more of them — that sentence and its command
live behind `funky-secure scan --verbose`, which the collapsed line names; the obligation moves, it is
not dropped.

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

The JSON document of 10.2 is the contract; the human text above is presentation. A minor release may
change that presentation, as long as the report remains valid on its own.

### 10.4 Exit codes

| Code | Meaning |
|---|---|
| `0` | No finding at or above `--fail-on`. Skips and infos do not fail. |
| `1` | At least one policy violation at or above `--fail-on`. |
| `2` | The tool could not answer: bad usage, unreadable input, malformed config, unavailable required probe under `--strict-probes`. Never used for a policy violation, and never used for a refusal. |
| `3` | The tool understood the situation and refused to act: the branch is the default one, the target is dirty, the foreign lockfile is the only one. Nothing was written. |

`2` is the fail-closed code and `3` is the refusal: an exit code names exactly one thing, so a script
or an agent can tell a decision from a crash without parsing text. A refusal is a policy outcome, which
is why it cannot share the code the specification reserves for a question the tool could not answer; it
is not a `1` either, because no finding crossed the threshold and nothing about the repository was
judged. A CI job that only distinguishes zero from non-zero still behaves correctly, and a job that
cares can tell all four apart.

Exit codes are a machine contract, not a user interface. Every message a human reads — usage error,
config error, refusal, tool failure — leads with the action and puts the internal diagnosis after a
`reason:` label. A refusal that begins with the reason it could not check the
branch is a defect of the same class as a stale help text: it leaves the reader to translate.

### 10.5 `--fail-on`

`--fail-on error` (default) | `warn` | `info` | `none`. `none` is the pure-reporting mode: `init`'s
planning and `explain` use it internally and do not expose the flag (`scan` is the only command that
accepts it, 11.1). The flag changes the verdict only; every finding is always reported.

---
