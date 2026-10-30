# Field round 4 — real repositories

| | |
|---|---|
| **Started** | at `0.8.8`, `main` `ed80a03` |
| **Method** | five `funky-lakra` sessions, one repository each, `--depth 1`, nothing from the clone executed, `init`/`start` only on copies, `git status` before and after every scan |
| **Reported so far** | `yarnpkg/berry`, `t3-oss/create-t3-app`, `vercel/nextjs-subscription-payments`, `primefaces/primevue` (the `catalogs` case), `shadcn-ui/ui` (scale) |
| **Still running** | the documentation audit, and two workers fixing S1.1 and S1.3 |

Every finding below was triaged: reproduced, or checked against the code, before it entered this file. A report is a hypothesis.

## Severity 1 — a real repository is silently unchecked, or a correct repository is told it is broken

### S1.1 — an indentless YAML sequence makes five CI rules blind

**Reproduced.** `steps:` followed by `- uses:` at the *same* indentation is valid YAML (the "indentless sequence") and it is what GitHub's own templates write. The parser refuses it:

```
skipped: unparseable workflow — sequence item at line 14 where job "debug" expects a key
```

Byte-identical content indented two spaces deeper parses normally. On `yarnpkg/berry` this is **35 of 35 workflows**: `actions-pinned-sha`, `no-bot-auto-merge`, `ci-no-safety-overrides`, `pull-request-target` and `workflow-permissions` produce zero signal (175 checks), and the verdict still printed `PASS`. The previous field round reported "6 of 6 CI rules detect, zero false positives" — those six workflows were written by the agent, in the deep-indent shape only.

