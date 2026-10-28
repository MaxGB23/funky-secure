# RFC 0002 — Human output v2

| | |
|---|---|
| **Status** | `accepted` — agreed by the owner before the work; the renderer and the `label` field ship on branch `feat/human-output-v2`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/report.md` §10.3](../../docs/spec/report.md) for the report, [`docs/spec/commands.md` §11.1](../../docs/spec/commands.md) for the flag. |
| **Supersedes** | nothing. It changes a contract RFC 0001 established, without restating the record: 10.3 as revision 7 wrote it is replaced by the section the spec carries now. |
| **Superseded by** | nothing. |

> **How to read this file.** It records what was decided and why, once. The contract it established
> lives in `docs/spec/`, which is what the code owes and the only place that is edited from now on.

## Context

The human report of v0.4 groups findings by target, prints one finding per line with the rule id
inline, and puts `summary`, `verdict` and `next` at the bottom. Two things follow, and both were
measured on the owner's own runs rather than argued:

- **The reader needs the catalog.** `✖ sensitive-ignored  .gitignore  .env, .env.local, … are not
  ignored by git` names the rule with an identifier that means nothing until the reader has
  memorised twelve of them, and the location, the message and the action share one line, so a long
  message pushes the action out of view.
- **The width is unbounded.** A `--scope machine` report printed a fact line of 189 columns, because
  the installation list and the resolved executable path were inlined. A line that wide does not wrap
  in a terminal, a diff or a review comment.

The product's own rule for a report (4.6, 10.3) is that a finding is actionable on its own: it names
the file, the line and the action. Naming the rule with a string only the tool understands is the
one place where that rule was not kept, and no width bound was kept at all.

## Decision

A human report must answer three questions from its own text, in the order a reader asks them: **what
is wrong**, **in which file**, and **what command fixes it**. Everything below follows from that
sentence.

- **One finding is three lines.** Heading: the severity symbol, the rule's short human label, and the
  location (`path`, or `path:line`). Then the message, indented five columns and wrapped with a
  hanging indent. Then the action, `→ <command>`, at the same five columns. No finding shares a line
  with another finding or with an id.
- **A `label` per rule, in the catalog, beside `title`.** A short noun phrase naming the subject of
  the finding (`Lockfile`, `Sensitive files`). `title` stays where a rule is explained — `--help` and
  `explain` — because it is a statement about the repository, not the name of a finding. The catalog
  remains the single source; no second list of names exists.
- **The rule id moves out of the default output.** It stays in the JSON document, in `--help`, in
  `explain`, and behind a new `--verbose` flag, which is also where the per-rule skip reason and the
  machine block's binary path go. The id is a name for the tool and the JSON is the machine contract;
  the flag is the one place that recovers it for a human who wants it.
- **`summary` and `verdict` move to the header and keep their names.** The header is the title, the
  provenance, `summary`, `verdict`, then a separator of 90 `─`. Both labels keep their
  nine-character gutter, so a reader or a script that greps them is not broken by the move, and the
  counts arrive before the evidence.
- **A clean target is one line** — `CI   all 5 rules pass` — and passing rules are never listed one
  per line by default.
- **Skips collapse by target.** Two or more skipped rules print one line naming the labels that were
  not verified and the command that expands them. A target with exactly one skipped rule keeps that
  rule's own block, because one reason and its verifying command fit in three lines and a flag should
  not be required to read them.
- **Width is bounded at 96 columns.** Messages and actions wrap, never truncate. The only shortened
  value is a machine path — store, executable — cut in the middle with `…`, because its length is not
  the tool's to bound and a fixed cut point stays deterministic.
- **Nothing else moves.** Exit codes, the JSON document, severities, messages, ordering and the
  `next` block keep their contract, and `tests/golden/` shows zero diff.

## Alternatives rejected

- **`label` would be the `title` verbatim.** Titles are claims about the repository, several of them
  longer than the space a heading has (`CI does not disable the frozen lockfile or re-enable
  lifecycle scripts`), so a heading built from one reads as a sentence fragment and doubles in
  length. A heading needs a subject; the title answers a question.
- **Keeping the id inline.** It would leave two names for the same rule on every heading, and the
  reader still translates one of them. The id is not the finding; the file and the action are.
- **Truncating messages instead of wrapping.** It meets the width bound by deleting the fact the
  reader came for. Wrapping keeps every word and still bounds the line.
- **A `--format human-v2` flag.** It makes a presentation a contract of its own, keeps the old shape
  forever for anyone who does not pass the flag, and asks a reader to know the flag exists before
  they can read the report they already ran. A presentation that needs a flag to be readable is not
  a presentation.

## Consequences

- Anything that grepped the human text for a rule id sees ids only with `--verbose`. That is stated,
  not implied: the documented contract for a machine consumer is the JSON document (10.2), and
  `summary` and `verdict` keep their names and gutter so the common grep still lands.
- The JSON document is byte-identical with and without `--verbose`, and `tests/golden/` is untouched.
  The version bump is deliberately deferred until after the owner's review, because it regenerates
  the goldens and would mix presentation work with release bookkeeping.
- `--verbose` is new surface: a flag with one meaning, no JSON byte, and no count of its own.
- A rule without a label would render its id. The catalog test asserts one label per rule, unique
  across the catalog, at most 28 columns and free of emoji, so the fallback stays a rendering safety
  net and never a state the catalog is allowed to be in.
- The human text is now explicitly presentation: a minor release may change it as long as the report
  remains valid on its own (10.3).
- `docs/spec/` is a verbatim slice of the frozen record (I-23, I-24), and §10.3 and §11.1 are that
  text as amended here. The drift gate was written for the extraction and not for the next
  contract, so it still requires every mapped file to appear inside the record: a section a later
  record supersedes is exempt from that comparison, or no contract can change without editing
  history that is frozen.

## Acceptance

The work is done when the suite shows all of these:

- `tests/report.test.js` — a finding renders as heading, message and action, and names its label
  instead of its id; `summary` and `verdict` keep their gutter at the top with `next` last; no
  rendered line exceeds 96 columns even with a long machine path; a clean target is one line; a
  single skipped rule keeps its block while two or more collapse; `--verbose` restores the ids, the
  skip reasons and the passing rules; two runs over the same state print the same bytes.
- `tests/drift.test.js` — every catalog rule carries a unique, emoji-free label, `--help` still lists
  every rule id and every flag, and the flag list still matches `docs/cli.md`.
- `tests/golden/` — zero diff: the JSON document is the same document it was.
- `docs/spec/report.md` §10.3 and `docs/spec/commands.md` §11.1 state the contract the code now
  keeps, and `docs/cli.md` and `docs/guide.md` carry captures taken from real runs.
- `node --test` passes, and `node bin/funky-secure.js scan --scope repo --fail-on warn` exits `0` on
  this repository.
