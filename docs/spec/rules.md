# Rule catalog

> Normative. Extracted verbatim from RFC 0001 section 8 (revision 7). The record is at
> [`../../rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the code owes. Change this file, not the record.

## 8. Rule catalog (the twelve)

> §8.2 and §8.3 are amended by [record 0024](../../rfcs/0024-the-contract-says-what-it-does/rfc.md): the
> three rules the record deferred ship, and they are R10, R11 and R12 beside R1–R9 rather than a
> renumbering, because `8.2 R5` is a citation in code, tests, commits and the decision log.

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

### 8.2 The twelve rules

#### R1 — `package-manager-pin` · friction 0 · sev `error`/`error` · fix `auto`

- **Question:** does `package.json` declare the package manager, and is that declaration the one pnpm
  honours?
- **Detection:** `package.json` → `packageManager`. A declaration naming a versioned pnpm is the
  authority and `pass`es: pnpm re-executes itself to honour it, so inside the project the answering
  version is the declared one, and the version answering on the machine's `PATH` rides along as
  evidence rather than as a verdict (0024). `fail` with `pin-missing` if absent. `skip` with
  `not-pnpm` when the declaration names another manager, because the pnpm question does not apply to
  it. `fail` with `pin-conflict` for a pnpm declaration this rule cannot compare. If `pnpm --version`
  fails, `skip` — an unverifiable pin is not a wrong pin.
- **Evidence:** declared value, observed value, path of the answering binary.
- **Remediation:** `init --apply` writes `packageManager` when it is missing (auto), and only then; a
  declaration that already exists is never rewritten, whatever the machine runs.
- **Why it is free:** one line in a file every Node repository has; it makes the accidental use of
  another manager detectable without blocking anything.
- **False positives:** a repository deliberately on another manager is a `skip`, not a finding: the
  rules that need a pnpm repository report the consequence, and a remediation that replaces a
  deliberate manager would be worse than the defect it came from (0020, 0024).


A pin the project manages itself (`devEngines.packageManager`, which pnpm 12 writes on `pnpm init`)
that differs from the answering binary is `skip` with `self-managed-pin`: the probe runs outside the
repository (7.3, 0019), and the pnpm that answers there describes the machine, not that project (0020).
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
  `minimumReleaseAgeStrict: true` — and W1b, the age itself, in the same block: `minimumReleaseAge: 1440`
  under `baseline` and `4320` under `--preset strict`. The age is always written, never inherited: pnpm's
  built-in default is `1440` from the 11 line on and `0` before it, so a block that declares only the
  strict flag claims a gate that an older major enforces nowhere, and no repository could state its own
  number (0017).
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
- **Lockfile reader scope.** The comparison uses `src/lib/lockfile.js`, a bounded indent reader
  that needs no YAML dependency (4.7) and understands `lockfileVersion` (the `9.0` shape and the `6.0`
  root shape, whose top-level dependency sections become importer `.`), `importers.<path>.specifiers`,
  `importers.<path>.{dependencies,devDependencies,optionalDependencies,peerDependencies}`, and the
  top-level `catalogs` and `overrides` maps (0025). A `catalog:` or `catalog:<name>` specifier is
  resolved through the catalogue before it is judged: an entry that records an exact version is exact,
  and a catalogue range is reported at `pnpm-workspace.yaml`, the file that holds it, because the
  manifest line that refers to the catalogue cannot be made exact. A desync is reported only for the
  same dependency kind in the same importer, never for a peer absence (importer blocks record no
  peers), never for a name the lockfile records under another section, and never for a specifier an
  override rewrote. The
  recorded version is the bare version: pnpm appends a peer suffix (`9.39.5(jiti@2.7.0)`) that names the
  snapshot, not the version, so everything from the first `(` is dropped before the value is used as a
  remedy or compared with a specifier (0014). Anything
  outside that subset — `patchedDependencies`, a second record of the root importer, a `snapshots`
  layout it does not recognize — makes the comparison return `skip: unsupported-lockfile-shape`, never a
  guessed finding. One fixture per supported `lockfileVersion` (`6.0` and `9.0`) proves the reader, and
  a future major that moves the shape degrades to `skip`.
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
- **Detection:** every path in the complete tracked set whose basename starts with `.env`, at any
  depth, excluding the template family: any name ending in `.example` (`.env.example`,
  `.env.local.example`, `.env.production.example`) plus `.env.sample`, `.env.template` and
  `.env.dist`. A template is a file meant to be copied, not a credential, so its name is not one of
  two enumerated spellings but a family (0024, S1.3). The `:(glob)` magic the record names is what a
  pathspec probe would need — without it a root `.env` is not matched at all (E4) — and the
  collector's complete tracked list makes the pathspec unnecessary: the pattern also matches
  `.env.example`, so the template exclusion is mandatory, not a convenience. Outside git, `skip`.
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
  indented map), **a sequence written at its key's own indentation** (the *indentless* form: `steps:`
  followed by `- uses:` at the same column, which is valid YAML and the shape GitHub's own templates
  write — 0024, S1.1), flow-style maps (`- { name: …, uses: … }`), quoted `uses:` values, trailing
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
  explains how to (`git ls-remote`, keeping the tag as the comment — 0021, 0024).
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
  second parser. It reads a sequence at its key's own indentation as well as indented under it, so a
  workflow GitHub's own templates produced is read and not skipped (0024, S1.1).
- **Remediation:** none automatic. The message states the rule: an update is merged by a person
  after reading the diff and running the gate.
- **Why it is free:** it costs nothing to not automate a merge, and it removes the only path by
  which a compromised upstream reaches `main` with no human in it. This is the encoded form of the
  author's position that "you can never know whether it is safe without auditing" (Appendix A).

#### R10 — `ci-no-safety-overrides` · friction 1 · sev `warn`/`error` · fix `manual`

- **Question:** does CI disable the frozen lockfile, or re-enable lifecycle scripts?
- **Detection:** every workflow step the structural reader of section 14 attributes, plus the root
  `.npmrc`. A run word `--no-frozen-lockfile` or `--frozen-lockfile=false` is
  `ci-frozen-lockfile-disabled`; a run word `--ignore-scripts=false` or `--enable-pre-post-scripts` is
  `ci-lifecycle-scripts-enabled`. The `.npmrc` keys `frozen-lockfile=false`, `ignore-scripts=false`
  and `enable-pre-post-scripts=true` are the same two findings, at the 1-based line of the key. A
  quoted word and a comment are not a command. No override is one pass (`ci-safety-defaults`); no
  workflow and no `.npmrc` skips (`no-ci`), and an unparseable workflow skips
  (`unparseable-workflow`) without a pass on top of it.
- **Evidence:** for a workflow, the job, the step index, the offending word and the command line that
  carries it, at the step line; for `.npmrc`, the key and its value, at the 1-based line of the key.
- **Severity:** `warn` in `baseline`, `error` in `strict`. Friction 1 starts at `warn` in `baseline`
  (9.1), and the rule deviates from it in neither direction: removing a flag is one edit, and the
  finding names an explicit override of pnpm's own CI default rather than a preference, so a
  repository that never overrides the default is never touched.
- **Remediation:** manual, printed as the step or the removal to perform — `run: pnpm install
  --frozen-lockfile` or `run: pnpm install --ignore-scripts` for a workflow, deleting the key from
  `.npmrc` for the configuration. The tool never edits a workflow and never rewrites `.npmrc`.
- **Limits:** proves that no declared step and no root `.npmrc` key names the override. It does not
  prove the install was frozen, because an inherited environment, a global config, a composite action
  or a script the step calls can still pass the same flag. A word is classified by its own text, not
  by resolving it: whether the command is an install is not decided here. A workflow the reader cannot
  attribute is skipped per file; the rule never guesses from a line scan.

#### R11 — `pull-request-target` · friction 1 · sev `error`/`error` · fix `manual`

- **Question:** does a workflow combine the `pull_request_target` trigger with a checkout of the pull
  request head?
- **Detection:** every workflow through the structural reader. The trigger is read only from the
  top-level `on:` key — as a value, a flow collection or a block key — so a token in a `run:` body, a
  comment or a job `if:` is not a declaration. In a workflow that declares `pull_request_target`, each
  step is checked for a checkout of the head: an `actions/checkout` step whose `with.ref` is
  `github.event.pull_request.head.sha`, `github.event.pull_request.head.ref` or `github.head_ref`
  (`pull-request-target-checkout`), or a `run:` command that checks one of them out with
  `git checkout` or `gh pr checkout`. Each offending step is one failure at the step line. The
  trigger without a head checkout is one pass (`pull-request-target-without-head-checkout`); a
  workflow set that never declares the trigger is one pass (`no-pull-request-target`); no workflow at
  all skips (`no-ci`) and an unparseable workflow skips (`unparseable-workflow`), without a pass on
  top.
- **Evidence:** the job, the step index, the kind (`uses` or `run`) and the raw expression that checks
  the head out, at the step line. A `run:` step reports the command that carries the expression.
- **Severity:** `error` in `baseline` and in `strict`, a declared deviation from 9.1, where friction 1
  starts at `warn` in `baseline`: the finding fires only on the combination of the trigger and a head
  checkout, removing either half is one edit, and no repository that never writes
  `pull_request_target` is touched — so the friction class of the finding is not the friction of the
  fix, as with R8.
- **Remediation:** manual, printed as the choice to make: remove the `pull_request_target` trigger, or
  remove the step that checks the pull request head out, so the workflow never runs fork code with
  this repository's secrets. The tool never edits a workflow.
- **Limits:** proves that a declared workflow event and a declared step name the combination. It does
  not read whether the job has secrets, does not evaluate `permissions:`, does not resolve the
  expression — whether that ref is the fork head at run time is not decided here — and does not decide
  whether the checked-out code is built or executed. A workflow the reader cannot attribute is skipped
  per file; the rule never guesses from a line scan.

#### R12 — `workflow-permissions` · friction 1 · sev `warn`/`error` · fix `manual`

- **Question:** does each workflow declare least-privilege `permissions:`?
- **Detection:** every workflow through the structural reader, which models `permissions:` at the
  workflow level and in each job. A declaration is read as a form — `write-all`, `read-all`, `none`
  for `{}`, or a map of scopes — with the 1-based line it was declared on; a `permissions:` value the
  reader cannot attribute makes the workflow unparseable, never a guess. A workflow with no
  workflow-level declaration and at least one job that declares none either is
  `workflow-permissions-missing` at the default, and each job it names inherits the repository
  setting. A workflow-level or job-level `write-all` is `workflow-permissions-write-all` at the line
  of the declaration that grants it, and a workflow-level `write-all` is reported even when a job
  narrows it. `read-all`, `{}` and a map of scopes are least privilege: no failure is one pass
  (`least-privilege-permissions`). No workflow at all skips (`no-ci`), an unparseable workflow skips
  (`unparseable-workflow`) without a pass on top, and no repository facts skip (`no-repo`).
- **Evidence:** `level` (`workflow` or `job`) at the line of the declaration that grants `write-all`;
  a missing declaration reports the job ids that inherit the repository setting. A job-level finding
  also carries the job id and is reported at the line of that job's `permissions:` declaration, since
  that key is what the fix replaces.
- **Severity:** `warn` in `baseline`, `error` in `strict` — the 9.1 severity for friction 1, without
  the `error`/`error` deviation of R10 and R11, because the weakest finding is about a fact the tool
  cannot read: GitHub's default for `GITHUB_TOKEN` is a repository setting, not a file, so a job that
  inherits it without declaring anything is not knowable as a deviation offline and `baseline` cannot
  call it an error. `strict` can, because there the declaration is required.
- **Remediation:** manual, printed as the declaration to write: add a top-level `permissions:` with
  `contents: read` and widen it only in the job that needs it, or replace `write-all` with the exact
  scopes. The tool never edits a workflow.
- **Limits:** proves what the workflow declares, never the token a job receives. The declaration is
  not the effective grant: a repository setting decides the default for a workflow that declares none,
  a reusable workflow the job calls brings its own permissions, and an environment can narrow or widen
  what a job gets. Nor does it judge whether the scopes a job does declare are the narrowest possible
  for what that job runs — a workflow that declares `contents: write` everywhere, needed or not, is
  reported as a pass.

### 8.3 Deferred catalog (six rules, none of them in 0.2)

The three workflow rules this section used to defer against the 0.2 line **have shipped**: the frozen
record's own _0.2 scope_ clause admitted `ci-no-safety-overrides`, `pull-request-target` and
`workflow-permissions`, `odd/tasks/funky-secure-v0.2.md` built them as T4, T5 and T6, and `0.2.0`
closed with them in the catalogue, where they are R10, R11 and R12 of §8.2. Their specification is the
code's own `detection` string plus the page a user reads, `docs/rules/<id>.md`, because that is where a
reader already is; §8.2 states the obligation those two must agree with (0024).

What is still deferred, in the order of expected value:

| id | Question | Why deferred |
|---|---|---|
| `editor-hooks` | do `.vscode/tasks.json` / `.claude/settings.json` execute anything? | stateless audit, no baseline: list what runs, let the human judge |
| `hook-drift` | did those hooks change since the last approved state? | genuinely needs state; the design must work on a fresh clone before it ships |
| `lifecycle-scripts` | which dependencies have build scripts and what is their approval state? | pnpm's `approve-builds` owns the flow; report-only, and it needs a lockfile reader |
| `trust-policy` | is `trustPolicy: no-downgrade` set? | a free key, but it is a seed, and seeds are what caused 2.2 |
| `block-exotic-subdeps` | are transitive git/tarball dependencies blocked? | same reasoning as `trust-policy` |
| `quarantine-exclusions` | are `minimumReleaseAgeExclude` entries justified and tracked? | needs a decision on where an exemption is recorded |

**`hook-drift` is out of every release until a decision admits it.** It is the one deferred rule whose
blocker is design, not implementation: a drift baseline has to survive a fresh clone, which means
committed state, and no decision admits committed state (4.4). Shipping it half-useful — a baseline
that exists only on the machine that created it — would reproduce exactly the defect section 2.6
documents in the old design. It returns when a decision admits a committed, reviewable baseline, and
not before.

A rule that leaves this table moves into §8.2 with the next free number; numbering in the catalog is
append-only, so a citation like `8.2 R5` never changes what it names (0024).

### 8.4 Why nine, and then twelve

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

**And in 0.2 the count still binds.** Nine was a v0.1 budget; 0.2 raised it to twelve, and the budget
that matters is per release, not per catalog: twelve rules must still fit one screen of output on a
real repository, one page of documentation, one test file each and one release note. The three that
shipped first were chosen by that test — each reuses a reader that already exists, so none of them adds
a new way for the tool to be wrong in public. The catalogue is twelve today, and
`tests/docs-contract.test.js` counts this file's `#### R` sections against the catalog the code
exports, so a thirteenth rule cannot arrive without a section here (0024).

---
