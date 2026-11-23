# RFC 0040 — the rule the plan states

| | |
|---|---|
| **Status** | `accepted` — the owner decided on issue #542 that the `-C` rule #535 shipped is recorded by a record of its own, with the amendment row §11.7 never had. It lands with the spec it names, which is the shape the registry already carries for `0032`, `0038` and `0039`, so it is `accepted` and not `draft`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.7, the sixteen rows of the plan and the paragraph that says where each of them is read. |
| **Supersedes** | nothing. |
| **Superseded by** | nothing. |
| **Amends** | nothing. It states the rule §11.7 already carries, and no byte of the spec moves with it. |

## What is true today

§11.7 states where a printed step is read (`docs/spec/commands.md:299-315`):

> The table states each command as it is printed at the repository root, which is where the plan
> derived there is pasted. … Two halves move, and only these rows do.

Nine of the sixteen rows move, and the spec names each group by number: rows 5, 10, 14 and 15 rebase
every `git add` path against the directory the step is pasted in, and rows 2, 6, 7, 9 and 13 name the
project with `-C <the repository root, from here>`. The other seven print the same bytes wherever they
are asked from, and at the root every row prints as the table states it, with no `../` and no `-C`.

The mechanism behind those rows is recorded, in one place, as `I-94` (`docs/decisions.md:139`): the
rebase is `pathsAtCwd` with its root guard, the flag is `pnpmDirFlag` in `src/lib/foreign-pin.js`,
`start`'s path and `pin`'s next steps are pinned by the effect and not by the exit code, and
`tests/plan-spelling.test.js` is the test that holds the root to its bytes.

## Why that is a gap

The decision log is not the register of authority. `docs/spec/README.md` carries the map — the
Amendments table — and a section's authority is exactly the list of rows that name it: a row says a
later record replaced the frozen record's text for that section, and the drift gate verifies that
each row's record exists and is not still a `draft`. §11.7's rows stop at `0034`, so the paragraph
above has no record the table names. A reader who asks what decided it is sent to a decision-log row
the registry does not list, and the gate cannot verify a record that no row names.

Issue #542 is that debt taken as its own issue, resolved by this record and the amendment row that
name it. The number was free: the highest the registry carried was `0039`, and no `0040-*` existed
when it was taken.

## The rule

Stated once, in the words the plan already uses: **a printed step that names a path or a project says
which one it names and in which directory it is read.** The three cases are the spec's own rows:

- **a `git add` path is rebased against the directory the step is pasted in**, because git resolves a
  pathspec from the directory it runs in — from `apps/web`, row 14 of a root plan prints
  `git add ../../package.json && git commit -m "<message>"`, and the same commit with a bare name
  exits `0` having recorded the member's manifest while the root manifest the add wrote stays
  modified;
- **a pnpm step names the project with `-C <the repository root, from here>`**, because a pnpm command
  acts on the nearest project manifest at or above the directory it runs in — from `apps/web`, row 13
  prints `pnpm -C ../.. add <your first dependency>`, and the same command without the flag writes
  `apps/web/package.json`. The flag is not a relabelling of a base the command already had: it changes
  which project the command writes, and the project it writes after is the one `init --apply`,
  `pin --apply` and the rest of the plan write;
- **at the repository root nothing is rebased and nothing is added.** Every row prints exactly as the
  table states it, and the root form is the one a Windows volume's second spelling cannot change
  either, because the directory is compared rather than subtracted and the names the catalog declared
  are printed unchanged (issue 210).

A row that names no repository path and no project — a branch, a preset, a whole-tree `git add`, or a
command of this tool that resolves the root itself — prints the same bytes wherever it is asked from.
That is the fourth case the spec derives from the first three, and it is where rows 1, 3, 4, 8, 11, 12
and 16 sit.

## Why this is a record and not new behaviour

The rule shipped with `#535`, in the same change that wrote the paragraph and the nine rows, so this
record adds nothing the spec does not already say and changes nothing the spec already says. What was
missing was the record, not the decision: a section whose authority no record names is a section that
can be edited from the code instead of from a decision, which is the direction this repository forbids
in both of its axes.

## What this does not do

It does not restate `I-94`'s mechanism as a contract. The helper names, the root guard and the test
are the implementation's, and this record points at the row that keeps them rather than competing
with it.

It changes no byte of `docs/spec/commands.md` and no other spec page, and it adds no behaviour, no
flag and no output field.

It does not touch the `remediation.command` strings of the JSON report. Those are report-body values,
the contract keeps `path` repository-relative and non-absolute (10.1), and whether the report becomes
cwd-dependent is a separate decision `I-94` deliberately did not take.

And it does not close §11.7 to further amendment: a section may be amended more than once, so this row
is what makes the paragraph above verifiable, and not the last row the table will carry.
