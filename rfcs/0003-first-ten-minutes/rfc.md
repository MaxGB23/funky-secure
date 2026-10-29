# RFC 0003 — The first ten minutes

| | |
|---|---|
| **Status** | `accepted` — agreed by the owner before the work; `start`, the `starter` preset and the `not run` line ship on branch `feat/start`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/policy.md` §9.1](../../docs/spec/policy.md) for the preset, [`docs/spec/report.md` §10.3](../../docs/spec/report.md) for the `not run` line, [`docs/spec/commands.md` §11.7](../../docs/spec/commands.md) for the command. |
| **Supersedes** | nothing. It adds a preset, a line and a command to the contract RFC 0001 established, and leaves `baseline`, `strict` and the JSON document untouched. |
| **Superseded by** | nothing. |

> **How to read this file.** It records what was decided and why, once. The contract it established
> lives in `docs/spec/`, which is what the code owes and the only place that is edited from now on.

## Context

The zero state was measured on an empty git repository, and it had no correct path. `init` wrote the
workspace block and the ignore block but could not pin anything — there is no `package.json` to carry
`packageManager` — and its `next steps` said `pnpm install`, which fails in a directory with no
manifest. `scan` then reported the missing lockfile as an error, from a repository that had no way to
produce one yet.

The order was wrong as well as incomplete. `savePrefix: ''` and `minimumReleaseAge` are read by an
install; an install that happens before the block exists never sees them. The steps a new repository
needs are therefore a sequence, not a checklist, and the product had no place to say so: `init`
answers *what do I write*, and nothing answered *what do I run first*.

Two sentences framed the work, both verbatim in the feature record's log: a new command rather than a
flag ("sería un comando nuevo el start? ya que no me gusta init --starter, creo que confundiría"),
and what a new project actually needs — a pnpm lockfile, no carets, a minimum release age, "y poco
mas".

## Decision

- **A fifth command, `start` (11.7).** Read-only, no flags beyond `--help`, exit `0` in every state
  and `2` only for a usage error. It prints the steps that still apply, numbered from `1`, in cause
  order: `git init`, `pnpm init`, `funky-secure init --apply` with the number of writes it is holding,
  `pnpm add <your first dependency>`, and `funky-secure scan --preset starter` last. It closes with
  `why this order` and the same `not run` block the report prints. A repository past the start is told
  so in one line instead of being handed a stale checklist.
- **One engine, two presentations (11.7).** `start` reads the same collection and the same write plan
  `scan` and `init` use, and computes no fact of its own. A second engine with its own view could
  contradict the report about the same repository.
- **A `starter` preset (9.1).** Exactly five rules at the severities they already carry in
  `baseline` — `package-manager-pin`, `lockfile-committed`, `quarantine`, `exact-versions`,
  `sensitive-ignored` — and the other seven `off`. `quarantineFloor('starter')` is the manager's
  default, never the `4320` of `strict`. `baseline` and `strict` do not change, and an added catalog
  rule is `off` under `starter` until the preset says otherwise.
- **A `not run` line in the human report (10.3).** When the effective policy sets at least one rule
  `off`, the header states how many rules run, out of how many, and names the ones that do not, in
  catalog order, in the nine-character gutter between `verdict` and the separator. It wraps at 86
  columns. It never prints because of `--only` or `--ignore`, and the JSON document gains nothing:
  a machine reader already has `policy.preset` and the counts that preset produced.

## Alternatives rejected

- **`init --starter`.** A flag would make one command answer two questions and would put a preset
  choice where the reader expects a write plan. The owner named the confusion directly, and the two
  answers stay apart: `init` says what is written, `start` says what to run.
- **`start` writing the block it recommends.** Every writer is a security surface — `validateWriteTarget`,
  the digest, the dirty-tree refusal — and a second one doubles the review load without adding a
  capability: `start` names `funky-secure init --apply`, which already does it. One writer, one
  surface.
- **A sixth rule in the starter set, `env-not-tracked`.** It reports an environment file that is
  already tracked, which is a day-two repair: a repository created minutes ago cannot have one. The
  day-zero half is `sensitive-ignored`, and keeping the sixth rule out also keeps the preset to the
  rules the owner named. Both are visible in the same line, so nothing is hidden by the choice.
- **A coverage field in the JSON document.** It would be a field with its own consumers and its own
  compatibility promise, decided in a report contract this record does not otherwise touch. A reader
  that wants the coverage has `policy.preset` and the counts; a machine-readable field is a separate
  record.

## Consequences

- A fifth command is new CLI surface: a dispatch entry, help text, a docs page, a flow diagram and a
  spec section that all have to agree. The drift gate now enforces the last two.
- The suite gains a command gate: a command in `COMMANDS` without its `### \`<name>\`` section in
  `docs/cli.md` or without its flow in `docs/architecture.md` fails the build, so `start` cannot be
  added in code alone.
