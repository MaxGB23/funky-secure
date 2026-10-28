# Command contracts

> Normative. Extracted verbatim from RFC 0001 section 11 (revision 7). The record is at
> [`../../rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the code owes. Change this file, not the record.

## 11. Command contracts

### 11.1 `scan`

```
funky-secure scan [--scope auto|repo|machine|all] [--preset baseline|strict]
                  [--format human|json] [--fail-on error|warn|info|none]
                  [--only <ids>] [--ignore <ids>] [--strict-probes] [--with-timestamp]
                  [--verbose]
```

- Read-only, always. No file is created, modified or removed, in any scope.
- Default: `--scope auto`, `--format human`, `--fail-on error`, preset from config or `baseline`.
- `--strict-probes`: a required probe that is unavailable becomes `error` (exit `2`) instead of
  `skip`. CI uses it to refuse a green build that measured nothing.
- `--verbose`: the human report gains what 10.3 leaves out by default — the id of every finding, the
  reason and the verifying command of each skipped rule in place of the collapsed line, the ids of the
  passing rules, and the machine block's paths unbroken. It is a rendering flag: it changes no count,
  no ordering and no byte of the JSON document, which is the same document with and without it.
- Output: section 10. Exit: section 10.4.

### 11.2 `init`

```
funky-secure init [--preset baseline|strict] [--apply] [--allow-dirty] [--format human|json]
```

Default is a **plan**: it runs the same scan, derives the writes the policy and the repository's own
files call for, prints them, and exits `0`. `init` reports, it does not judge: it uses the `--fail-on none`
semantics of section 10.5 internally and does not accept the flag (`scan` is the only command that
does), because a plan is an offer, not a verdict. It exits `2` only when the tool cannot answer
(10.4), never because the plan is non-empty.

With `--apply` it performs exactly these writes, and no others:

| # | Target | Condition | Operation |
|---|---|---|---|
| W1a | `pnpm-workspace.yaml` | the managed block does not already declare `minimumReleaseAgeStrict: true`, whether or not the machine satisfies it (11.2.1) | managed block with `minimumReleaseAgeStrict: true` |
| W1b | `pnpm-workspace.yaml` | `--preset strict` passed | the same managed block also carries `minimumReleaseAge: 4320` |
| W1c | `pnpm-workspace.yaml` | the managed block does not already carry `savePrefix: ''` (D-18) | the same managed block also carries `savePrefix: ''` |
| W2 | `.gitignore` | `sensitive-ignored` fails | managed block with the missing entries required by R7: `.env`, `.env.*`, `!.env.example`, `!.env.test.example`, `*.pem`, `*.key`, plus `.npmrc` only when the repository does not track a root `.npmrc` without a token |
| W3 | `package.json` | `package-manager-pin` fails **without** conflict | set `packageManager` |
| W4 | `funky-secure.config.json` | `--preset strict` passed | persist `{ "preset": "strict" }` so CI agrees |

It never writes `ignoreScripts`, `allowBuilds`, `onlyBuiltDependencies`, `strictDepBuilds`,
`trustPolicy`, `blockExoticSubdeps`, dependency versions, `.npmrc`, workflows, or anything on the
machine.

`--format json` for `init` and `migrate` prints a **plan document**, not a scan report:
`{ schemaVersion, tool, command, policy, plan: [{ target, operation, path, digest, reason, state }], refused: [] }`.
`path` is absolute and `digest` is the sha256 of the exact bytes to be written, because a write plan
without them cannot be checked (11.5, point 5); absolute paths remain forbidden in the `scan` report
body only (10.1). `state` is `would-write`, `would-skip` (already at policy) or `conflict`.

A repository that gains a `pnpm-workspace.yaml` through W1a becomes a pnpm workspace root. That is a
real semantic change, and the plan item's `reason` states it next to the value being written.

The two writes are separate on purpose. **W1a is the gate flip:** writing
`minimumReleaseAgeStrict: true` turns the quarantine from non-strict auto-exclusion into a decision a
human has to make, so setups that install today can fail with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` at
resolution or `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` at lockfile verification, and a green CI can
turn red at the next install (E1). **W1b only raises the floor once a gate exists:**
`minimumReleaseAge: 4320` is written because `--preset strict` says so, not because the gate needs it.
Both land in the same managed block, so the block stays one unit of edit and one unit of review. The
plan item's `reason` states which of the two applies, and a hotfix goes through
`minimumReleaseAgeExclude` — the file pnpm itself already writes in non-strict mode.

Managed block format (line-based, no YAML parser):

```yaml
# funky-secure:begin (managed block — do not edit by hand)
minimumReleaseAgeStrict: true
minimumReleaseAge: 4320
savePrefix: ''
# funky-secure:end
```

The second key is written only when `--preset strict` was passed (W1b); the first is written whenever
the managed block does not declare it (W1a); `savePrefix: ''` is written whenever the block lacks it
(W1c), because it is the project-level setting that stops a later `pnpm add` from saving a caret
(4.6, D-18).

Rules for the block:

- Idempotent by marker. Second run: the block content is compared, and identical content means zero
  writes.
- Appended at the end of the file with one blank separator line when absent; only the lines between
  the markers are ever replaced when present.
- Refuses to write (`conflict` finding, no write) when the file already declares the same top-level
  key outside the block. Two sources for one setting is the defect this product exists to report.
- When the file does not exist, `init` creates it **only** for W1a/W1b; it does not synthesize a
  `packages:` key (the old implementation's silent behavior was correct here and is kept).

Safety rules for `--apply`:

- A target file with uncommitted changes is refused (exit `2`, naming the file) unless
  `--allow-dirty`. A security tool does not mix its edits with a stranger's.
- An empty plan performs zero writes and prints `nothing to apply`.
- Every write is printed before it happens, with its absolute path and a content digest, on the same
  run (no dry-run/apply race).
- `init` never runs an install, never resolves a version, never touches the network.

#### 11.2.1 The plan reads the repository, never the host

A plan item is derived from the repository's own files and the declared policy, never from the
effective configuration the machine happens to satisfy. The distinction is not academic: a machine
whose global pnpm configuration already carries `minimumReleaseAge: 4320` makes the quarantine rule
pass, so a plan derived from that verdict writes nothing, and the repository is only hardened on that
one laptop. The same defect runs the other way on a machine with a lower global value, which produces
a repository nobody else can reproduce. So W1a's condition is "the managed block does not declare it",
not "the effective strictness is false", and the machine's effective value is reported, never used to
suppress a write.

#### 11.2.2 `next steps`: the steps the tool refuses to take

A human plan ends with the steps only a human can run, in the order they must run, printed and never
executed:

- `pnpm install` when the repository has no `pnpm-lock.yaml`, because the tool never resolves or
  installs (4.7, 11.6).
- `funky-secure migrate --apply` when a foreign lockfile coexists with the pnpm one; `--from` is
  omitted so the plan names the manager it actually finds — a `yarn.lock` needs `pnpm import`, not
  `pnpm install` (11.3).
- `git add` for the paths the plan wrote, so the next `--apply` over the same state is not refused as
  dirty (11.2, safety rules).

The block is part of the human rendering only. `--format json` carries the plan document of 10.5 and
no prose, and a plan with no human step prints no `next steps` heading.

### 11.3 `migrate`

```
funky-secure migrate [--from npm|yarn|auto] [--apply] [--allow-dirty]
```

Plan steps, printed in order:

1. **Evidence:** which foreign lockfiles and which package manager traces exist (`package.json`
   `packageManager`, `.npmrc` `package-manager` lines, `engines`).
2. **Report-only, no action:** behavior settings in `.npmrc` that pnpm no longer reads (4.1 and 1.3),
   listed by key name so the user moves them to `pnpm-workspace.yaml` or the pnpm global config
   deliberately.
3. **Human step:** create the pnpm lockfile (`pnpm import` for a yarn lockfile, `pnpm install`
   otherwise). This step is never executed by the tool: it resolves and downloads (4.9).
4. **Removal:** the foreign lockfile(s), only after `pnpm-lock.yaml` exists.
5. **CI follow-up:** the workflow lines that need rewriting, quoted by `file:line`, as suggestions.

`--apply` performs step 4 only. It refuses when `pnpm-lock.yaml` is absent (never delete the only
lockfile), when the tree is dirty for those files, or when the current branch is the default branch.
Every refusal is exit `2` with the reason, never a silent no-op. The default branch is read from
`refs/remotes/origin/HEAD` (12.1); a repository without a remote cannot resolve it, and the fallback
is a literal `main`/`master` match, stated as a fallback in the refusal message.

### 11.4 `explain`

```
funky-secure explain <rule-id>
funky-secure explain --list [--format json]
```

Prints, for one rule: id, title, friction class, severity per preset, the question it answers, the
detection in prose, the evidence shape, the remediation, what it deliberately does **not** do, and
the path of its documentation. An unknown id is exit `2`: a mistyped rule id is a configuration bug,
not a user error to be swallowed.

### 11.5 Write-target validation contract (applies to `apply` in v0.2 too)

Every write path in this product, present and future, obeys:

1. **The target comes from a closed catalog**, never from user input, an environment variable, or a
   string built from the repository. `--apply` chooses *whether* to write, never *where*.
2. **Resolved and contained:** the target's `realpath` must sit inside an allowed root (`git
   rev-parse --show-toplevel`, or for machine scope a declared machine root that v0.1 never writes).
   Symlinked paths that resolve outside are refused.
3. **Expected basename:** the resolved file name must match the catalog entry exactly.
4. **Re-validated immediately before the write** (no check-then-write gap).
5. **Printed as an absolute path** with a digest of the exact bytes to be written, in the same run
   that writes them.
6. **Read-only machine facts are still facts:** the store path, cache path, global bin dir and
   global dir are read from the effective configuration and printed as evidence (`--scope machine`),
   never created, never repaired.

The purpose is the one the author named: when `apply` exists, it must be impossible for a bug or a
prompt-injected instruction to redirect a write to an arbitrary path such as the user's store.

### 11.6 What no command does

No command runs an install, a build, a lifecycle script, a network request, a git write command
(`add`, `commit`, `checkout`), or a package-manager write command on the machine. No command modifies
`funky-ai`, `funky-cli`, or any file outside the current repository root.

---
