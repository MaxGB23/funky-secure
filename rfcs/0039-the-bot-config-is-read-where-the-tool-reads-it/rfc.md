# RFC 0039 — the bot config is read where the tool reads it

| | |
|---|---|
| **Status** | `accepted` — the owner decided on issue #534 that the configuration signal of R9 is read from the paths the bot tools themselves read, and that presence remains the whole signal. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/scope.md`](../../docs/spec/scope.md) §7.1, the `ci` target's read set, and [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R9, the configuration signal, as amended here. |
| **Supersedes** | nothing. It widens the read set §8.2 R9 has named since 0001 without changing what a configuration means to the rule. |
| **Amends** | [`0001`](../0001-funky-secure-v1/rfc.md) §7.1 and §8.2 R9: the `ci` target and the configuration signal name every spelling the tools read, and the `renovate` key inside the root `package.json` is read beside them. |

## What is true today

R9 looks for its configuration signal in exactly two paths (`src/lib/targets.js`):

```js
export const BOT_CONFIGS = ['.github/dependabot.yml', '.github/renovate.json'];
```

Measured at `5378992` on three repositories, each carrying a `package.json` and one configuration
file, scanned with `scan --only no-bot-auto-merge`:

| file | summary |
|---|---|
| `renovate.json` `{"automerge": true}` at the root | `0 errors · 0 warnings · 0 info · 1 passing` |
| `.renovaterc` `{"automerge":true}` at the root | `0 errors · 0 warnings · 0 info · 1 passing` |
| `.github/renovate.json` `{"automerge":true}` | `0 errors · 0 warnings · 0 info · 1 passing` → `1 info` |

The third is the control: the same bytes in the one path the rule knows produce the finding.

The spec states the obligation this list answers, and it is what the change is measured against —
`docs/spec/rules.md` §8.2 R9, item 1, at `5378992`, lines 328-331:

> `.github/dependabot.yml` or `.github/renovate.json` present is one `fail` finding,
> `code: bot-config-present`, whose severity is `info`

## Why that is a defect

R9's question is whether a dependency update can reach the default branch without a human reading
it. Renovate merges **server-side**: with `"automerge": true` and no workflow at all there is no
`gh pr merge` step to find and no automerge action to recognise, so the configuration file is the
only evidence the repository leaves. A repository configured that way scans clean today, and the
rule that exists for exactly that repository is the one that answers `pass`.

The measured set is not a matter of taste: Renovate's File Matching page states its own locations,
and its source expresses them as the glob `renovate.json{,c,5}`.

| location | spellings |
|---|---|
| root | `renovate.json`, `renovate.jsonc`, `renovate.json5` |
| `.github/` | the same three |
| `.gitlab/` | the same three — read on **any** host |
| dotfiles | `.renovaterc`, `.renovaterc.json`, `.renovaterc.jsonc`, `.renovaterc.json5` |

Dependabot's file is `.github/dependabot.yml` or `.github/dependabot.yaml`: GitHub reads either
extension for the same file, which is the argument `ACTION_METADATA` already makes in the same
module. No bot reader accepts `.yaml` today, and that is the defect rather than the reason.

Renovate also accepts a `renovate` key inside `package.json`. That one is not a path, and reading it
as one is the mistake this record exists to prevent: `repoFacts` answers the list with
`exists(join(at, path))`, so a `package.json` in `BOT_CONFIGS` would make **every repository with a
manifest** report `bot-config-present` — all six golden fixtures carry one.

## Decision

**The paths extend `BOT_CONFIGS`, append only.** The two entries that have always been there keep
their positions, because two live assertions compare the resolved list positionally for a fixture
that carries exactly `dependabot.yml` and `.github/renovate.json`
(`tests/rules/no-bot-auto-merge.test.js`). A list rewritten in tool order would turn both red for a
change that is otherwise correct, and a reader would have to work out which of the two facts moved.

**The manifest key is a separate read, not a path.** `repoFacts` answers it from the root manifest it
already parses: presence when that manifest parsed to an object that has its own `renovate` property,
and **presence=false** when it is `null`, not JSON, or not an object. The guard is not decoration:
`parseJson` returns `{ json: null, error }` for a byte-order mark or a truncated file, two shapes the
suite drives through the real binary (`tests/rules/package-manager-pin.test.js`), and an unguarded
read of `.json` would throw inside `repoFacts` — a crash in the resolver, on a manifest another rule
already reports in its own words (0027, S4). The root manifest only: a workspace importer's key is a
member's configuration, and reporting it as a repository-root finding would be a claim about a file
the repository does not treat as its own root.

**The evidence says which fact fired.** The entry pushed is `package.json#renovate`, never
`package.json`, so `automated updates configured (package.json#renovate)` is distinguishable from a
repository that merely has a manifest, and the message names the fact rather than the container.

**Presence only, never parsed for severity.** The spec's own sentence is *"v0.1 does not judge the
tool, only the merge path"* (§8.2 R9), so:

- `"automerge": true` and a bare `renovate.json` produce the same `info`, worded the same way;
- `"enabled": false` is reported as configured, and the rule's page says so;
- the finding proves the declaration exists, and never that it enables automerge.

Reading `"automerge"` to move the severity is a different decision, with its own record, and the spec
does not ask for it.

**One finding for the set, and the order is the list's.** A repository carrying several
configurations yields one `bot-config-present` naming all of them, sorted in `BOT_CONFIGS` order with
the manifest key last, which is the rule the page already states.

**`.gitlab/renovate.json` is read, and the limits say why.** Renovate's page lists it for any host,
and a rule that stayed silent about a `.gitlab/` root would answer `pass` for a repository whose bot
configuration is sitting in the directory it looked next to.

**What does not move.** The severity stays `info` in both presets; the merge-path half, R11's
ownership of the `pull_request_target` hazard and the `error`/`error` pair are untouched; the JSON
document of 10.2 gains no key, because the fact travels in `botFiles` and in the message.

## Conformance

- the resolver's table covers every spelling in the measured set, each producing its own `botFiles`
  entry, so a spelling cannot be silently dropped later;
- two configurations at once are one finding naming both, and three are one finding naming three;
- a manifest that is byte-order-marked, truncated or not an object answers presence=false and does
  not throw, and a workspace importer's key answers presence=false;
- a repository carrying none of them passes with an empty `botFiles`;
- the six golden reports do not move, asserted by regenerating them and finding no diff;
- the two live assertions on the `.github/` spellings keep their positions.

## What this does not do

It does not read what a configuration says, so it never reports whether a repository automerges —
only that a bot is configured, which the finding states. It does not read `.gitlab/dependabot.yml`,
which no documented location names. It adds no rule, no flag and no output field: the finding is the
one R9 has emitted since I-88, widened to the paths its tool actually uses.
