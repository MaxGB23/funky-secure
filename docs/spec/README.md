# Specification

This directory is what the code owes. It is the only document set that describes what is true **now**,
and it is edited freely: a behaviour change starts here, in its own pull request.

The record behind it — what was decided, in the order it was decided — is
[`rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md), frozen at revision 7. It
is never edited again. Where the two disagree, this directory wins and the record is corrected by a
dated `## Errata` entry, never by a rewrite.

Every section number in this repository (`10.3`, `11.2.1`, `8.2 R7`) is the citation used by code,
tests, commit messages and the decision log. The table below is that map: it says which file carries
each number now.

| § | Topic | Carried by |
|---|---|---|
| 1 | Context | record only |
| 2 | Problems with the current design | record only |
| 3 | Goals and non-goals | record only |
| 4 | Design principles | record only |
| 5 | Target architecture | record only — the code view is [`../architecture.md`](../architecture.md) |
| 6 | Identity and naming | [`identity.md`](identity.md) |
| 7 | Scope model and targets | [`scope.md`](scope.md) |
| 8 | Rule catalog | [`rules.md`](rules.md) |
| 9 | Policy model | [`policy.md`](policy.md) |
| 10 | Report contract | [`report.md`](report.md) |
| 11 | Command contracts | [`commands.md`](commands.md) |
| 12 | Machine scope contract | [`machine.md`](machine.md) |
| 13 | Help, documentation and the drift gate | [`documentation.md`](documentation.md) |
| 14 | Repository and package layout | [`layout.md`](layout.md) |
| 15 | Testing and validation plan | record only — the suite is the plan |
| 16 | Implementation plan | record only — history of how it was built |
| 17 | Delivery and release | [`../delivery.md`](../delivery.md) |
| 18 | Relationship with funky-ai | record only |
| 19 | Risks | record only |
| 20 | Resolved design questions | record only — the answers live in [`../decisions.md`](../decisions.md) |
| 21 | Acceptance criteria | record only — one release's definition of done |

Appendices A–E and the closing note stay in the record: a decision log, the evidence a defect existed,
the measured environment, output examples of that revision, and the empirical validation results.

## Rules

The contract for each rule is section 8.2 of [`rules.md`](rules.md). The page a user reads about a rule
— why it exists, what its finding means, how to fix it — is [`../rules/<id>.md`](../rules/), and each
page names the spec as its normative source. Both are kept: the spec states the obligation, the page
explains it.

## Amendments

Where a change belongs, as opposed to which section carries what, is the [documentation map](../README.md).

A section leaves the verbatim comparison the moment a later record replaces its contract: the record
stays frozen, and this directory becomes the authority for the new text. One section may be amended
more than once, by more than one record, so a row is an amendment and not a section: the rule the
drift gate enforces follows the registry instead of a hard-coded list — every amendment must name a
record that exists and is not still a `draft`, and the file must keep its section heading so the
number keeps resolving.

| § | Record | What it replaced |
|---|---|---|
| 9 | [`0003`](../../rfcs/0003-first-ten-minutes/rfc.md) | 9.1: the `starter` preset, the six rules it keeps and the six it turns `off`, and the quarantine floor it keeps |
| 10 | [`0002`](../../rfcs/0002-human-output-v2/rfc.md) | the human report: three-line findings, header order, labels instead of ids, `--verbose`, the 96-column bound |
| 10 | [`0003`](../../rfcs/0003-first-ten-minutes/rfc.md) | 10.3: the `not run` line, so a reduced preset states the coverage it does not have |
| 10 | [`0006`](../../rfcs/0006-human-defaults/rfc.md) | 10.3: the four shapes — document, narration, numbered plan, table — the question each answers, what they share, and what a narration line may borrow from a finding |
| 11 | [`0002`](../../rfcs/0002-human-output-v2/rfc.md) | `scan --verbose` in the synopsis, and its contract as human presentation that changes no JSON byte |
| 11 | [`0003`](../../rfcs/0003-first-ten-minutes/rfc.md) | 11.1 and 11.2: `--preset starter` in both synopses; 11.7: the `start` command |
| 11 | [`0004`](../../rfcs/0004-agent-skill/rfc.md) | 11.8: the `skill` command — the shipped file on stdout, the destination hint on stderr, and no repository fact read |
| 11 | [`0005`](../../rfcs/0005-skill-install/rfc.md) | 11.8: `--install`, `--user`, `--force`, `--keep` and the question asked before a replacement; 11.5 point 7 and 11.6: the one write outside the repository |
| 11 | [`0006`](../../rfcs/0006-human-defaults/rfc.md) | 11.4: a missing rule id is not an error — the bare `explain` prints the catalog, and `--list` is the explicit synonym with identical output |
| 8 | [`0007`](../../rfcs/0007-remediation-routes/rfc.md) | 8.2 R5: the pin is `pnpm pkg set` with a bracketed property path, because a dot path cannot carry a scoped name, and `pnpm add --save-exact` is not the remediation on pnpm 12.3.4 |
| 8 | [`0007`](../../rfcs/0007-remediation-routes/rfc.md) | 8.2 R4: the manual quarantine route names the file the value lands in — `pnpm-workspace.yaml`, never an `.npmrc` |
| 10 | [`0008`](../../rfcs/0008-refusal-honesty/rfc.md) | 10.4: a fourth exit code, `3`, for a refusal — understood, refused, nothing written — so a policy decision never shares the code of a question the tool could not answer |
| 10 | [`0008`](../../rfcs/0008-refusal-honesty/rfc.md) | 10.3: the verdict line carries the number of rules it did not verify, and stays byte-identical when that number is zero |
| 11 | [`0009`](../../rfcs/0009-gate-before-resolve/rfc.md) | 11.7: the steps of `start` — the block first, then one install under it, then the removal, because `migrate --apply` needs the lockfile the install writes |
| 8 | [`0010`](../../rfcs/0010-remediation-conformance/rfc.md) | 8.2 R2: `git add -f` when an ignore rule also matches the untracked lockfile, because a plain `git add` cannot stage an ignored path |
| 8 | [`0010`](../../rfcs/0010-remediation-conformance/rfc.md) | 8.2 R8: the remediation is printed from the action and the ref the finding carries, not from a generic `owner/repo` template |
| 11 | [`0010`](../../rfcs/0010-remediation-conformance/rfc.md) | 11.7: the commit step, because `init --apply` refuses to write over an uncommitted tree |
| 11 | [`0011`](../../rfcs/0011-pin-command/rfc.md) | 11.9: the `pin` command — the plan, the write, the three limits and the exit codes |
| 11 | [`0012`](../../rfcs/0012-lockfile-lists/rfc.md) | 8.2 R5: ignored lockfile sections are checked at the first level, and a legal list inside one is not a refusal |
| 10.4, 11.5, 11.9 | [`0013`](../../rfcs/0013-scenario-findings/rfc.md) | 10.4/11.5: a refusal that cannot ask is a refusal, not a failure; 11.9: the pin summary counts a manifest already at policy |

## Changing the contract

1. Open a pull request against the file this table names, not against the record.
2. If the change introduces behaviour the record never decided, write the next record first —
   see [`../../rfcs/README.md`](../../rfcs/README.md).
3. If the change contradicts something the record decided, the record is corrected with a `## Errata`
   entry that names what was wrong and what replaced it.
4. Run the suite: `tests/drift.test.js` fails when this table stops covering the record, when an
   amendment names a record that is missing or still a `draft`, when a rule page disappears, or when a
   flag loses its documentation.
