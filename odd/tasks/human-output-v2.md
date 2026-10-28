# Human output v2 (option B)

Make the human report readable without the catalog: one finding is three lines, the verdict sits at the top, the rule id moves to `--verbose`, and no line exceeds 96 columns. Tracked as T1-T3 on branch `feat/human-output-v2`; no pull request, the owner reviews the branch first.

## Specs

S1. **Three lines per finding.** A heading line carries the symbol, a short human label and the location (`✖  Lockfile  ·  pnpm-lock.yaml`); the message is indented five columns and wraps with a hanging indent; the action is `→ <command>` at the same five columns. No finding ever shares a line with another finding or with an id.

S2. **`summary` and `verdict` move to the header, keeping their names.** One header block: the title line, the provenance line, `summary  <counts>`, `verdict  FAIL|PASS (threshold: …)`, then a separator of 90 `─`. Both labels keep their nine-character gutter, so a reader who greps them is not broken by the move.

S3. **A `label` per rule.** Short noun phrase naming the subject of the finding, in the catalog beside `title`, used by the human `scan`. `title` stays where it belongs — `--help` and `explain`, where a rule is being explained rather than reported. The catalog remains the single source: no second list anywhere.

S4. **The rule id is not shown to humans by default.** It remains in the JSON document, in `--help`, in `explain` and in `scan --verbose`. Adding `--verbose` is part of this change: it is the one flag that recovers every id, the per-rule skip reason, and the machine block's binary path.

S5. **Width is bounded.** No rendered line exceeds 96 columns. Messages and actions wrap, never truncate. The single exception is a machine path — store, executable — which is shortened in the middle with `…`, because its length is not ours to bound and truncating at a fixed point stays deterministic.

S6. **A clean target is one line.** When a target has nothing to report, its block is `KIND   all N rules pass`. When it has findings, the heading is `KIND` alone. Passing findings are never listed by id in the default output.

S7. **Skips collapse by target.** A target with two or more skipped rules prints one line naming the labels that were not verified and the command that expands them (`--verbose`); a target with exactly one prints that rule's own block, symbol `–`, so the reason and its verifying command are visible without a flag. The JSON is untouched.

S8. **The machine block stops leaking the binary path.** `pnpm <version>  ·  store <path>` stays; the executable path and the installation list move to `--verbose` and stay in the JSON, which removes the 189-column line measured on the owner's machine.

S9. **The contract is recorded before the code ships.** Report contract 10.3 and command contract 11.1 change in `docs/spec/`, a new record `rfcs/0002-human-output-v2/` carries the decision, and 10.3 gains one sentence: the JSON is the contract, the human text is presentation and may change in a minor while staying valid on its own.

S10. **Nothing else moves.** Exit codes, the JSON document, rule severities, messages, ordering and the `next` block keep their current contract; the goldens under `tests/golden/` must show zero diff.

## Tasks

| ID | Spec | Work | Commit |
|---|---|---|---|
| T1 | S3, S4 | `label` on the 12 rules, catalog test asserting one per rule, `--verbose` flag parsed and documented | `0154f56` |
| T2 | S1, S2, S5, S6, S7, S8 | Renderer rewritten, tests per shape, width gate, captures in `docs/cli.md` and `docs/guide.md` | `bcf807e`, plus the docs work below |
| T3 | S9 | Spec 10.3 and 11.1, RFC 0002 record, decision rows | next commit |

## Log

L1 (verbatim): "me gusta tu propuesta, implementala sin pr, quiero revisar todo antes"

L2 (decision, parent): the approved plan is the requirement source; no spec is invented beyond what that plan listed. The version bump to 0.5.0 is deliberately left for after the owner's review, because it regenerates the goldens and would mix presentation work with release bookkeeping.

L3 (finding, parent): `--verbose` does not exist today — the plan assumed it did. It is added by T1
rather than simulated by a second flag name, so S4 and S8 have somewhere to put what they remove
from the default output.

L4 (finding, worker): S9 broke a gate that was too strong from birth. `tests/drift.test.js` asserted
every spec file was a verbatim slice of the frozen record for ever, which is only true until a later
record replaces the contract. The worker stopped instead of editing a surface it did not own.

L5 (decision, parent, 2026-10-28): a section leaves the verbatim comparison when `docs/spec/README.md`
lists it in a new **Amendments** table naming the record that replaced it, and the gate follows the
registry: it requires the named record to exist and not to be a `draft`, and it still requires every
file to keep its section heading so the number keeps resolving. Sections 10 and 11 are amended by
RFC 0002; the other seven keep the verbatim comparison. No exemption list is hard-coded in the test.

L6 (review, parent): the surviving sentence "a skipped rule states what was not verified and the
command that verifies it" contradicted the collapse in the same section. It now says where that
obligation moves when skips collapse: behind `--verbose`, named by the collapsed line.

L7 (open): the version bump to 0.5.0 and the two diagram strings are deliberately not in this branch.

L8 (dogfooding, parent): building the tour (`M:/pruebas/cli-tour`) surfaced a rule defect that is
not this feature s: `no-bot-auto-merge` (R9) also reports `pr-target-head-checkout` with R14 s
own message (`src/rules/no-bot-auto-merge.js:200`), so one hazard in one workflow step produces two
findings under two different labels, and the summary counts it twice. With labels now visible the
duplication is obvious in a way the ids hid. It needs a rule-semantics decision and its own record;
nothing in this branch changes it.
