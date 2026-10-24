# funky-secure

`funky-secure` audits a pnpm repository and reports whether a supply-chain change can reach it
unreviewed. It answers that question with nine stateless rules, prints the evidence each one read,
and offers the writes that fix what is fixable as a plan you review before anything is applied. It
never installs, never resolves a version, never touches the network and never keeps state.

Zero runtime dependencies. Zero development dependencies. Node `>= 20.11`, ESM.

## Install

```sh
npx funky-secure scan                  # one-off audit, nothing installed
npm install --save-dev funky-secure    # pinned into the repository, for CI
```

## Commands

```text
funky-secure scan [--scope auto|repo|machine|all] [--preset baseline|strict]
                  [--format human|json] [--fail-on error|warn|info|none]
                  [--only <ids>] [--ignore <ids>] [--strict-probes] [--with-timestamp]
funky-secure init [--preset baseline|strict] [--format human|json] [--apply] [--allow-dirty]
funky-secure migrate [--from npm|yarn|auto] [--apply] [--allow-dirty]
funky-secure explain <rule-id> [--format human|json]
funky-secure explain --list [--format human|json]
funky-secure --help
```

`scan` is the read-only audit: it resolves targets, runs the active rules and renders one report,
human or JSON. `--scope repo` is the supported CI gate; `--scope machine` reads only the pnpm on this
host; `auto` (the default) means both. `--fail-on` decouples reporting from gating.

`init` prints the write plan and, with `--apply`, performs it: the quarantine gate flip
(`minimumReleaseAgeStrict: true`) and, under `--preset strict`, the 4320-minute floor in one managed
block of `pnpm-workspace.yaml`; the managed block in `.gitignore`; `packageManager` in
`package.json`; and `funky-secure.config.json` for a persisted `strict` preset. A plan never
overwrites a value it did not write: a differing value is a `conflict` and is left alone.

`migrate` prints the five steps for leaving npm or yarn behind; `--apply` performs step 4 only, the
removal of the foreign lockfile, and only after a `pnpm-lock.yaml` exists.

`explain` prints one rule in depth, or the catalog with `--list`.

This is the output of `node bin/funky-secure.js scan --scope repo --fail-on warn` in this
repository, copied verbatim:

```text
funky-secure scan  ·  preset strict  ·  scope repo

repo-root
  – quarantine  skipped: the quarantine is read from the machine configuration, which --scope repo excludes by contract

passing  8 rules (package-manager-pin, lockfile-committed, foreign-lockfile, env-not-tracked,
         sensitive-ignored, exact-versions, actions-pinned-sha, no-bot-auto-merge)   ·   1 skipped

summary  0 errors · 0 warnings · 0 info · 8 passing · 1 skipped
verdict  PASS (threshold: warn)
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Nothing at or above `--fail-on`. Skips and infos never fail a run. |
| `1` | At least one finding at or above `--fail-on`. Never used for a tool failure. |
| `2` | The tool could not answer: bad usage, malformed config, unreadable input, an unavailable required probe under `--strict-probes`, or a refused write. |

A CI job that only separates zero from non-zero still behaves correctly.

## The nine rules

| Rule | `baseline / strict` | Question |
|---|---|---|
| `package-manager-pin` | error / error | does `package.json` declare the pnpm actually answering? |
| `lockfile-committed` | error / error | is the lockfile present, tracked and not ignored? |
| `foreign-lockfile` | warn / warn | does another package manager still shape this repository? |
| `quarantine` | warn / error | is the release-age quarantine a gate, or an auto-approval list? |
| `exact-versions` | warn / error | are dependency specifiers exact, and does the lockfile agree? |
| `env-not-tracked` | error / error | is any environment file committed? |
| `sensitive-ignored` | error / error | would this repository ignore the files that must never be committed? |
| `actions-pinned-sha` | error / error | can a CI workflow change under you without a commit? |
| `no-bot-auto-merge` | error / error | can a dependency update reach the default branch unread? |

Every rule has one page under `docs/rules/`, and the table above, `--help` and `explain` are
renderings of the same catalog in `src/rules/index.js`. A drift test fails when they disagree.

## What it refuses to do

- **No install, no resolution, no lifecycle script.** Nothing runs `pnpm install`, `pnpm import` or a
  build; the one step that downloads packages is printed as a human instruction.
- **No network.** It queries no registry and resolves no version, so it never tells you a SHA for a
  tag or a version for a range.
- **No state.** No cache directory, no database, no daemon, no `.funky/`. Two runs over the same
  repository state produce the same bytes.
- **No writes outside `init --apply`.** `scan` writes nothing at all; `migrate --apply` performs one
  removal (the foreign lockfile); `init --apply` writes only the closed target list above, prints
  each write with its absolute path and digest, and refuses a target file with uncommitted changes.
- **No enforcement of pnpm.** It recommends pnpm and migrates away from npm or yarn; it never
  requires either.

## Development

```sh
node --test                          # the suite: rules, commands, drift gate, goldens, self-scan
npm test                             # the same runner, no devDependency
node bin/funky-secure.js --help      # the static contract
node bin/funky-secure.js scan        # the product over its own repository
node scripts/gen-golden.js           # regenerate tests/golden/*.json after a reviewed change
```

Goldens are generated, never hand-edited: `tests/golden/<fixture>.json` is the JSON report of one
fixture repository under a deterministic collector, and `tests/drift.test.js` fails when a golden
stops matching what the code produces. `tests/self.test.js` asserts this repository passes its own
scan; if it stops doing so, that test fails, which is the point.

The normative specification is [`rfcs/funky-secure-rfc.md`](rfcs/funky-secure-rfc.md) (revision 3,
v1.2). The implementation tasks, decisions and evidence are in
[`odd/tasks/funky-secure-v0.1.md`](odd/tasks/funky-secure-v0.1.md), the decision log for review is
[`docs/decisions.md`](docs/decisions.md), and the empirical record behind the rules is
[`odd/evidence/e1-e8.md`](odd/evidence/e1-e8.md).

MIT.

## Contributing

Every pull request closes an issue that carries `status:approved`, applies exactly one `type:*`
label and lives on a `type/description` branch. The full policy — the hard rules (zero dependencies,
pure rules, the write guard), the issue checklists, the pull request checklist and the local commands
— is [`CONTRIBUTING.md`](CONTRIBUTING.md); the templates are in
[`.github/`](.github/PULL_REQUEST_TEMPLATE.md).

The repository enforces that policy instead of hoping for it: `scripts/check-pr-policy.js` runs on
every pull request (`pr-policy` in CI) and fails when the body links no issue, when the label count
is not exactly one, or when the branch name does not follow the convention.
