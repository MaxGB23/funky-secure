# Rule catalog

> Normative. Extracted verbatim from RFC 0001 section 8 (revision 7). The record is at
> [`../../rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the code owes. Change this file, not the record.

## 8. Rule catalog v0.1 (the nine)

### 8.1 Rule contract

```js
// src/rules/<id>.js
export default {
  id: 'exact-versions',
  title: 'Dependency specifiers are exact',
  scope: ['repo'],
  targets: ['importer'],
  friction: 2,                        // 0 free, 1 cheap, 2 expensive
  severity: { baseline: 'warn', strict: 'error' },
  docs: 'docs/rules/exact-versions.md',
  detect(ctx) {
    // returns Finding[] — pure, no I/O
  },
};
```

`Finding` is the unit of report (section 10.1). A rule returns zero or more findings, each with
`status: 'pass' | 'fail' | 'skip' | 'error'`. A rule that cannot answer (missing fact, malformed
input) returns `error` for itself and never a false `pass`.

Column meanings in the tables below: **friction** per 4.2, **sev** is `baseline` / `strict`,
**fix** is `auto` (an apply path exists), `manual` (exact command), or `none` (report only).

### 8.2 The nine rules

#### R1 — `package-manager-pin` · friction 0 · sev `error`/`error` · fix `auto`

- **Question:** does `package.json` declare the package manager, and does the declaration match the
  pnpm actually answering?
- **Detection:** `package.json` → `packageManager`. `pass` if it equals `pnpm@<active version>`.
  `fail` if absent. `fail` with `conflict` evidence if present but different (npm, yarn, or another
  pnpm version). If `pnpm --version` fails, `skip` — an unverifiable pin is not a wrong pin.
- **Evidence:** declared value, observed value, path of the answering binary.
- **Remediation:** `corepack use pnpm@<version>` (manual) or `init --apply` (auto write).
- **Why it is free:** one line in a file every Node repository has; it makes the accidental use of
  another manager detectable without blocking anything.
- **False positives:** repositories deliberately on another manager. That is not a false positive; it
  is the finding. The override is `off`, and the report says so.

#### R2 — `lockfile-committed` · friction 0 · sev `error`/`error` · fix `none`

- **Question:** is the lockfile present, tracked, and not ignored?
- **Detection:** `pnpm-lock.yaml` exists at the repo root; `git ls-files --error-unmatch` succeeds;
  `git check-ignore` does not match it. Outside git, only existence is checked and the finding says
  so. A lockfile present but not tracked is the failure mode that produces non-reproducible CI.
- **Remediation:** `git add pnpm-lock.yaml` (manual), and `git add -f pnpm-lock.yaml` when an ignore
  rule also matches the untracked file: a plain `git add` exits 1 with "The following paths are ignored"
  in exactly the state this rule reports most often. Once the file is tracked, a matching ignore rule is
  reported on its own with `git check-ignore -v pnpm-lock.yaml` to find its source.
- **Note:** the rule deliberately does not check the lockfile's `lockfileVersion` against the
  installed pnpm; that check belongs to pnpm itself on install, and duplicating it would create a
  second, staler source of truth (4.1).

#### R3 — `foreign-lockfile` · friction 0 · sev `warn`/`warn` · fix `manual` (`migrate`)

- **Question:** does another package manager still shape this repository?
- **Detection:** `package-lock.json`, `yarn.lock` or `bun.lock`/`bun.lockb` present at the root.
  Severity is `warn` in both presets: the product recommends pnpm, it does not require it (G4).
  Deviates from the guidance of 4.2, where friction 0 would suggest `error`; G4 wins, and the
deviation is recorded here and in section 9.1.
- **Evidence:** the files found; whether `pnpm-lock.yaml` coexists (the dangerous case, because two
  lockfiles resolve two trees).
- **Remediation:** `funky-secure migrate --from npm --apply` prints or executes the plan (section
  11.3). Two lockfiles present raises the message to `error` level wording while keeping its
  severity, because coexistence is the state that produces "works locally, breaks in CI".

#### R4 — `quarantine` · friction 2 · sev `warn`/`error` · fix `auto`

- **Question:** is the release-age quarantine an **actual gate** — a decision a human has to make —
  rather than an automatic approval list that admits whatever it is pointed at?
- **Detection:** read `minimumReleaseAge`, `minimumReleaseAgeStrict` and `minimumReleaseAgeExclude`
  from the **effective** configuration reported by `pnpm config list --json` (this merges global,
  workspace and environment, which is exactly what pnpm will apply). The **effective value** is the
  reported `minimumReleaseAge` when present, else the built-in default of the pinned major — 1440
  minutes on the pnpm 11/12 line, 0 before 11 — reported explicitly as **inherited** (E2, E1). The
  **effective strictness** is the reported `minimumReleaseAgeStrict` when present, else the manager's
  own rule: `true` only when `minimumReleaseAge` was explicitly configured. The rule answers `pass`
  only when the strictness is effective **and** the effective value is at least the preset's floor
  (`policy.quarantineMinutes`, 9.4). Two distinct failure codes:
  `quarantine-not-strict` — auto-approval mode: pnpm admits the package and writes an exclusion into
  `pnpm-workspace.yaml`, even under CI — and `quarantine-below-policy` — a gate, but shorter than the
  preset floor. Both facts are reported together with the `minimumReleaseAgeExclude` count and values,
  because in non-strict mode pnpm itself is growing that list (E1). The report does **not** claim
  where the value came from: the effective listing merges its sources and cannot attribute them (E2),
  and a guessed origin is exactly the kind of stale assertion this RFC exists to remove.
- **Evidence:** effective value, inherited or configured, effective strictness, preset floor,
  `minimumReleaseAgeExclude` entries (count and values).
- **Severity:** `warn` in `baseline`, `error` in `strict`. Declared deviation from 4.2: friction 2
  would be `warn` in both presets, and `strict` promotes it because that is the author's own bar;
  `baseline` only warns on the inherited non-strict default, which keeps the rule adoptable anywhere
  (4.2, K1). The deviation is recorded in section 9.1.
- **Remediation:** `init --apply` writes the managed block W1a of section 11.2 —
  `minimumReleaseAgeStrict: true` — plus `minimumReleaseAge: 4320` as W1b under `--preset strict`.
  Manual equivalents: `pnpm config set minimum-release-age-strict true --location=project` and
  `pnpm config set minimum-release-age 4320 --location=project`; in pnpm 12 both write
  `pnpm-workspace.yaml`, because project config **is** that file (E8), while `--location=global`
  writes the pnpm global `config.yaml`. An `.npmrc` is never involved — a hand-written
  `minimum-release-age` in a project or user `.npmrc` is silently ignored, which is how a repository
  can look hardened and stay unprotected, the defect section 2 describes. The hotfix escape hatch is
  `minimumReleaseAgeExclude`, the list pnpm itself already writes in non-strict mode.
- **Why it is not friction 0:** once the gate exists, an immature dependency is a failed install —
  `ERR_PNPM_NO_MATURE_MATCHING_VERSION` at resolution, or `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`
  when the lockfile check runs (E1). That cost is real and it is the point of the quarantine.

#### R5 — `exact-versions` · friction 2 · sev `warn`/`error` · fix `manual`

- **Question:** are dependency specifiers exact, and does the lockfile agree?
- **Detection:** for every `dependencies`, `devDependencies`, `optionalDependencies`,
  `peerDependencies` entry of every importer: a specifier is floating when it starts with `^`, `~`,
  `>`, `<`, `*`, or equals `latest`, or contains `x`/`X`, or is a git/tarball URL. Exact means a
  literal version, `npm:<pkg>@<version>`, or `workspace:*` for internal packages. Additionally,
  compare the specifier with the resolved specifier in `pnpm-lock.yaml` for the same importer and
  dependency; a disagreement is a separate finding with `code: "lockfile-desync"` (10.1).
- **Lockfile reader scope (v0.1).** The comparison uses `src/lib/lockfile.js`, a bounded indent reader
  that needs no YAML dependency (4.7) and understands only `lockfileVersion`,
  `importers.<path>.specifiers` and
  `importers.<path>.{dependencies,devDependencies,optionalDependencies,peerDependencies}`. The
  recorded version is the bare version: pnpm appends a peer suffix (`9.39.5(jiti@2.7.0)`) that names the
  snapshot, not the version, so everything from the first `(` is dropped before the value is used as a
  remedy or compared with a specifier (0014). Anything
  outside that subset — `catalogs`, `overrides`, `patchedDependencies`, a `snapshots` layout it does
  not recognize — makes the comparison return `skip: unsupported-lockfile-shape`, never a guessed
  finding. One fixture per supported `lockfileVersion` (currently `9.0`) proves the reader, and a
  future major that moves the shape degrades to `skip`.
  Ignored top-level sections — `packages`, `settings`, `snapshots`, `time` — are checked at their
  first level only: the section must be a map, and nothing inside it is read. A list as the value of
  a key inside one of them is legal and cannot affect a specifier: `bundledDependencies` in every
  `@next/swc-wasm-*` entry, `transitivePeerDependencies` in vitest's snapshot entries. Refusing those
  made the comparison a `skip` on the common lockfile, not on an exotic one (0012).
- **Severity:** `warn` in `baseline`, `error` in `strict` — the user's decision (Appendix A). A
  repository can also split it: `"exact-versions": { "dependencies": "error", "devDependencies": "warn" }`
  is **not** supported in v0.1; it is a v2 extension.
- **Remediation:** `pnpm pkg set '<section>["<name>"]=<resolved version>' && pnpm install`, written one
  command per finding, with the version the lockfile records (S4). The property path is **bracketed**:
  `pnpm pkg set 'devDependencies.@types/node=1'` fails on pnpm 12.3.4 with
  `ERR_PNPM_PKG_INVALID_PROPERTY_PATH`, because a dot path cannot carry an `@`, and scoped names are
  most of a modern dependency set; the bracket form works unchanged for an unscoped name. `pnpm add
  --save-exact <pkg>@<version>` is not the remediation: it exits 0 and keeps the declared range on
  pnpm 12.3.4 (measured, I-20). The configuration surface is `pnpm config set save-exact true
  --location=project`, which writes `saveExact: true` into `pnpm-workspace.yaml` — project config in
  pnpm 12 — and not into a project `.npmrc`, which pnpm ignores for this class of setting (E8), and
  it governs only the packages added after it. No auto fix in v0.1: rewriting a `package.json` range
  without re-resolving is how you desync a lockfile.
- **Evidence:** `file:line` of each specifier, the range, the resolved version.

#### R6 — `env-not-tracked` · friction 0 · sev `error`/`error` · fix `none`

- **Question:** is any environment file committed?
- **Detection:** `git ls-files -z -- ':(glob)**/.env*'`; exclude template names (`.env.example`,
  `.env.sample`, `.env.template`, `.env.dist`, `.env.test.example`). The `:(glob)` magic is required:
  without it a root `.env` is not matched at all (E4). The pattern also matches `.env.example`, so the
  template exclusion list is mandatory, not a convenience. Outside git, `skip`.
- **Evidence:** each tracked path. **No content is read**, and no value is printed (N5).
- **Remediation:** `git rm --cached <path>` (manual) plus a rotation note in the message: removing a
  file from the index does not remove it from history, so the credentials must be rotated. That
  sentence is the whole value of the rule and it is not optional.
- **Relation to R7:** R6 is about git tracking, R7 is about ignore coverage. Both exist because
  "ignored but committed once" and "not committed yet but unignored" are different accidents.

#### R7 — `sensitive-ignored` · friction 0 · sev `error`/`error` · fix `auto`

- **Question:** would this repository ignore the files that must never be committed?
- **Detection:** behavioral, not textual. Feed candidate paths to
  `git check-ignore --no-index --stdin -z` and require a match for: `.env`, `.env.local`,
  `.env.production`, `secrets.pem`, `server.key`, `.npmrc`. Textual presence in `.gitignore` is not
  enough, because a later negation (`!.env`) or a nested ignore file changes the truth. The probe is
  invoked **without `-v`**: with `-v` a negated path returns exit `0` and prints the negation
  pattern, which inverts the verdict (E3). The verdict is the **per-path presence** of that path in
  the output; the exit code (`0`/`1`) is an aggregate over the batch and is never read as one path's
  answer. Additionally report tracked instances of `*.pem`, `*.key` and a root `.npmrc` containing a
  literal `_authToken=` (presence only, value redacted).
- **Remediation:** `init --apply` appends a managed block (section 11.2) with the missing entries.
  Manual alternative: the exact lines to add are printed.
- **Scope note:** the rule does not demand that `.npmrc` be ignored when the project legitimately
  commits one without tokens; the token check is separate evidence and drives the severity of that
  instance only.

#### R8 — `actions-pinned-sha` · friction 1 · sev `error`/`error` · fix `manual`

- **Question:** can a CI workflow change under you without a commit?
- **Detection:** stated against the structural workflow reader of section 14 (`src/lib/workflows.js`),
  never against a line scan for `uses:`. A `- uses:`-anchored line scan finds none of the real steps,
  and a loose `uses:` scan takes false positives from block scalars, folded `>-` values and `with:`
  map keys while missing flow-style step maps (E6). The reader maps `jobs:` → job → `steps:` → step
  and must handle: single-line and multi-line step maps (`- name: x`, and `-` alone followed by an
  indented map), flow-style maps (`- { name: …, uses: … }`), quoted `uses:` values, trailing
  `# vX.Y.Z` comments (preserved as evidence, never trusted), `with:` maps, block scalars (`run: |`,
  `run: >-`) whose bodies are not steps, `docker://image:tag` versus `docker://image@sha256:...`, and
  local `./path` actions. Accept `owner/repo@<40 hex>`. Flag `@v1`/`@main`/`@<7 hex>`. Treat
  `docker://image:tag` as a finding and `docker://image@sha256:...` as a pass. A file the reader cannot
  parse yields `skip: unparseable-workflow` for that file.
- **Remediation:** manual, printed concretely from what the finding already knows — the action and the
  ref that moves — as `uses: <action>@<sha> # <ref>` (`uses: actions/checkout@<sha> # v4.1.7`), or
  `uses: docker://<image>@sha256:<64 hex> # <tag>` for a container tag. A generic `owner/repo`
  placeholder makes the reader retype both facts, and `<sha>` alone does not say what precedes the
  `@`. The tool still does not resolve the SHA, because that is a network call (4.9); the rule doc
  explains how to (`gh api repos/owner/repo/git/refs/tags/v4.1.7`).
- **Evidence:** `file:line`, the raw reference, the offending form.

#### R9 — `no-bot-auto-merge` · friction 0 · sev `error`/`error` · fix `none`

- **Question:** can a dependency update reach the default branch without a human reading it?
- **Detection:** two independent signals.
  1. **Configuration:** `.github/dependabot.yml` or `.github/renovate.json` present → `info`
     finding: automated updates exist and must be reviewed manually; v0.1 does not judge the tool,
     only the merge path.
  2. **Merge path:** a minimal workflow reader (`src/lib/workflows.js`, section 14) maps each job to
     its `if:`/`name:` and to its steps, so a step can be attributed to the job that runs it. Flag
     `gh pr merge` with `--auto` or `--merge`, and any `uses:` of a known automerge action, in a job
     whose condition names `dependabot[bot]`/`renovate[bot]`. Flag `pull_request_target` in a job that
     also checks out the PR head (`github.event.pull_request.head.sha` or `refs/pull/`), because that
     combination hands repository secrets to untrusted code. A workflow the reader cannot parse
     (anchors, includes, unexpected nesting) yields `skip: unparseable-workflow` for that file: the
     rule never guesses from a line scan.
- **Reader scope note:** this is the structural read that section 8.3 has in mind. The reader ships in
  v0.1 because R8 and R9 both need it; the deferred workflow rules reuse it instead of growing a
  second parser.
- **Remediation:** none automatic. The message states the rule: an update is merged by a person
  after reading the diff and running the gate.
- **Why it is free:** it costs nothing to not automate a merge, and it removes the only path by
  which a compromised upstream reaches `main` with no human in it. This is the encoded form of the
  author's position that "you can never know whether it is safe without auditing" (Appendix A).

### 8.3 Deferred catalog (nine rules, three of them in 0.2)

Not in v0.1. The table keeps the order of expected value; revision 4 changes which of them ship
first, for the reason given under it:

| id | Question | Why deferred |
|---|---|---|
| `ci-no-safety-overrides` | does CI disable the frozen lockfile or re-enable lifecycle scripts? | pnpm already freezes in CI (4.1); only explicit overrides are interesting, and they are rare |
| `workflow-permissions` | does each workflow declare least-privilege `permissions:`? | needs the shared workflow reader (v0.1) plus a per-job permission matrix, which is the v2 work |
| `pull-request-target` | does a workflow combine `pull_request_target` with PR-head checkout outside automerge? | today folded into R9's evidence; deserves its own message |
| `editor-hooks` | do `.vscode/tasks.json` / `.claude/settings.json` execute anything? | stateless audit, no baseline: list what runs, let the human judge |
| `hook-drift` | did those hooks change since the last approved state? | genuinely needs state; the design must work on a fresh clone before it ships |
| `lifecycle-scripts` | which dependencies have build scripts and what is their approval state? | pnpm's `approve-builds` owns the flow; report-only, and it needs a lockfile reader |
| `trust-policy` | is `trustPolicy: no-downgrade` set? | a free key, but it is a seed, and seeds are what caused 2.2 |
| `block-exotic-subdeps` | are transitive git/tarball dependencies blocked? | same reasoning as `trust-policy` |
| `quarantine-exclusions` | are `minimumReleaseAgeExclude` entries justified and tracked? | needs a decision on where an exemption is recorded |

**0.2 scope (revision 4).** Three of the nine ship first, and not the three F5 of revision 3 named.
The v0.1 workflow reader built for R8/R9 already answers what any workflow rule needs, so the
cheapest real value is the rules that reuse it:

1. `ci-no-safety-overrides` — E5 already measured the behavior it inspects.
2. `pull-request-target` — today folded into R9's evidence; it gets its own message and its own
   severity, and it names the combination a fork-based compromise needs.
3. `workflow-permissions` — the shared reader plus a per-job permission map.

`editor-hooks`, `lifecycle-scripts`, `trust-policy`, `block-exotic-subdeps` and
`quarantine-exclusions` keep their place in this table and stay out of 0.2: each needs a reader or a
decision that does not exist yet.

**`hook-drift` is out of 0.2, deliberately.** It is the only rule whose blocker is design: a drift
baseline has to survive a fresh clone, which means committed state, and no decision admits committed
state (4.4). Shipping it half-useful — a baseline that exists only on the machine that created it —
would reproduce exactly the defect section 2.6 documents in the old design. It returns when a
decision admits a committed, reviewable baseline, and not before.

### 8.4 Why exactly nine

The count is a product constraint, not an accident. Nine rules fit one screen of output on a real
repository, one page of documentation, one test file each, and one release note. Every additional
rule adds a way for the tool to be wrong in public. Nine is also the number that satisfied both
constraints at once: **every rule the author asked for by name** (pnpm recommendation and migration,
the age quarantine, no floating ranges, no automatic dependency merges, Actions pinned by SHA,
sensitive files ignored) **plus the three that make the report trustworthy** (pin, lockfile, exit
codes).

The resolution of the count, recorded explicitly because the approved list named `lockfile-*`
ambiguously:

- `lockfile-*` resolves to **two** rules: `lockfile-committed` (R2) and `foreign-lockfile` (R3).
- `install-frozen` became `ci-no-safety-overrides` and moved to v2, because pnpm freezes by default
  in CI and a rule that fires on `pnpm install` would violate 4.1.
- `hook-drift` moved to v2, because it is the only rule that needs state, and v0.1 is stateless by
  design (4.4).

**And in 0.2 the count still binds.** Nine was a v0.1 budget; 0.2 raises it to twelve, and the budget
that matters is per release, not per catalog: twelve rules must still fit one screen of output on a
real repository, one page of documentation, one test file each and one release note. The three that
ship first were chosen by that test — each reuses a reader that already exists, so none of them adds
a new way for the tool to be wrong in public.

---
