# Guide

This page is for the person who has to decide what to do about a repository today. It assumes no
prior knowledge of supply chains, and it does not replace the reference: every flag, exit code and
JSON field lives in [`cli.md`](cli.md), and the normative contract is the
[spec](spec/README.md).

`funky-secure` answers one question: **is this repository — and the machine that builds it —
configured the way we decided?** It reads, it never installs, and it never edits your machine. What
it can fix, it offers as a plan you read before applying; what it cannot fix, it prints as the exact
command or edit a human has to make.

There are two ways to use it, and both get the whole product:

- **You are starting out.** Run `funky-secure start` in the directory and follow the numbered steps it
  prints; after them, run it again and read the report, doing what each `→` line says. You do not need
  to know why the quarantine matters to benefit from it — but if you want to, every rule page under
  [`rules/`](rules/) explains the attack it prevents.
- **You already do this for a living.** `--format json` and the exit codes are a stable contract for
  CI and for agents, `--scope` separates repository facts from machine facts, and `--only` /
  `--ignore` / `funky-secure.config.json` make the policy per repository instead of per person.

## How to read the output

One report has these parts, in this order:

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

The first four lines are the answer, in the order you want it: the title, where the policy came
from, the counts, the verdict. Everything below the separator is evidence, and `next` is the last
line.

**A finding answers three questions on its own.** The heading names *what* is wrong, in words rather
than in a rule id (`Lockfile`, `Sensitive files`), and *where* it was measured — `pnpm-lock.yaml`, or
`package.json:4` when one line is the subject. The sentence under it says what the tool found. The
`→` line under that is *what to do about it*: a command you can copy, or the file and step to edit.
You never have to open the rule catalog to act, and the rule id is deliberately absent —
`funky-secure scan --verbose` adds it under each finding, says why each skipped rule was skipped,
lists the passing rules by name, and stops shortening machine paths.

**The symbols.** Four, and nothing else:

| Symbol | Meaning | What you do |
|---|---|---|
| `✖` | a finding at `error` severity | fix it, or the gate fails |
| `⚠` | a finding at `warn` severity | fix it when you can; it only fails if `--fail-on warn` |
| `ℹ` | a finding at `info` severity | read it, it never fails a run |
| `–` | not verified in this run | read the reason: it says why and what would verify it |
| `→` | the action for the line above | copy it, or make the edit it names |

**The provenance line** tells you whether the verdict describes your repository or your laptop.
`preset strict (funky-secure.config.json)` means the policy came from the repository;
`(default)` means nobody chose it. `quarantine declared in pnpm-workspace.yaml` means the repository
carries the setting; `not declared in this repository` means whatever value was measured came from
pnpm's own configuration, which is not in the repository and does not travel with it.

**The `not run` line** appears only when the policy you are running turns rules off, which is what
`--preset starter` does. It sits between `verdict` and the separator, so you read it before the
evidence, and it counts what you actually got:

```text
not run  6 of 12 rules; off by policy: Environment files, Pinned actions, Bot
         auto-merge, CI install flags, pull_request_target, Workflow permissions
```

Six of twelve rules ran and the six named ones did not, so a `PASS` here means "passed the six that
ran", not "this repository is fully checked". A rule that is off prints nothing and is not counted in
`summary`, so without the line a run would look clean while it measured almost nothing. `--only` and
`--ignore` never print it: picking rules for one run does not change the policy, and the line is a
claim about the policy. The list is in catalog order, so it is the same list in every report.

**`summary`** counts each rule verdict once: how many rules failed at each severity, how many passed,
how many were skipped. **`verdict`** compares those failures with the threshold (`--fail-on`, default
`error`) and prints `PASS` or `FAIL`.

**`next`** is the last block, and it is an instruction rather than a count: the one command that
moves the repository forward. When a finding can be fixed automatically it names `funky-secure init`
and how many fixes it can plan — nothing is written until you add `--apply` — then one
`funky-secure explain <rule>` for the finding to read first. A `PASS` says `nothing to do`; a `FAIL`
where nothing is automatic says the work is manual, because each finding above already names its
file, its line and the action. The block is human output only — `--format json` gains no field for it.

