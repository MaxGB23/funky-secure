# Concept

`funky-secure` is a supply-chain auditor and initializer for pnpm repositories. It answers one
question: *is this repository, and the machine that builds it, configured the way we decided — and if
not, what exactly do I run next?* It reports evidence, offers the writes that fix what is fixable as
a plan you read first, and never pretends a policy it cannot verify.

## What it refuses to be

- **Not an installer.** No command runs `pnpm install`, `pnpm import`, a lifecycle script or a
  build. The one step that downloads packages is printed as a human instruction.
- **Not a network client.** It resolves no version, queries no registry and sends nothing. The
  answer is a pure function of local files and local probes.
- **Not stateful.** There is no cache directory, no database, no `.funky/`, no daemon. Two runs on
  the same state produce the same bytes.
- **Not a writer, except when asked.** Nothing is written outside `init --apply`, `pin --apply`,
  `migrate` and `skill --install`, and each writes only what its own contract names: `init --apply`
  the closed, printed target list and never the manager-owned settings the RFC excludes; `pin --apply`
  the specifiers `pnpm-lock.yaml` already records a version for; `migrate` the foreign lockfile it was
  told to remove; `skill --install` the one file an agent reads, and only when the flag asks for it.

## What it writes, and when

`scan` writes nothing at all. The commands that can write print the exact change before it happens,
and every one of them is the only thing that happens: no side effect, no background repair. `init --apply` performs the writes below, in this order. Each one is a fix for a finding the
same run reported, and each one is planned from the repository's own files — never from the effective
configuration the machine happens to satisfy, so the same repository state produces the same plan on
any laptop:

| Write | File | Change |
|---|---|---|
| W1a | `pnpm-workspace.yaml` | `minimumReleaseAgeStrict: true` — turns the quarantine into a gate |
| W1b | `pnpm-workspace.yaml` | `minimumReleaseAge: 1440`, or `4320` under `--preset strict` — the age, always written in the same managed block (0017) |
| W1c | `pnpm-workspace.yaml` | `savePrefix: ''` — stops a later `pnpm add` from saving a caret |
| W2 | `.gitignore` | the managed block covering the sensitive paths |
| W3 | `package.json` | `packageManager: pnpm@<version>` — only when the pin is missing |
| W4 | `funky-secure.config.json` | the strict preset, so CI agrees with the run |

A repository with no `pnpm-workspace.yaml` gets one containing the managed block and nothing else, so
`init --apply` is a usable pnpm bootstrap rather than a patch for an already-configured repository.
The human plan ends with the steps the tool refuses to run — `pnpm install` when there is no lockfile,
`funky-secure migrate --apply` when a foreign lockfile coexists with the pnpm one, `git add` of what
it wrote — printed in order and never executed.

`migrate --apply` performs one removal: the foreign lockfile, step 4 of its plan. It refuses to
do so without a `pnpm-lock.yaml` (never delete the only lockfile), on the default branch, with a
detached `HEAD`, with uncommitted changes in the files it would remove, or when git cannot report the
tree. `init --apply` refuses a target file with uncommitted changes the same way. Every refusal exits
`3` with the action on the first line and the reason on the second; a value that exists and differs is
reported as a `conflict` and left alone, never overwritten. A second `--apply` over the same state
writes nothing.

What stays manual is deliberate: removing a file from the git index, rotating a credential, resolving
a SHA for an action tag, and re-resolving a dependency range all need a decision or the network, so
the tool prints the command and stops.

## Two scopes

A scan resolves targets in two scopes:

- **`repo`** — the repository root and what lives under it: importers, workflows, editor files. This
  is the CI gate (`scan --scope repo`), because a runner's machine configuration is not the
  developer's.
- **`machine`** — the pnpm answering on this host: its version, effective configuration, store and
  the version ambiguity when `--version` and the configuration disagree. Read-only, always.

`--scope auto` (the default) means repo plus machine; `--scope all` says the same thing explicitly.
A rule that applies to a missing target reports `skip`, and a skip is never a pass.

## Exit-code contract

A refusal — the target has uncommitted changes, the branch is the default one, the foreign lockfile is
the only one, a differing skill copy with no terminal to ask — exits `3`, with the action on the first
line and the reason on the second, and writes nothing. It is a decision, not a failure: nothing was
judged and nothing crossed a threshold, so it is not `1` either, and an integration that tells a
decision from a crash reads one code.

`scan` exits `0` when no finding sits at or above `--fail-on`, so skips and infos do not fail a build.
It exits `1` when at least one policy violation does, which is the only meaning of `1`. It exits `2`
when the tool could not answer: bad usage, malformed config, unreadable input, an unavailable required
probe under `--strict-probes`. Those are the four codes, and no code is reused for two answers.

The full command and flag reference is in [`cli.md`](cli.md); the layers and invariants are in
[`architecture.md`](architecture.md); the decisions a reviewer wants are in
[`decisions.md`](decisions.md); the normative specification is [`spec/`](spec/README.md), and the
record of how it was decided is [`../rfcs/0001-funky-secure-v1/rfc.md`](../rfcs/0001-funky-secure-v1/rfc.md).
