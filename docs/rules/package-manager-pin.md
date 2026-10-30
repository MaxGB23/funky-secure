# package.json declares the pnpm that answers

Rule id: `package-manager-pin`

## Question

Does `package.json` declare the package manager, and does the declaration match the pnpm actually
answering?

## Detection

Reads `packageManager` from the root `package.json`. A versioned pnpm declaration is the authority:
pnpm re-executes itself to honour it, so inside the project the answering version is the declared one
and the version on the machine's `PATH` is evidence rather than a verdict (0024).

| State | Status | Code |
|---|---|---|
| `packageManager` names a versioned pnpm | `pass` | `pin-differs-from-machine` when the machine answers another version |
| `packageManager` is absent | `fail` | `pin-missing` |
| `packageManager` names npm, yarn or bun | `skip` | `not-pnpm` |
| `packageManager` names pnpm in a shape this rule cannot compare | `fail` | `pin-conflict` |
| `packageManager` differs and the project manages its own pnpm (`devEngines.packageManager`) | `skip` | `self-managed-pin` |
| `pnpm --version` did not answer | `skip` | `no-pnpm` |
| Machine facts are out of scope (`--scope repo`) | `skip` | `no-pnpm` |
| The root `package.json` is missing or malformed | `skip` | `no-package-json` |

An unverifiable pin is not a wrong pin, so an unavailable version probe is a skip rather than a
failure; under `--strict-probes` the engine turns that skip into an error. A `--scope repo` scan
never probes the machine, so its skip is an out-of-scope fact and is not reported as an unavailable
required probe: the message says the pin was not compared with the pnpm that answers and names the
command that verifies it (S6), `funky-secure scan --scope all`. Severity is `error` in both presets
and friction is 0: the declaration is one line in a file every Node repository has.

## Evidence

`{ declared, observed, executable }`:

- `declared` — the exact `packageManager` string, or `null` when it is absent.
- `observed` — the version `pnpm --version` reported, or `null` when it did not answer.
- `executable` — the path of the binary that answered, or `null`.

The executable path is evidence, not message text: a report body never carries an absolute path.

## Remediation

- `pin-missing` — `auto`: `funky-secure init --apply` performs write W3 (RFC 11.2) and sets
  `packageManager` to `"pnpm@<observed version>"`. The message names that exact value. Write W3 is the
  only path that touches the declaration: a pin that already exists is never rewritten.
- `pin-differs-from-machine` — `none`: the declaration is honoured inside the project, and the
  difference belongs to the machine. Nothing to fix, nothing to run.
- `not-pnpm` — `none`: the repository runs on another manager; the rules that need a pnpm repository
  already report the consequence.
- `pin-conflict` — `manual`: `corepack use pnpm@<observed version>`, only for a pnpm declaration this
  rule cannot compare. A value that exists and differs is never overwritten (RFC 4.3).
- `self-managed-pin` — `none`: pnpm 12 with `devEngines.packageManager` answers with the version the
  project declares, not the one on `PATH`. The probe runs outside the repository (0019), so a
  difference here is not evidence that the pin is wrong, and the rule never recommends a downgrade.
- `no-pnpm`, `no-package-json` — `none`: the rule cannot answer, so it does not recommend a write.
  A scope-contract skip is not a missing fact: it still names the command that answers the question
  (`funky-secure scan --scope all`), inside the message.

## Limits

The rule reads one field of one file. It deliberately does not read corepack state, does not resolve
a version against a registry, does not inspect the lockfile and does not repair a conflicting pin.

A repository deliberately on another manager is a `skip`, not a finding: a remediation that replaces a
deliberate manager with whatever the auditor's machine runs would be worse than the defect it came
from (0020). The documented override is `"rules": { "package-manager-pin": "off" }`, which stays
visible in `explain` instead of disappearing.
