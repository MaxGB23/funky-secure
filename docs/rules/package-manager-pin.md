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
| The root `package.json` exists and cannot be interpreted | `fail` | `unparseable-package-json` |
| `packageManager` names a versioned pnpm | `pass` | `pin-differs-from-machine` when the machine answers another version |
| `packageManager` is absent | `fail` | `pin-missing` |
| `packageManager` names pnpm and declares no version (`"pnpm"`, `"pnpm@"`) | `fail` | `pin-unversioned` |
| `packageManager` names npm, yarn or bun | `skip` | `not-pnpm` |
| `packageManager` names pnpm in a shape this rule cannot compare | `fail` | `pin-conflict` |
| `packageManager` differs and the project manages its own pnpm (`devEngines.packageManager`) | `skip` | `self-managed-pin` |
| `pnpm --version` did not answer | `skip` | `no-pnpm` |
| Machine facts are out of scope (`--scope repo`) | `skip` | `no-pnpm` |
| The root `package.json` is missing | `skip` | `no-package-json` |

**An unreadable manifest is a failure, not an absence.** A `package.json` that exists and cannot be
interpreted — a byte-order mark, truncated JSON, a document that is not an object — fails with
`unparseable-package-json`, and the message names the file and what is wrong with it:
`package.json starts with a byte-order mark (U+FEFF), which JSON does not allow, so the packageManager pin cannot be read`.
That check comes before every machine check, so no scope makes it a skip, and `--scope repo` cannot
turn an unreadable manifest into a passing run. A byte-order mark is said in its own words because it
is not a JSON syntax error, and a reader told "not valid JSON" would go looking for one that is not
there.

**A declaration that pins nothing fails.** `"packageManager": "pnpm"` names the manager and declares
no version, which is the state `pin-missing` describes: there is no pin. It is never `not-pnpm` — a
value that names pnpm is not evidence that the repository is on another manager, and saying so printed
`package.json declares pnpm, so this repository is not on pnpm` — so it is its own failure,
`pin-unversioned`. Its fix is manual only because `init --apply` never rewrites a declaration it
finds; that is a property of the remediation, not of the verdict.

`devEngines.packageManager` — the field npm enforces, where `packageManager` is the one npm ignores —
has three states, and this page names all three (0030). Declared and **equal to the pin** is a fact
this tool owns: `init --apply` writes the pin as W3 and the field as W3b in one plan (11.2), so the
rule can state that the two declarations agree — and when the answering pnpm matches the pin too, that
agreement is a `pass` instead of a skip. When the answering pnpm is another version the skip stands:
the probe runs outside the project, so it describes the machine while the project re-executes with
what it declares, and no remediation is offered, because rewriting a working pin to the auditing
machine's version is a downgrade (0020). Declared and **different** is `skip` with
`self-managed-pin`, because the project manages its own pnpm and the machine's pnpm is not evidence
about it. **Absent** is unchanged: the pin alone is the declaration, and nothing about it is skipped.

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

A manifest the rule could not interpret adds `problem` to that evidence: `byte-order-mark`,
`invalid-json` or `not-an-object`, so the class of defect is in the report and not only in the
sentence.

The executable path is evidence, not message text: a report body never carries an absolute path.

## Remediation

- `pin-missing` — `auto`: `funky-secure init --apply` performs write W3 (RFC 11.2) and sets
  `packageManager` to `"pnpm@<observed version>"`. The message names that exact value. Write W3 is the
  only path that touches the declaration: a pin that already exists is never rewritten.
- `pin-differs-from-machine` — `none`: the declaration is honoured inside the project, and the
  difference belongs to the machine. Nothing to fix, nothing to run.
- `not-pnpm` — `none`: the repository runs on another manager; the rules that need a pnpm repository
  already report the consequence.
- `pin-unversioned` — `manual`: set `"packageManager": "pnpm@<observed version>"` in `package.json`,
  and the message names that value, because "declare a version" is not an instruction without one.
  This one is a hand edit: write W3 fills an absent declaration and never rewrites one it finds.
- `pin-conflict` — `manual`: `corepack use pnpm@<observed version>`, only for a pnpm declaration this
  rule cannot compare. A value that exists and differs is never overwritten (RFC 4.3).
- `self-managed-pin` — `none`: pnpm 12 with `devEngines.packageManager` answers with the version the
  project declares, not the one on `PATH`. The probe runs outside the repository (0019), so a
  difference here is not evidence that the pin is wrong, and the rule never recommends a downgrade.
- `no-pnpm`, `no-package-json` — `none`: the rule cannot answer, so it does not recommend a write.
  A scope-contract skip is not a missing fact: it still names the command that answers the question
  (`funky-secure scan --scope all`), inside the message.
- `unparseable-package-json` — `none`: nothing is written to a file this rule could not read, and
  `plan()` refuses the same file for the same reason, so no plan item describes a write that cannot
  happen.

## Limits

The rule reads two fields of one file. It deliberately does not read corepack state, does not resolve
a version against a registry, does not inspect the lockfile and does not repair a conflicting pin.

**The field is a guard, not a wall.** `npm install --force` downgrades npm's check to a warning and
writes `package-lock.json`; a machine-level `pmOnFail`, or `--pm-on-fail` on the command line,
overrides the check on pnpm's side. npm 11.13.0 is the only version measured, and yarn and bun were
not measured at all, so what those managers do with the field is unknown rather than safe. On pnpm 11
the first resolve after the field appears records a `packageManagerDependencies` block in
`pnpm-lock.yaml`, so `--frozen-lockfile` fails until that resolve has run once: the printed path of
`start` already runs it, and a repository that ran `init --apply` alone needs one `pnpm install`
before CI is green (0030).

One failure is not about the pin: a manifest the rule cannot interpret is reported in its own words,
whatever the scope, because no machine fact makes a file readable. Every other row above is reached
only once a pnpm answered, so a `--scope repo` scan reports the out-of-scope `no-pnpm` skip instead;
`funky-secure scan --scope all` is the run that classifies the declaration, including the
`no-package-json` skip of a repository with no root manifest.

A repository deliberately on another manager is a `skip`, not a finding: a remediation that replaces a
deliberate manager with whatever the auditor's machine runs would be worse than the defect it came
from (0020). The documented override is `"rules": { "package-manager-pin": "off" }`, which stays
visible in `explain` instead of disappearing.