**Exit codes** are for the machine, not for you: `0` nothing at or above the threshold, `1` a policy
violation, `2` the tool could not answer. If you are reading the output yourself, the `verdict` line
already said it.

A block heading is where the finding was measured, in upper case: `REPO-ROOT` for the repository,
`IMPORTER <path>` for a `package.json`, `CI` for workflows, `MACHINE` for the pnpm that answers on
this computer. A target with nothing to report prints its heading and one line under it, `all 5
rules pass`, and a target with more than one skipped rule is a single line naming their labels plus
the flag that expands them.

## The commands you actually need

```sh
funky-secure start         # the ordered path out of an empty directory; writes nothing, always exits 0
funky-secure scan          # audit; writes nothing; exits non-zero when the gate fails
funky-secure init --apply  # write the fixes it can write, after printing them
funky-secure migrate       # the plan for leaving npm or yarn; --apply removes the foreign lockfile
```

`start` is the entry point for a new project. It answers one question — what do I run first — and it
answers it in order, with only the steps that still apply, because the order is the point: the
workspace block has to exist before the install that reads it, and a lockfile can only exist after the
first dependency. From an empty directory that is `git init`, `pnpm init`,
`funky-secure init --apply`, `pnpm add <your first dependency>`, and `funky-secure scan --preset
starter` last. A project a framework generator produced is the case the order turns on: while another
manager's lockfile is still there it names `funky-secure migrate` first, before `init --apply`, and it
does not name the first add at all, because adding now would write a second lockfile beside the npm
one. It writes nothing itself — `init --apply` is still the only writer — and it exits `0` in every
state, because it is advice and not a gate.

`scan` is the product. `init` exists because a diagnosis you cannot act on is half useful: it runs the
same scan and turns the fixable findings into writes — the package-manager pin, the quarantine gate,
the `.gitignore` block, the strict config — and it prints every write with its absolute path and a
digest of the exact bytes before it happens. It refuses a file with uncommitted changes instead of
mixing its edits with yours.

`init` also ends with the steps it will not take for you, in order, such as `pnpm install` (it never
installs, resolves or reaches the network) and `git add` of what it just wrote.

`migrate` is the way out of npm. It prints five steps and performs only the removal of the foreign
lockfile, and only after a `pnpm-lock.yaml` exists and you are not on the default branch.

`explain <rule-id>` prints one rule in depth, and `explain` with no rule prints the catalog — `--list`
is the explicit way to ask for the same bytes. `--help` prints
the contract: commands, flags and rule ids, generated from the same table the parser uses.

## If you see this, do this

| Rule (`explain <id>`) | It means | Do |
|---|---|---|
| `package-manager-pin` | `package.json` does not pin the pnpm that actually answers | `funky-secure init --apply` writes it; or `corepack use pnpm@<version>` |
| `lockfile-committed` | no `pnpm-lock.yaml` in the repository, or it is ignored | `pnpm install`, then commit the lockfile |
| `foreign-lockfile` | another manager's lockfile still resolves a second dependency tree | `funky-secure migrate --apply` |
| `quarantine` | new releases are auto-approved instead of waiting the policy age | `funky-secure init --apply` writes the gate |
| `exact-versions` | a dependency uses a range, so an install can pick a different version | `pnpm pkg set '<section>.<name>=<version>' && pnpm install` |
| `env-not-tracked` | an environment file is committed | `git rm --cached .env` — and rotate what it contained |
| `sensitive-ignored` | `.env`, keys or `.npmrc` are not covered by `.gitignore` | `funky-secure init --apply` appends the block; `git rm --cached` anything already tracked |
| `actions-pinned-sha` | a workflow uses `owner/repo@v4`, so the code can change under you | replace the tag with the 40-character commit SHA and a `# vX.Y.Z` comment |
| `no-bot-auto-merge` | a dependency update can reach the default branch unread | delete that step from the workflow |
| `ci-no-safety-overrides` | CI disables the frozen lockfile or re-enables install scripts | remove the flag, or the `.npmrc` key |
| `pull-request-target` | a fork's code runs with the base repository's secrets | remove the trigger, or the step that checks out the pull request head |
| `workflow-permissions` | every job inherits the repository's default token scopes | add `permissions:` with `contents: read` and widen per job |

