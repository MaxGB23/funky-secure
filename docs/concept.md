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
- **Not a writer, except when asked.** Nothing is written outside `init --apply`, and `init --apply`
  writes only the closed, printed target list — never the manager-owned settings the RFC excludes.

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

`scan` exits `0` when no finding sits at or above `--fail-on`, so skips and infos do not fail a
build. It exits `1` when at least one policy violation does, which is the only meaning of `1`. It
exits `2` when the tool could not answer — bad usage, malformed config, unreadable input, an
unavailable required probe under `--strict-probes`, or a refused write — and never for a violation.

The full command and flag reference is in [`cli.md`](cli.md); the layers and invariants are in
[`architecture.md`](architecture.md); the normative specification is
[`../rfcs/funky-secure-rfc.md`](../rfcs/funky-secure-rfc.md).