Where: `src/lib/workflows.js`, `entryEnd` (the body of a key stops at `indent <= key indent`, so a sequence item at the key's own indent is not seen as its body) and then the step reader, which expects the dash's children two columns deeper.

Attempted fix: `entryEnd` accepting a same-indent dash as the body. It changes the failure from "sequence item where job expects a key" to "unexpected indentation at line N in the steps of X" — the step reader needs the same treatment. Reverted; the tree is clean.

### S1.2 — `lockfileVersion 6.0` is not read, so `pin` cannot pin and says why wrongly

**Reported with evidence.** `vercel/nextjs-subscription-payments` carries `pnpm-lock.yaml` `lockfileVersion: '6.0'` (pnpm 8 shape: top-level `dependencies:` with `specifier:`/`version:` per entry, no `importers:`). Every one of its 26 floating ranges comes back as:

```
@radix-ui/react-toast (dependencies) floats and the lockfile records no version, so it is not pinned
```

The lockfile *does* record every one of them. The real cause is `exact-versions: unsupported-lockfile-shape`, which the human report never prints (it is one of the skip reasons that never reach the body, and `--verbose` does not print it either). `start` step 1 is `funky-secure pin --apply`, which then writes nothing and exits 0, so the canonical path cannot clear the 26 ranges on any pnpm-8 repository.

Not yet fixed. This is the shape of a very large share of pnpm repositories in the world.

### S1.3 — a tracked `.env.local.example` is reported as leaked credentials

**Reported with evidence.** `vercel/nextjs-subscription-payments` tracks `.env.example` and `.env.local.example`, both templates with empty or public values; its `README.md:153` tells the reader to copy the second one. The tool reports:

```
✖  Environment files  ·  .env.local.example
   .env.local.example is tracked by git; removing it from the index (git rm --cached …) does not
   remove it from history, so the credentials it contains must be rotated
```

The exception list covers `.env.example` and `.env.test.example` but not `.env.*.example`. After `init --apply` this stays as the only error and `init` cannot clear it, so `baseline` fails forever on a correct repository, and the offered command breaks the onboarding the README describes.

Not yet fixed. The list should cover `.env*.example` generally, not two spellings of it.

### S1.4 — `catalogs` refuses a comparison it could make, and blames the wrong file

**Measured.** `primefaces/primevue` (a real pnpm workspace, `lockfileVersion '9.0'`, `catalog:` and
`catalogs:` in `pnpm-workspace.yaml`) is refused with `unsupported-lockfile-shape` because of the
top-level `catalogs:` section of the lockfile.

The agent removed only that section from a copy and ran our own reader over the result: **12 importers,
`supported: true`**, and a full comparison of 101 specifiers across those importers gives **0 desyncs**.
So the desync half of the rule needs nothing from `catalogs` — only the exactness half does, and that is
a two-level map lookup over a shape the reader already parses. The refusal is too conservative.

Worse, the rule still emits 34 `catalog:` findings, and:

- **13 are false positives**: the catalog pins the version exactly (`chart.js: catalog:app` → `3.3.2`),
  but `isFloating()` treats the scheme as a floating range.
- **21 name the wrong file**: the float lives in `pnpm-workspace.yaml`, not in the `package.json` line the
  finding prints, and that line cannot be made exact.
- The remediation printed on all 81 floating findings (`pnpm install --lockfile-only && funky-secure
  scan --only exact-versions`) cannot succeed while the lockfile stays refused: it re-prints itself.

Together with S1.2 this makes `exact-versions` the most fragile rule in the tool: two of four real
repositories could not be checked at all, and one printed 13 false positives while being unable to run.

## Severity 2 (continued)

### S2.9 — the block we write ignores the template family the rule now accepts (S1.3 is fixed; this is the remainder)

**Found while fixing S1.3.** `src/lib/writers.js` writes this managed block:

```
.env
.env.*
!.env.example
!.env.test.example
```

`.env.local.example` matches `.env.*` and does not match either negation, so after `init --apply` in an
otherwise ordinary repository that template is **ignored by git** — a new `.env.production.example`
could not be added at all. Measured with `git check-ignore --no-index`.

The rule and the write path now disagree: `env-not-tracked` accepts the whole `.env*.example` family and
the ignore block covers two spellings of it. The fix is `!.env*.example`, and it is a **normative**
change: W2 in `docs/spec/commands.md` and R7 in `docs/spec/scope.md` name the two negated spellings, and
`docs/spec/rules.md` R6 plus `docs/decisions.md` I-5 enumerate five template names. `docs/spec/` is a
verbatim slice of the frozen record, so the change needs a declared amendment row, not a silent edit —
the drift test refuses it otherwise.

### S1.5 — our own 0019 fix made a correctly pinned repository fail

**Measured, with the mechanism.** `shadcn-ui/ui` declares `"packageManager": "pnpm@10.33.4"`. Inside the
clone, `pnpm --version` answers **10.33.4**: pnpm 12 re-executes itself to honour the declared pin. But
the probe runs with `cwd: tmpdir()` — the change 0019 made so a version probe could never rewrite a
lockfile — so it answers **12.3.4**, the machine default, and the rule emits an **error**:

```
package.json declares pnpm@10.33.4, but the pnpm answering is pnpm@12.3.4
→ corepack use pnpm@12.3.4
```

Two consequences. The finding is false: the repository is correct and pnpm honours it. And the
remediation rewrites a correct pin to whatever the auditor's laptop runs — on **any** machine whose
default pnpm differs, which is most machines.

The report is also internally inconsistent for the same reason: the `MACHINE` block says `pnpm 12.3.4`
while `provenance.quarantine` says `declared in pnpm-workspace.yaml`, read by the in-repo
`pnpm config list`.

This is 0020's lesson one step further out. 0020 said an unverifiable pin is not a wrong pin, and
treated `devEngines.packageManager` as the self-managed signal. The real signal is broader: **when the
repository declares `packageManager`, the repository is the authority and the machine's default is not
evidence about it.** The comparison belongs to a machine fact, not to a repository violation.

### S1.6 — the `overrides` skip hides a comparator that is wrong 7 times in 8

**Measured by promoting a copy.** On the same repository the `overrides` section refuses the lockfile,
so **0 of 245 specifiers** across 7 importers are compared while the report counts 206 floating ranges
as verified. On a copy with `overrides` and `packageExtensionsChecksum` removed, the comparison runs and
produces 8 desyncs, **7 of which are false**:

- pnpm 9 never records `peerDependencies` in importer blocks, so a peer spec is compared against the
  *devDependency* record of the same name (`@tanstack/ai` `>=0.40.0 <0.41.0` vs `0.40.0`).
- A specifier rewritten by an override (`@types/react`) disagrees with the manifest by construction.

So the refusal is, today, the only thing keeping the desync comparison from lying. Lifting it without
fixing the comparator would be worse than the skip. Order matters: fix the comparator, then lift.

The same agent found the peer limitation documented as a *limits* note in `docs/rules/exact-versions.md`
("a lockfile that does not record a peer dependency reports a desync") — which is the wrong place for
it: it is not a limit of the rule, it is the rule being wrong about a format.

## What scale looked like

6411 tracked files, 80 MB checkout: **0.38 s** and **79 MB peak RSS**, three runs, deterministic finding
set (same rule/status/path/line/code across runs). The bar was 60 s and 1 GB. Scale is not a problem,
and the report is reproducible byte for byte.

### S2.8 — the pin rule recommends moving a deliberate pin onto the auditor's laptop

Seen in **three** of the four repositories (`create-t3-app` `pnpm@10.8.0`, `primevue` `pnpm@9.6.0`, and a
variant in berry): under `--scope all` the rule compares the repository's declared `packageManager` with
the pnpm answering on the machine, then prints

```
→ corepack use pnpm@12.3.4
```

The fact is true and the recommendation is dangerous: following it moves a working repository onto
whatever version the auditor's machine happens to run. This is the same class as 0020 — a remediation
worse than the bug — and it is a *machine* fact presented as a repository statement. Options: report it
as `info` with the two versions and no command; or print a remediation only when the declared pin is
absent or unparseable.

## Severity 2 — the tool says something it cannot support

| # | Finding | Evidence | Next |
|---|---|---|---|
S2.1 | `pnpm pkg set` remediation has no `-C <dir>`: on a workspace it writes into the **root** manifest. 80 of 96 findings on `create-t3-app` | `src/rules/exact-versions.js`, proven on a scratch tree | fix |
S2.2 | `.github/actions/**/action.yml` is never collected: a composite action with unpinned `uses:` is invisible, and six workflows use it | `src/lib/targets.js:252` reads only `.github/workflows` | fix |
S2.3 | `start` promises `pin the 24 ranges this repository already has` when `pin` writes 0 (no readable lockfile) | `src/commands/start.js:152-155` | fix |
S2.4 | `start`'s `why this order` says a lockfile "can only exist after the first add", while its own steps are `pnpm import` and `install --lockfile-only` | `src/commands/start.js:76-79` | fix |
S2.5 | `lockfile-committed` tells a berry repository "installs are not reproducible without pnpm-lock.yaml". Berry pins every resolution **and** checksum; the sentence is false | `src/rules/lockfile-committed.js` | fix the sentence |
S2.6 | `--preset starter` prints `next nothing to do: everything at or above the policy passes` above 26 visible warnings, and it is the last step `start` prints | `vercel/…-copy` | fix |
S2.7 | the skip reason of `exact-versions` reaches neither the body nor `--verbose` while the verdict counts it | `src/lib/render-human.js` `renderSkipped` | fix with S1.2 |

## Severity 3 — friction, not falsehood

- A `packageManager` present and respected is counted as a **conflict** on `create-t3-app` (`2 writes · 1 conflict`, second run `0 writes · 1 conflict` + `nothing to apply`).
- `pin` says "3 workspace importers not pinned" where `pnpm-workspace.yaml` declares two: the third is a lockfile importer (`cli/template/base`) that `scan` never reads. Two commands disagree about which manifests exist.
- `init` on `create-t3-app`: the `next` line says "plan the 1 fix it can make" while the plan holds 2 writes.
- `init --apply` prints `applying the plan below` over a heading that still says `would write`; `pin --apply` prints `applying` over `would not write`.
- `actions-pinned-sha` says "keep the tag as the comment" when the ref is a branch (`@main`), and then renders `# main` as if it were the comment.
- `package-manager-pin` skip under `--scope repo` carries `code: "no-pnpm"`, which in the machine contract means the probe did not answer. It is a scope decision; `quarantine` already uses `machine-out-of-scope`.
- The skip block repeats one label per file: `175 rules not verified: Pinned actions, Pinned actions, … (×35)`.
- `catalog:` from `.yarnrc.yml` is reported as a floating npm range whose printed remediation cannot resolve it.
- `packageManager: "yarn@4.2.1+sha256…"` is compared as a string, so a sha-suffixed pnpm pin would also read as a conflict.
- `summary.pass` counts rows that `findings[]` filters out, with nothing saying they were elided.

## What the round proved about the tool

- **Read-only held on every repository.** No scan, plan, or human render changed a byte: `git status --porcelain` empty before and after, and 90-file hash manifests identical on the Next.js app. The 0019 fix is real at scale.
- **`init --apply` is idempotent on a real workspace.** `create-t3-app`: block appended after `onlyBuiltDependencies:`, `packages: [cli, www]` untouched, file parses with `yaml@2.9.0`, second apply `nothing to apply`, byte-identical.
- **Speed is not a problem**: 0.2–0.4 s on repositories from 544 to 3 825 files.
- **The `--require-verified` flag behaves as designed** on a repository whose rules are skipped: `PASS` without it, `FAIL … 1 rule not verified: exact-versions` with it.

## Open questions the rounds could not settle

1. Can `pnpm import` read a **berry** `yarn.lock` (v10 `__metadata__`)? Needs an install; the runner may.
2. Does a `pnpm-workspace.yaml` without `packages:` break a repository whose manifest declares `workspaces: ["packages/*"]` (`create-t3-app`, `berry`)? `init` plans exactly that file.
3. Do older pnpm majors read `minimumReleaseAge`/`savePrefix` from `pnpm-workspace.yaml`? If pnpm 10.8 does not, the block 0017 writes is inert on the repositories that most need it.

## Documentation drift

The same round audited every document against the code: **60 findings**, one of them structural (the spec
says a refusal exits 2 where the code exits 3). They are grouped by cause in
[`docs-drift-audit.md`](docs-drift-audit.md), which also says what would have caught them: a documentation
contract test, not a behavioural one.

## Order of work — the plan

**0.8.9 — what is already fixed, plus the contract.** S1.1 (done: berry from 35 skips to 0), S1.3 (done),
S2.9 (the ignore block must accept the template family), the exit-code amendment, and a documentation
contract test covering the command/flag surface, the four exit codes, the version strings and the rule
count. One PR, one record (0024) declaring the spec amendments: R6 template family, R8/R9 the indentless
shape, W2 the block negations, and the exit-code table.

**0.9.0 — the lockfile reader.** S1.2 (`lockfileVersion 6.0`), S1.4 (`catalogs`), S1.6 (the comparator:
peer dependencies and override-rewritten specifiers, which produce 7 false positives in 8 when the skip
is lifted). These change verdicts, so they are one release with its own record and its own field re-run
on the same five clones.

**0.9.1 — the rest of the sentences.** S1.5/S2.8 (a declared pin is not a question for the machine),
S2.1/S2.2 (the remediation needs `-C`; composite actions must be read), S2.3–S2.7, the severity 3 list,
and the 60 documentation findings by cause.

**Then** the validation ledger, then npm.
