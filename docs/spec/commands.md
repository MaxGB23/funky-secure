# Command contracts

> Normative. Extracted verbatim from RFC 0001 section 11 (revision 7). The record is at
> [`../../rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the code owes. Change this file, not the record.

## 11. Command contracts

### 11.1 `scan`

```
funky-secure scan [--scope auto|repo|machine|all] [--preset baseline|strict|starter]
                  [--format human|json] [--fail-on error|warn|info|none]
                  [--only <ids>] [--ignore <ids>] [--strict-probes] [--require-verified]
                  [--with-timestamp] [--verbose]
```

- Read-only, always. No file is created, modified or removed, in any scope.
- Default: `--scope auto`, `--format human`, `--fail-on error`, preset from config or `baseline`.
- `--strict-probes`: a required probe that is unavailable becomes `error` (exit `2`) instead of
  `skip`. CI uses it to refuse a green build that measured nothing.
- `--require-verified`: a skipped rule makes the verdict `fail` and the run exits `1`, and
  `policy.requireVerified` records that the gate asked for it. Without the flag a skip is never a
  failure, because not knowing is not a violation (0023).
- `--verbose`: the human report gains what 10.3 leaves out by default — the id of every finding, the
  reason and the verifying command of each skipped rule in place of the collapsed line, the ids of the
  passing rules, and the machine block's paths unbroken. It is a rendering flag: it changes no count,
  no ordering and no byte of the JSON document, which is the same document with and without it.
- Output: section 10. Exit: section 10.4.

### 11.2 `init`

```
funky-secure init [--preset baseline|strict|starter] [--apply] [--allow-dirty] [--format human|json]
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
| W1b | `pnpm-workspace.yaml` | always, beside W1a | the same managed block also carries the age: `minimumReleaseAge: 1440` under `baseline`, `4320` under `--preset strict` (0017) |
| W1c | `pnpm-workspace.yaml` | the managed block does not already carry `savePrefix: ''` (D-18) | the same managed block also carries `savePrefix: ''` |
| W2 | `.gitignore` | `sensitive-ignored` fails | managed block with the entries R7 requires: `.env`, `.env.*`, `!.env*.example` — the template family negated as a family, not two enumerated spellings (0024) — `*.pem`, `*.key` and `node_modules/`, plus `.npmrc` only when the repository does not track a root `.npmrc` without a token |
| W3 | `package.json` | `package-manager-pin` fails **without** conflict | set `packageManager` |
| W4 | `funky-secure.config.json` | `--preset strict` passed | persist `{ "preset": "strict" }` so CI agrees |

It never writes `ignoreScripts`, `allowBuilds`, `onlyBuiltDependencies`, `strictDepBuilds`,
`trustPolicy`, `blockExoticSubdeps`, dependency versions, `.npmrc`, workflows, or anything on the
machine.

`--format json` for `init` prints a **plan document**, not a scan report:
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

The second key is written on every run (W1b) — `1440` under `baseline`, `4320` under `--preset
strict` — because pnpm's built-in default is `1440` from the 11 line on and `0` before it, so a block
that declared only the strict flag would claim a gate an older major enforces nowhere; the first is
written whenever the managed block does not declare it (W1a); `savePrefix: ''` is written whenever the
block lacks it (W1c), because it is the project-level setting that stops a later `pnpm add` from saving
a caret (4.6, D-18). The sample above is the `--preset strict` one.

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

- A target file with uncommitted changes is refused (exit `3`, naming the file) unless
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
  omitted so the plan names the manager it actually finds — a foreign lockfile needs `pnpm import`,
  because `pnpm install` never reads one (11.3, 0021).
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
3. **Human step:** create the pnpm lockfile with `pnpm import` for any foreign lockfile — it reads
   `yarn.lock` or `package-lock.json` and records the versions they pinned, which `pnpm install`
   discards by resolving from the manifest. This step is never executed by the tool (4.9).
4. **Removal:** the foreign lockfile(s), only after `pnpm-lock.yaml` exists.
5. **CI follow-up:** the workflow and composite-action lines that need rewriting, quoted by
   `file:line`, as suggestions.

`--apply` performs step 4 only. It refuses when `pnpm-lock.yaml` is absent (never delete the only
lockfile), when the tree is dirty for those files, or when the current branch is the default branch.
Every refusal is exit `3` with the reason, never a silent no-op. The default branch is read from
`refs/remotes/origin/HEAD` (12.1); a repository without a remote cannot resolve it, and the fallback
is a literal `main`/`master` match, stated as a fallback in the refusal message.

### 11.4 `explain`

```
funky-secure explain [<rule-id>]
funky-secure explain --list [--format json]
```

Prints, for one rule: id, title, friction class, severity per preset, the question it answers, the
detection in prose, the evidence shape, the remediation, what it deliberately does **not** do, and
the path of its documentation. An unknown id is exit `2`: a mistyped rule id is a configuration bug,
not a user error to be swallowed. A missing rule id is not an error: with no id the command prints the
same catalog `--list` prints, byte for byte, and exits `0`, and `--list` stays as the explicit
synonym for that output.

### 11.5 Write-target validation contract (applies to `apply` in v0.2 too)

Every write path in this product, present and future, obeys the first six points below. The seventh
governs the single exception: `skill --install`, which writes one file outside the repository
(record 0005).

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
7. **The one write outside the repository** is `skill --install`, and it is bounded by points 1, 3
   and 4 rather than by point 2: the target is the constant `.agents/skills/funky-secure/SKILL.md`
   under either the worktree root or the home directory, so there is no user input to traverse with;
   no path argument exists, and a path argument is a usage error. The write is refused when the
   destination is a symbolic link, and it is atomic — a temporary file in the same directory renamed
   over the target, removed when the write fails. It never reads a machine fact and never writes one.

The purpose is the one the author named: when `apply` exists, it must be impossible for a bug or a
prompt-injected instruction to redirect a write to an arbitrary path such as the user's store.

### 11.6 What no command does

No command runs an install, a build, a lifecycle script, a network request, a git write command
(`add`, `commit`, `checkout`), or a package-manager write command on the machine. No command modifies
`funky-ai`, `funky-cli`, or any file outside the current repository root, with one exception that has
to be asked for: `skill --install` writes its own skill file under the worktree root or the home
directory (11.5 point 7, 11.8). Nothing else leaves the repository, and no command writes into a
home directory as a side effect of running.

### 11.7 `start`

```
funky-secure start [--help]
```

Read-only, always: it creates no file, modifies none, installs nothing and touches nothing on the
machine, in any scope. It answers one question — *what do I run first, in this order* — for a
repository that has nothing yet. It is guidance, not a gate: it exits `0` whether or not the
repository is at policy, and `2` only for a usage error (10.4). `--help` is the only flag it accepts;
there is no `--format`, because its output is prose and has no document, and no `--preset`, because
the preset it recommends is named in the answer itself.

It derives everything from the same collection and the same write plan that `scan` and `init` use
(11.1, 11.2): the repository facts the collector already resolved, and the `would-write` items of the
plan `init` derives from the same report. It measures no fact of its own, so it cannot contradict the
report about the same repository.

The steps are ordered by cause and only the ones that still apply are printed, numbered from `1`:

| # | Step | Printed when |
|---|---|---|
| 1 | `git init` | the directory is not a git repository |
| 2 | `pnpm init` | there is no `package.json` |
| 3 | `git add -A && git commit -m "<message>"` | the plan has a `would-write` item and any of its target paths already carries uncommitted work, because `init --apply` refuses to write over a tree whose state is not recorded |
| 4 | `funky-secure init --apply` | the plan has at least one `would-write` item, printed with its count and the fact that nothing is written yet |
| 5 | `git add <the paths the plan wrote> && git commit -m "<message>"` | step 4 printed: it leaves the manifest dirty, and the next writer refuses that state. The step names those paths instead of staging everything, so an untracked tool cache beside them stays out of the commit. The commit appears twice in a repository whose tree already carried work, because it answers two questions, and each carries a line of its own in `why this order` |
| 6 | `pnpm import` | a lockfile another package manager produced is present: it reads that lockfile and writes `pnpm-lock.yaml` with the versions it recorded, under the block step 4 wrote. `pnpm install` never reads a foreign lockfile, so it would resolve from the manifest and discard the pins the repository already has (11.3, 0021) |
| 7 | `funky-secure pin --apply` | the report carries a `floating-range` finding, printed with its count: the block governs the dependencies added next, and nothing else clears the ranges the manifest already has (11.9) |
| 8 | `pnpm install --lockfile-only` | step 7 printed: `pin` writes exact specifiers over a lockfile that recorded a range, which is a desync by construction (11.9), and this is the resolve that re-syncs it without touching `node_modules` |
| 9 | `git switch -c chore/supply-chain-bootstrap` | a foreign lockfile is present: `migrate --apply` refuses to remove one on the default branch, so the step that requires a feature branch prints the command that creates it (0018) |
| 10 | `funky-secure migrate --apply` | a foreign lockfile is present, after the install: the removal needs the `pnpm-lock.yaml` the install writes, because a foreign lockfile that is the only one is never deleted. The refusal names the same `git switch -c` command this step prints, because it refuses to remove a lockfile on `main` (10.4) |
| 11 | `pnpm add <your first dependency>` | there is no `pnpm-lock.yaml` and no foreign lockfile, because a lockfile cannot exist before the first add |
| 12 | `git add pnpm-lock.yaml [package.json] [<the removed lockfile>] && git commit -m "<message>"` | the install above is about to write a lockfile, or the report already carries a `lockfile-committed` finding for one that is present: the last step reads a tracked lockfile, and a commit that would stage nothing is never printed. When step 10 removed a foreign lockfile, the commit stages that removal too, because a commit that closes a migration and leaves the deletion in the index has left the tree dirty (0018) |
| 13 | `funky-secure scan --preset starter` | always, and last |

The order is the cause order and not a preference: a managed block has to exist before the install that
reads it, the block is only written over a committed tree, `migrate --apply` refuses to remove a
foreign lockfile while `pnpm-lock.yaml` is absent, and the branch it needs has to exist before it runs.
The earlier order — `migrate` before the block — could not honour the first rule in any repository
arriving from npm or yarn: the first resolve happened before the policy that governs it. Steps 4 and 5
therefore run in that order, and step 3 is asked for before them.

The order is the contract: the managed block has to exist before the install that reads it, because
`savePrefix: ''` and `minimumReleaseAge` only act on an install that happens after `init --apply`
wrote them (11.2), and a lockfile can only exist after the first add. A repository another manager
generated is the one case where a step precedes the block: `funky-secure migrate` comes before
`funky-secure init --apply`, because the posture is written once the repository has one package
manager, and `pnpm add` is not printed at all, because adding now would write a second lockfile; the
`pnpm-lock.yaml` a migration produces is the migration's business and not this step's. That fact is
read from the repository presence list the collector already resolved, so the command adds no probe.
The numbering follows the printed steps, so a repository that is missing only the lockfile starts at
`1` rather than at `5`, and one generated by another manager prints `migrate` as `1` and the scan as
`3`. A repository whose steps all apply prints the numbered list; one that has taken all of them
prints one line saying it is past the start and naming `scan`, never a stale checklist.

The list is followed by `why this order` — the reason above, two lines, plus one line when a foreign
lockfile moves `migrate` ahead of the block — and then, when the recommended preset disables rules,
by the same `not run` block the report carries (10.3). That block describes `starter` (9.1), the
preset step 6 runs, and it is produced by the same helper as the report's, so the two cannot disagree
about what the recommended preset leaves unrun.

Exit: `0` in every state, including a repository already past the start; `2` for a usage error only.

### 11.8 `skill`

```
funky-secure skill [--install [--user] [--force | --keep]] [--help]
```

Read-only unless asked to install, and it answers one question — *what does an agent need to know
before it touches this repository* — with the file this package ships rather than with prose it
renders.

**Without `--install`** stdout carries the bytes of `skills/funky-secure/SKILL.md` exactly as
published: no header, no wrapper, no trailing note, so `funky-secure skill > …/SKILL.md` produces that
file itself. stderr carries two lines: that `--install` exists, and the two destinations. Neither line
names an agent product.

**With `--install`** the same bytes are written to `.agents/skills/funky-secure/SKILL.md`, and the
destination is never typed and never accepted as an argument: it is composed from a root and four fixed
segments. Inside a worktree the root is the worktree root, so the file travels with the repository and
is meant to be committed; outside one, or with `--user`, the root is the home directory and the file
applies to every project on the machine. The command reports in the narration voice of 10.3: a symbol, the fact, and the destination on one
line, then one indented line saying whether that copy travels with the repository or with the machine.
The symbols are the report's — `✓` for something done, `–` for nothing to do, `ℹ` for a decision that
changed nothing — and no line repeats the command name as a prefix.

A copy that differs in version or in bytes is a decision only the human can make. With a terminal the
command asks; without one it **refuses** — exit `3`, nothing written — and prints the two words that
settle it, `--force` and `--keep`. It is a refusal and not a failure to answer: the file, the difference
and the version are known, and `2` would tell an integration to retry a question whose answer is a word
(10.4). A newer installed copy is refused under both conditions.

The file carries the version it belongs to in its frontmatter, gated to equal the package version.
**Bytes alone cannot answer the question**, because "different from what I ship" covers three
situations that are three different decisions: an older copy waiting for an upgrade, a copy newer than
this binary, and the same version edited by hand. So the comparison is version first, bytes second:

| Installed file | State | Answer |
|---|---|---|
| absent | — | write, report `installed (version)` |
| byte-identical | — | write nothing, report that it already carries this exact version |
| no version line | `unversioned` | ask: where it came from cannot be told |
| same version, different bytes | `edited` | ask: a human changed it, and replacing discards that |
| older version | `older` | ask: replacing is the upgrade |
| newer version | `newer` | **refused** unless `--force`; installing the newer funky-secure is the other answer |
| `--keep` in any differing state | — | write nothing, report that it kept it |
| `--force` in any differing state | — | replace, report `installed (version)` |
| differing, no flag, stdin is a terminal | — | ask; an explicit overwrite replaces, any other answer keeps |
| differing, no flag, stdin is not a terminal | — | exit `3`: nobody is there to answer, and guessing is not an option |

A downgrade is never routine: this binary has nothing better than what is installed, so taking the
newer copy away requires `--force` and `--keep` is accepted as an answer there too.

With a terminal the question is a numbered menu: each option states what it does, the version it
would install, and the default is `1`, which keeps — a decision that destroys something is never the
answer to an empty line. The answer is read tolerantly (`1`, `k` and `keep` keep; `2`, `o`,
`overwrite`, `replace`, `y` and `yes` replace), and a line the menu
does not offer is asked again up to three times before the file is kept.

The question states that replacing the file discards whatever was changed in it, and it is asked on
stderr because stdout is never used for anything but the file.

`--user`, `--force` and `--keep` are usage errors without `--install`; `--force` with `--keep` is a
usage error. `--install` with a positional argument is a usage error: there is no destination to pass.

It reads nothing about the repository except the worktree root, and only when `--install` needs it. For
the print path no rule runs, no probe is spawned and no fact is collected, and the file is resolved
relative to the installed module rather than from the working directory, so the same bytes are printed
inside a repository, outside one, and from a directory that is not a repository at all.

`--help` prints the help. It exits `0` whenever the file is printed or the outcome is reported, and
`2` for a usage error, for a shipped file that cannot be read — stdout stays empty, because an empty or
partial file would be saved by the very redirect it is meant for — and for a write that failed, in
which case the message names the path and the temporary file is removed rather than left behind.

This section is amended by records 0004 and 0005.


### 11.9 `pin`

```
funky-secure pin [--format human|json] [--apply] [--allow-dirty]
```

The complement of 8.2 R5: it writes the version `pnpm-lock.yaml` already records for each specifier
that floats, so the install resolves to the tree it resolved to when the lockfile was made, without a
human retyping `pnpm pkg set` once per finding. The version comes from the lockfile or is not written:
a floating range with no recorded resolution is listed as not pinned, with the reason, and never
guessed (4.9).

Without `--apply` it prints the plan — the manifest, the count, and the line list of each specifier
with the range it leaves and the version it takes — and exits `0`. With `--apply` it performs exactly
that plan, one write per file, because a plan item carries the whole rewritten manifest: indentation,
key order and line endings survive and only the specifiers change.

Three limits are part of the contract. It writes the repository-root `package.json` only; a workspace
importer is named as not pinned, with its count, because reading another manifest would need a probe
this command alone would use. It never runs an install (11.6), so the plan ends by naming the
`pnpm install --lockfile-only` that re-records the `specifier` field the write desynced on purpose. It
keeps no allowlist: a specifier edited back to a range is reported by the next scan like any other, and
a per-package exception is the user's decision in the diff (8.2 R5). A `catalog:` or `catalog:<name>`
reference is neither floating nor exact: the plan counts it as left alone, with the reason, and never
writes a version over it, because the version belongs to the catalogue the reference names.

It refuses — exit `3`, nothing written — on uncommitted changes to the target, unless `--allow-dirty`
is passed, and it is idempotent: a second `--apply` over the same state performs zero writes, and that
run still reports the manifest as already at policy with the number of specifiers that already are. With
`--format json` stdout carries the plan document and nothing else; the ledger of writes goes to stderr.