Each rule has a page under [`rules/`](rules/) with the detection, the evidence it reports, the
remediation and its limits. `funky-secure explain <id>` prints the same content in the terminal.

## Advanced

**Scopes.** `--scope auto` (the default) resolves the repository when you are inside one and the
machine always; `--scope repo` is the CI gate and never reads the machine; `--scope machine` reads
only the pnpm on this computer; `--scope all` is both, explicitly. Two rules depend on the machine —
`package-manager-pin` compares against the pnpm that answers, and `quarantine` reads the effective
age policy — so under `--scope repo` they are reported as *not verified*, and their message names
`--scope all`. A green CI gate therefore does not prove those two, by contract.

**Presets.** `--preset starter` is the one to use when you are starting a project: it runs six rules
at the severity they carry in `baseline` — the package-manager pin, the lockfile, the foreign lockfile,
the release-age quarantine, exact specifiers, and the files `.gitignore` must cover — and turns the
other six `off`: tracked environment files and the five CI and workflow rules, because a repository
minutes old has none of those for them to read. The foreign lockfile is in the set because that is
exactly what a framework generator leaves behind: a manifest and someone else's lockfile. It says so
in the `not run` line instead of claiming a coverage it does not have, and it keeps the same quarantine
floor as `baseline`. What it does not cover is exactly the six it names — so it is a starting gate,
not a CI gate: switch to `--preset baseline` (default) or `--preset strict` once the repository has a
workflow to check.
`strict` also asks for the 72-hour quarantine floor. `--fail-on error|warn|info|none` decouples
reporting from gating, and `--strict-probes` turns an unavailable required probe into an error so CI
cannot go green having measured nothing.

**Per repository, not per person.** `funky-secure.config.json` at the repository root accepts
`preset`, `quarantineMinutes` and `rules` (a rule id mapped to `off`, `info`, `warn` or `error`). This
is the answer to "this repository is allowed to differ from my laptop": the decision lives in the
repository, is reviewed with it, and the provenance line shows that it was applied.

**Selected rules.** `--only <ids>` and `--ignore <ids>` accept comma-separated ids and repeat;
`--ignore` wins. Use them to answer one question at a time, not to make a gate pass.

**JSON and agents.** `--format json` prints one document on stdout and nothing else; `plan` documents
for `init` and `migrate` go with their digests, and the write ledger of `--apply` goes to stderr so
stdout stays parseable. `--with-timestamp` adds `generatedAt` and is the only non-deterministic field.
Two runs over the same state produce the same bytes.

**In CI.** Pin the gate, so it cannot change without a change in your diff:

```sh
pnpm add -D funky-secure@0.5.0 --save-exact
```

```yaml
      - run: pnpm exec funky-secure scan --scope repo --fail-on warn --strict-probes
```

A gate fetched at every run — `npx funky-secure` with no version — measures whatever npm published that
morning, which is the defect this tool reports in other projects' workflows. A `devDependencies` pin
puts the version in the lockfile, in the diff and in the review.

**Why it never installs, never resolves and never writes your machine.** Because a tool that audits a
supply chain is part of one. It reads files and runs a closed list of read-only probes; the only
writes are the printed plan items under `init --apply`, and the only removal is `migrate --apply`'s
foreign lockfile. Your pnpm configuration, your store and your global settings are read, never
written — which is also why the report says where a number came from instead of moving it.

## Where to read more

- [`concept.md`](concept.md) — what the product is and what it refuses to be.
- [`cli.md`](cli.md) — every command, flag, exit code and JSON field.
- [`architecture.md`](architecture.md) — the four layers and the invariants behind the guarantees.
- [`rules/`](rules/) — one page per rule: question, detection, evidence, remediation, limits.
- [`decisions.md`](decisions.md) — the decision log, and the RFC that is the normative contract.
