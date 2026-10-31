# Funky Secure 👻

`funky-secure` audits a pnpm repository and answers one question: **is this project — and the machine
that builds it — configured the way we decided?** Twelve stateless rules, the evidence each one read,
one verdict, and a write plan you read before anything is applied. It never installs, never resolves a
version, never touches the network and never keeps state.

The point is a verdict you can defend: every finding names the file and line that produced it, every
action is a command or an edit, and the report says whether the policy came from this repository or
from the laptop that ran it.

![Four numbered glass panels on a dark grid: what funky-secure reads, twelve stateless rules in four families, the verdict carrying PASS and FAIL, and the findings turned into a plan you apply, with the exit codes and the commands the plan prints](docs/images/diagram.jpg)

## 📦 What you get

- **A verdict with evidence.** Twelve rules over what actually reaches your install path: the package
  manager pin, the lockfile, the release-age quarantine, floating ranges, tracked `.env` files, the
  CI pins, the merge path, the workflow triggers.
- **A plan instead of magic.** `init` prints every write with its absolute path and a digest of the
  exact bytes, and `--apply` performs only those writes. A value that already exists and differs is a
  `conflict` you read, never an edit it makes.
- **A way out of npm.** `migrate` prints the five steps and performs only the removal of the foreign
  lockfile, and only when that cannot delete your only lockfile.
- **A contract for CI and agents.** One JSON document and four exit codes — `0` nothing to report,
  `1` a violation, `2` a question the tool could not answer, `3` a refusal, which wrote nothing — no
  prose to parse and no timestamp unless you ask for one.
- **Nothing to trust.** Zero runtime dependencies, zero development dependencies, no network, no
  cache, no daemon. Two runs over the same state produce the same bytes.

## 💡 Why this exists

The 2026 supply-chain campaigns stopped stealing source code and started stealing the credentials that
live on a developer's machine: registry tokens, cloud keys, SSH keys. The delivery mechanism is the
install path, in the window `npm audit` cannot see — by the time you audit, the lifecycle script has
already run.

The defenses that stop them are mostly configuration: which manager, which lockfile, which age policy,
which ignore rules, which CI pins. And a defense nobody verifies is a defense that silently stopped
working: a `pnpm-workspace.yaml` that used to carry a release-age floor looks exactly like a hardened
one. That is the gap this tool fills, deterministically, with evidence you can review.

## 🎯 Who this is for

Both readers get the whole product. Neither gets a reduced version of it.

**You are starting out.** Run `funky-secure scan` and do what the `→` lines say. You do not need to
know why a 72-hour quarantine matters to benefit from it, though every rule page explains the attack it
prevents. [`docs/guide.md`](docs/guide.md) has a "if you see this, do this" table for the twelve rules
and explains what each symbol and verdict means.

**You already do this for a living.** `--scope` separates repository facts from machine facts,
`--format json` and the exit codes are a stable contract for CI and agents, and
`funky-secure.config.json` moves the policy into the repository — preset, quarantine floor and per-rule
severity — instead of into whoever happened to run the command.

## 🚦 The commands

| Command | The question it answers | Writes |
|---|---|---|
| `start` | what do I run first, in which order | nothing, ever |
| `scan` | what is wrong here, with evidence | nothing, ever |
| `init` | what can be fixed, and exactly how | the printed plan, only with `--apply` |
| `migrate` | how do I leave npm or yarn | the foreign lockfile's removal, only with `--apply` |
| `pin` | how do I pin the ranges this repository already has | the specifiers it pins, with `--apply` |
| `explain` | what does one rule actually check | nothing |
| `skill` | what does an agent need to know before it acts | nothing: it prints the shipped skill on stdout |

## ⚡ Quick start

```sh
npx funky-secure start          # a new repository: the ordered steps, ending at --preset starter
npx funky-secure scan           # audit: read the report, follow the → lines
npx funky-secure init           # the plan, with paths and digests; writes nothing
npx funky-secure init --apply   # perform exactly that plan
```

`npx` is deliberate and it is the only place it appears: the quick start cannot assume pnpm, because
installing pnpm is one of the steps it is about to print. Once pnpm is there, bring the auditor the
same way as the dependencies it audits — `pnpm dlx funky-secure@0.10.2` — and in CI pin it in your
lockfile instead, as [`docs/guide.md`](docs/guide.md) shows.

`pnpm dlx` is for a reader who already has pnpm, not a reason to install it: the auditor needs
nothing but Node, and installing a package manager is your decision rather than a side effect of an
audit.

None of this changes what the audit covers. The twelve rules read the repository and its workflows —
the lockfile, the ranges, the committed ignore rules, the pinned actions, the merge path, the
permissions — so a project that already uses pnpm gets **fewer findings because there is nothing to
migrate, not a shorter check**. `start` drops only the steps that do not apply.

