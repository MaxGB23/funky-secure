# Guide

This page is for the person who has to decide what to do about a repository today. It assumes no
prior knowledge of supply chains, and it does not replace the reference: every flag, exit code and
JSON field lives in [`cli.md`](cli.md), and the normative contract is the
[RFC](../rfcs/funky-secure-rfc.md).

`funky-secure` answers one question: **is this repository — and the machine that builds it —
configured the way we decided?** It reads, it never installs, and it never edits your machine. What
it can fix, it offers as a plan you read before applying; what it cannot fix, it prints as the exact
command or edit a human has to make.

There are two ways to use it, and both get the whole product:

- **You are starting out.** Run it, read the report, run the command under each finding. You do not
  need to know why the quarantine matters to benefit from it — but if you want to, every rule page
  under [`rules/`](rules/) explains the attack it prevents.
- **You already do this for a living.** `--format json` and the exit codes are a stable contract for
  CI and for agents, `--scope` separates repository facts from machine facts, and `--only` /
  `--ignore` / `funky-secure.config.json` make the policy per repository instead of per person.

## How to read the output

One report has five parts, in this order:

```text
funky-secure scan  ·  preset baseline  ·  scope repo
provenance  preset baseline (default)  ·  quarantine not verified (machine excluded)  ·  machine excluded

repo-root
  – package-manager-pin  package.json    skipped: the machine is out of scope, so the declared packageManager pin was not compared with the pnpm that answers; run funky-secure scan --scope all to verify it
  ✖ lockfile-committed   pnpm-lock.yaml  pnpm-lock.yaml is missing from the repository root; installs are not reproducible without it
                                         → pnpm install
  – quarantine           skipped: pnpm config list --json was unavailable

importer  package.json
  ⚠ exact-versions  package.json:4  left-pad@^1.3.0 is a floating range
                                    → pnpm install --lockfile-only && funky-secure scan --only exact-versions

passing  3 rules (foreign-lockfile, actions-pinned-sha, no-bot-auto-merge)   ·   8 skipped

summary  1 error · 1 warning · 0 info · 3 passing · 8 skipped
verdict  FAIL (threshold: error)
```

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

**`summary`** counts each rule verdict once: how many rules failed at each severity, how many passed,
how many were skipped. **`verdict`** compares those failures with the threshold (`--fail-on`, default
`error`) and prints `PASS` or `FAIL`.

**Exit codes** are for the machine, not for you: `0` nothing at or above the threshold, `1` a policy
violation, `2` the tool could not answer. If you are reading the output yourself, the `verdict` line
already said it.

A block heading is where the finding was measured: `repo-root` for the repository, `importer` for a
`package.json`, `ci` for workflows, `machine` for the pnpm that answers on this computer.

## The three commands you actually need

```sh
funky-secure scan          # audit; writes nothing; exits non-zero when the gate fails
funky-secure init --apply  # write the fixes it can write, after printing them
funky-secure migrate       # the plan for leaving npm or yarn; --apply removes the foreign lockfile
```

`scan` is the product. `init` exists because a diagnosis you cannot act on is half useful: it runs the
same scan and turns the fixable findings into writes — the package-manager pin, the quarantine gate,
the `.gitignore` block, the strict config — and it prints every write with its absolute path and a
digest of the exact bytes before it happens. It refuses a file with uncommitted changes instead of
mixing its edits with yours.

`init` also ends with the steps it will not take for you, in order, such as `pnpm install` (it never
installs, resolves or reaches the network) and `git add` of what it just wrote.

`migrate` is the way out of npm. It prints five steps and performs only the removal of the foreign
lockfile, and only after a `pnpm-lock.yaml` exists and you are not on the default branch.

`explain <rule-id>` prints one rule in depth, and `explain --list` prints the catalog. `--help` prints
the contract: commands, flags and rule ids, generated from the same table the parser uses.

## If you see this, do this

| You see | It means | Do |
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

**Presets.** `--preset baseline` (default) and `--preset strict`. The catalog sets the severity of
every rule per preset; `strict` also asks for the 72-hour quarantine floor. `--fail-on error|warn|
info|none` decouples reporting from gating, and `--strict-probes` turns an unavailable required probe
into an error so CI cannot go green having measured nothing.

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

**In CI.** The gate is one step:

```yaml
      - run: npx funky-secure scan --scope repo --fail-on warn --strict-probes
```

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
