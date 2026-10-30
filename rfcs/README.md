# RFC registry

An RFC is the **record of a decision**, not the description of the product. It is written before the
work, and once it reaches `implemented` or `closed` its body is frozen: history that is edited is not
history. What is true *now* lives in [`../docs/spec/`](../docs/spec/README.md), which is the only
document that changes without a new record.

| # | Title | Status | Supersedes | Superseded by | Present contract |
|---|---|---|---|---|---|
| [0001](0001-funky-secure-v1/rfc.md) | funky-secure as a supply-chain auditor and initializer | `implemented` | — | — | [`docs/spec/`](../docs/spec/README.md) |
| [0002](0002-human-output-v2/rfc.md) | Human output v2 | `accepted` | — | — | [`docs/spec/report.md`](../docs/spec/report.md) §10.3, [`docs/spec/commands.md`](../docs/spec/commands.md) §11.1 |
| [0003](0003-first-ten-minutes/rfc.md) | The first ten minutes | `accepted` | — | — | [`docs/spec/policy.md`](../docs/spec/policy.md) §9.1, [`docs/spec/report.md`](../docs/spec/report.md) §10.3, [`docs/spec/commands.md`](../docs/spec/commands.md) §11.7 |
| [0004](0004-agent-skill/rfc.md) | An agent skill | `accepted` | — | — | [`skills/funky-secure/SKILL.md`](../skills/funky-secure/SKILL.md) |
| [0005](0005-skill-install/rfc.md) | Installing the skill | `accepted` | — | — | [`docs/spec/commands.md`](../docs/spec/commands.md) §11.5 point 7, §11.8 |
| [0006](0006-human-defaults/rfc.md) | Human defaults | `accepted` | — | — | [`docs/spec/commands.md`](../docs/spec/commands.md) §11.4 |
| [0007](0007-remediation-routes/rfc.md) | Remediation routes | `implemented` | — | — | [`docs/spec/rules.md`](../docs/spec/rules.md) §8.2 R5, §8.2 R4 |
| [0008](0008-refusal-honesty/rfc.md) | Refusal and verification honesty | `implemented` | — | — | [`docs/spec/report.md`](../docs/spec/report.md) §10.4, §10.3 |
| [0009](0009-gate-before-resolve/rfc.md) | The gate precedes the first resolve | `implemented` | — | — | [`docs/spec/commands.md`](../docs/spec/commands.md) §11.7 |
| [0010](0010-remediation-conformance/rfc.md) | Remediation conformance | `implemented` | — | — | [`docs/spec/rules.md`](../docs/spec/rules.md) §8.2 R2, R8; [`docs/spec/commands.md`](../docs/spec/commands.md) §11.7 |
| [0011](0011-pin-command/rfc.md) | `pin` | `implemented` | — | — | [`docs/spec/commands.md`](../docs/spec/commands.md) §11.9 |
| [0012](0012-lockfile-lists/rfc.md) | Lists inside ignored lockfile sections | `implemented` | — | — | [`docs/spec/rules.md`](../docs/spec/rules.md) §8.2 R5 |
| [0013](0013-scenario-findings/rfc.md) | What the scenarios found | `implemented` | — | — | [`docs/spec/commands.md`](../docs/spec/commands.md) §10.4, §11.5, §11.9 |
| [0014](0014-peer-suffix/rfc.md) | The version and its peer suffix | `implemented` | — | — | [`docs/spec/rules.md`](../docs/spec/rules.md) §8.2 R5; [`docs/spec/commands.md`](../docs/spec/commands.md) §10.4 |
| [0015](0015-followable-start/rfc.md) | The start that can be followed | `implemented` | — | [`0009`](0009-gate-before-resolve/rfc.md) | [`docs/spec/commands.md`](../docs/spec/commands.md) §11.7 |
| [0016](0016-close-the-loop/rfc.md) | Close the loop | `implemented` | — | [`0015`](0015-followable-start/rfc.md) | [`docs/spec/commands.md`](../docs/spec/commands.md) §11.7 |

## Layout

```
rfcs/
  README.md                    this registry
  0001-funky-secure-v1/
    rfc.md                     the record
    evidence/                  measurements, diagrams and excerpts it rests on
  0002-human-output-v2/
    rfc.md                     the record
  0003-first-ten-minutes/
  0004-agent-skill/
  0005-skill-install/
    rfc.md                     the record
  0006-human-defaults/
    rfc.md                     the record
```

A record owns its evidence: anything a decision was argued from — a measurement, a diagram, an
excerpt of a machine — belongs beside it, not in `docs/images/`, which holds what ships with the
package.

## Status

| Status | Means | Editable |
|---|---|---|
| `draft` | being argued | yes, freely |
| `accepted` | agreed, not built yet | no; a change is a new record |
| `implemented` | the code satisfies it and it still explains the code | no |
| `closed` | its contract has moved to `docs/spec/`; it is a historical record | never |
| `superseded` | replaced by a later record, linked in both directions | never |

`implemented` and `closed` are deliberately not the same word: `implemented` says "the code does
this, read it to understand why", and `closed` says "nothing points here for truth any more".

## Starting a record

1. Number it `NNNN-<slug>` with the next free number, zero-padded, four digits. A number is never
   reused and a slug is never renamed, because citations outlive the author's taste.
2. Write `rfc.md` with a status table at the top: `Status`, `Revision`, `Present contract`,
   `Supersedes`, `Superseded by`.
3. Open it as `draft`. It becomes `accepted` when this repository's owner agrees, and that is the
   last moment its body may be rewritten.
4. When the work merges, the contract it establishes moves into `docs/spec/` — moved, not reworded —
   and the record is marked `implemented`. It becomes `closed` when nothing cites it for truth.

## Correcting a frozen record

The body is never rewritten. A correction is either a new record that supersedes it, or a dated
`## Errata` section appended at the end, naming what was wrong and what replaced it. Appending is
allowed; editing what a previous reader could have relied on is not.