In a new repository, `funky-secure start` is the first command: it prints the steps that still apply,
in the order that makes them work, and writes nothing itself. Three commands write, and each only when
it is asked: `init --apply` inside the repository, `pin --apply` over the specifiers the lockfile
already resolved, and `migrate --apply` over the foreign lockfile. `start` ends by pointing the first
scan at `--preset starter`, the six rules a project needs on day zero, and states which rules that
preset leaves `off` instead of claiming a coverage it does not have.

`init` also ends with the steps it will not take for you, in order: `pnpm install` when there is no
lockfile, `funky-secure migrate --apply` when another manager's lockfile is still around, and `git add`
of what it wrote.

[`docs/guide.md`](docs/guide.md) explains how to read the report. When a command refuses, the first
line says what to do and the second says why it refused.

## 🧭 The twelve rules

| Rule | `baseline / strict` | Question |
|---|---|---|
| `package-manager-pin` | error / error | does `package.json` declare the pnpm actually answering? |
| `lockfile-committed` | error / error | is the lockfile present, tracked and not ignored? |
| `foreign-lockfile` | warn / warn alone · error / error in coexistence | does another package manager still shape this repository? |
| `quarantine` | warn / error | is the release-age quarantine a gate, or an auto-approval list? |
| `exact-versions` | warn / error | are dependency specifiers exact, and does the lockfile agree? |
| `env-not-tracked` | error / error | is any environment file committed? |
| `sensitive-ignored` | error / error | would this repository ignore the files that must never be committed? |
| `actions-pinned-sha` | error / error | can a CI workflow change under you without a commit? |
| `no-bot-auto-merge` | error / error | can a dependency update reach the default branch unread? |
| `ci-no-safety-overrides` | warn / error | does CI disable the frozen lockfile or re-enable lifecycle scripts? |
| `pull-request-target` | error / error | does a workflow combine `pull_request_target` with a checkout of the pull request head? |
| `workflow-permissions` | warn / error | does each workflow declare least-privilege `permissions:`? |

Every rule has one page under [`docs/rules/`](docs/rules/), and this table, `--help` and `explain` are
renderings of the same catalog in `src/rules/index.js`. A drift test fails when they disagree.

## 🔒 Supply chain

This tool is part of the supply chain it audits, so it carries nothing it does not need.

- **Zero dependencies**, runtime and development. No YAML parser, no CLI framework, no colour library,
  no HTTP client: `node:` built-ins plus your repository's files.
- **No network, no install, no resolution, no lifecycle script.** It runs a closed list of read-only
  probes and answers from what it read.
- **Writes only what it printed.** The six declared changes, across four files, each with its path
  and digest; your pnpm configuration, store and global settings are never written. One command
  writes outside the repository — `skill --install` places the agent skill, and only when asked.
- **Deterministic.** Same repository state, same bytes. `--with-timestamp` is the only exception, and
  it is opt-in.

## 🧰 Requirements

Node `>= 22`, ESM, no install step for the tool itself. pnpm is recommended and npm or yarn are
migrated, never required.

Linux and Windows are the supported platforms: the suite runs on both in CI. macOS is **not** a
supported target — it is never executed, and the owner decided it stays that way, so nothing here
claims it works there. On macOS you are on your own, and a bug report about it is read as a report
from an unsupported platform rather than as a regression.

## 📚 Documentation

- [Guide](docs/guide.md) — how to read the output, basic and advanced usage, and what to do per rule.
- [CLI reference](docs/cli.md) — every command, flag, exit code and JSON field.
- [Concept](docs/concept.md) — what the product is and what it refuses to be.
- [Architecture](docs/architecture.md) — the four layers and the invariants behind the guarantees.
- [Spec](docs/spec/README.md) — the normative contract: targets, rules, report, commands, exit codes.
- [Agent skill](skills/README.md) — the instructions an agent loads before touching a repository. The binary prints it, so any runtime can be given it with `pnpm dlx funky-secure skill > .agents/skills/funky-secure/SKILL.md`.
- [Documentation map](docs/README.md) — where a change belongs.
- [Decisions](docs/decisions.md) — the decision log, and the [RFC record](rfcs/README.md) it came from.

## 🛠️ Development

```sh
node --test                          # the suite: rules, commands, drift gate, goldens, self-scan
node scripts/gen-golden.js           # regenerate the golden reports after an intended change
node bin/funky-secure.js scan --scope repo --fail-on warn   # the dogfooding gate
```

The repository runs on its own standard: the suite, the drift gate and the self-scan gate every push,
and `prepublishOnly` runs them again before a release. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for
the hard rules a change has to satisfy.

## 📄 License

MIT © 2026 MaxGB23 — see [`LICENSE`](LICENSE).