- A reduced preset now has to state its own coverage. Any future preset that turns rules `off`
  inherits the `not run` line, and a report that does not state what it did not check is a defect
  rather than a presentation choice.
- `docs/spec/README.md` now carries two amendments for sections 10 and 11 and one for 9, and the
  amendments gate verifies every record a row names instead of only the last one per section.
- The human report gains one line and the JSON document is byte-identical, so `tests/golden/` shows
  zero diff.

## Acceptance

The work is done when the suite shows all of these:

- `tests/policy.test.js` — `starter` runs exactly the five rules, at their `baseline` severity, with
  every other rule `off`; `quarantineFloor('starter')` is the manager default and not `4320`;
  `baseline` and `strict` resolve exactly as they did before.
- `tests/report.test.js` — the `not run` line prints between `verdict` and the separator, in the
  gutter, in catalog order, wrapped at 86 columns; it is absent when no rule is `off`; `--only` and
  `--ignore` never produce it; the JSON document is unchanged.
- `tests/start.test.js` — every state of the path, from an empty directory to a repository past the
  start: the printed steps, their order, the numbering, the `why this order` block, the `not run`
  block, exit `0` throughout, and not one file written or modified.
- `tests/drift.test.js` — a command in `COMMANDS` has its `docs/cli.md` section and its
  `docs/architecture.md` flow; the amendments table names only records that exist and are not drafts.
- `node --test` passes, and `node bin/funky-secure.js scan --scope repo --fail-on warn` exits `0` on
  this repository.

## Amendment — 2026-10-28

Two gaps were measured on repositories a framework generator produced, after this record's work
shipped on `feat/start`. The branch is still open, so the record is amended here instead of being
superseded; nothing above changes, and this section states what the record now says.

**What was measured.** A project from `npm create next-app` has a manifest, an app directory, a
`.gitignore` and `package-lock.json`, and no `pnpm-lock.yaml`. `funky-secure start` answered it with
`pnpm add <your first dependency>` as step 2, which is wrong advice there: the add writes a second
lockfile beside the npm one. The same repository was told, by `--preset starter`, that
`foreign-lockfile` was `off` — the only rule that says another package manager still shapes the
repository was the one a framework beginner never saw. The same shape with `pnpm-lock.yaml` in place
of `package-lock.json` was already answered correctly.

**What changed.** The `starter` set of the Decision is six rules, not five: `foreign-lockfile` joins it
at the `warn` it already carries in `baseline`, and the other six rules stay `off`. The honesty line
therefore reads `not run  6 of 12 rules` and names six rules, not seven. `baseline` and `strict` do
not change at all. `start`'s path gains one conditional step: while a foreign lockfile is present it
prints `funky-secure migrate` before `funky-secure init --apply`, because the posture is written once
the repository has one package manager, and it does not print the first add, because adding now would
write a second lockfile; a `pnpm-lock.yaml` that appears during the migration is the migration's
business, not that step's. `why this order` grows by one line, and only in that state. The fact is read
from the repository presence list the collector already resolved, so the "no probe, no dependency"
promise of 11.7 holds.

**What did not change.** `start` still writes nothing, still exits `0` in every state, still derives
everything from the same collection and the same plan, and still names `starter` last. The JSON
document gains nothing (10.2), and `--only` / `--ignore` still never produce the `not run` line.

**Why the set, not the severity.** Adding the rule at its `baseline` severity keeps the preset a
reduced `baseline`: nothing becomes louder, and a repository that wants the whole catalog can run
`baseline` (default) or `strict`. Leaving it out would have kept the preset quiet about the one fact
that shapes a framework-generated repository, which is the opposite of what a day-zero preset is for.

**Evidence.** `tests/policy.test.js` asserts the active set is exactly the six ids and that
`baseline` and `strict` resolve as before; `tests/start.test.js` asserts the npm-shaped path
(`migrate` before `init --apply`, no `pnpm add`, exit `0`, continuous numbering) and the pnpm-shaped
path (neither step, continuous numbering). The suite passes and
`node bin/funky-secure.js scan --scope repo --fail-on warn` exits `0` on this repository.
