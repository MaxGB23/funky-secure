# funky-secure

Supply-chain auditor and initializer for pnpm repositories.

It answers one question — *is this repository set up so that a supply-chain change cannot slip in
unreviewed?* — reports what it finds, and then offers the writes that fix it as a plan you read
before anything is applied.

Zero runtime dependencies. Zero development dependencies. No network, no state, no build step.

## Usage

```sh
funky-secure scan                       # read-only audit, human output
funky-secure scan --format json         # the same report as JSON
funky-secure scan --scope repo          # repository only: the supported CI gate
funky-secure init                       # print the write plan
funky-secure init --apply               # perform it
funky-secure migrate                    # the plan for leaving npm/yarn behind
funky-secure explain quarantine         # one rule, in depth
```

Exit codes are the contract: `0` nothing at or above the threshold, `1` a policy violation,
`2` the tool could not answer (bad usage, malformed config, unavailable required probe). A CI job
that only separates zero from non-zero still behaves correctly.

## The nine rules

| Rule | Question | Severity baseline / strict |
|---|---|---|
| `package-manager-pin` | does `package.json` declare the pnpm actually answering? | error / error |
| `lockfile-committed` | is the lockfile present, tracked and not ignored? | error / error |
| `foreign-lockfile` | does another package manager still shape this repository? | warn / warn |
| `quarantine` | is the release-age quarantine a gate, or an auto-approval list? | warn / error |
| `exact-versions` | are dependency specifiers exact, and does the lockfile agree? | warn / error |
| `env-not-tracked` | is any environment file committed? | error / error |
| `sensitive-ignored` | would this repository ignore the files that must never be committed? | error / error |
| `actions-pinned-sha` | can a CI workflow change under you without a commit? | error / error |
| `no-bot-auto-merge` | can a dependency update reach the default branch unread? | error / error |

`scan` is read-only, always. It never installs, resolves a version, runs a lifecycle script, or
touches the network.

## Design

Four layers, one direction of data flow: targets resolve what exists, collectors run one declared
probe per fact, rules are pure functions over that context, and the report is computed once and
rendered two ways. The machine is read-only and never written.

The normative specification is [`rfcs/funky-secure-rfc.md`](rfcs/funky-secure-rfc.md); the
implementation decisions taken along the way are recorded in
[`odd/tasks/funky-secure-v0.1.md`](odd/tasks/funky-secure-v0.1.md).

## Development

```sh
node --test                          # the suite, no devDependency
node bin/funky-secure.js scan        # the product over its own repository
```

Node `>= 20.11`, ESM, MIT.

## Status

`0.1.0` is being implemented on `feat/v0.1`. The RFC is revision 3 (v1.2); the empirical evidence
behind it is in [`odd/evidence/e1-e8.md`](odd/evidence/e1-e8.md).
