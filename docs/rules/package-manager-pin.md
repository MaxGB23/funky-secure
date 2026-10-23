# package.json declares the pnpm that answers

Rule id: `package-manager-pin`

## Question

Does `package.json` declare the package manager, and does the declaration match the pnpm actually
answering?

## Detection

Reads `packageManager` from the root `package.json` and compares it with the version
`pnpm --version` reports.

| State | Status | Code |
|---|---|---|
| `packageManager` equals `pnpm@<observed version>` | `pass` | — |
| `packageManager` is absent | `fail` | `pin-missing` |
| `packageManager` names npm, yarn, bun, or another pnpm version | `fail` | `pin-conflict` |
| `pnpm --version` did not answer | `skip` | `no-pnpm` |
| Machine facts are out of scope (`--scope repo`) | `skip` | `no-pnpm` |
| The root `package.json` is missing or malformed | `skip` | `no-package-json` |

An unverifiable pin is not a wrong pin, so an unavailable version probe is a skip rather than a
failure; under `--strict-probes` the engine turns that skip into an error. A `--scope repo` scan
never probes the machine, so its skip is an out-of-scope fact and is not reported as an unavailable
required probe. Severity is `error` in both presets and friction is 0: the declaration is one line in
a file every Node repository has.

## Evidence

`{ declared, observed, executable }`:

- `declared` — the exact `packageManager` string, or `null` when it is absent.
- `observed` — the version `pnpm --version` reported, or `null` when it did not answer.
- `executable` — the path of the binary that answered, or `null`.

The executable path is evidence, not message text: a report body never carries an absolute path.

## Remediation

- `pin-missing` — `auto`: `funky-secure init --apply` performs write W3 (RFC 11.2) and sets
  `packageManager` to `"pnpm@<observed version>"`. The message names that exact value.
- `pin-conflict` — `manual`: `corepack use pnpm@<observed version>`. A value that exists and differs
  is never overwritten (RFC 4.3); the plan reports it as a conflict instead.
- `no-pnpm`, `no-package-json` — `none`: the rule cannot answer, so it does not recommend a write.

## Limits

The rule reads one field of one file. It deliberately does not read corepack state, does not resolve
a version against a registry, does not inspect the lockfile and does not repair a conflicting pin.

A repository deliberately on another manager is not a false positive of this rule: that is the
finding. The documented override is `"rules": { "package-manager-pin": "off" }`, which stays visible
in `explain` instead of disappearing.
