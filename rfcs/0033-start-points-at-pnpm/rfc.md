# RFC 0033 — the path says where pnpm comes from

| | |
|---|---|
| **Status** | `implemented` |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.7 |
| **Supersedes** | none |
| **Superseded by** | none |

## 1. The problem

`start` in an empty directory prints three steps:

```
  1  git init
  2  pnpm init
  3  funky-secure start
```

Step 2 requires pnpm, and pnpm does not ship with Node. Nothing in the output says so, and nothing says
where it comes from. Everything after step 2 — `pnpm import`, `pnpm install --lockfile-only`,
`pnpm add <your first dependency>` — requires the same thing, and no step says it either.

Record 0018 decided the rule that this breaks: a step that requires a state prints the command that
produces it. I-50 states it as an invariant, and it is the rule that gave the path the `git init` line,
the `git switch -c` line and the commit after every write. On the first step a new reader meets, the
invariant is silent, because the state it needs is not one this tool can produce with a command it is
willing to name.

## 2. The decision

**When the printed path carries at least one step that runs pnpm, the numbered list is followed by one
unnumbered line and the reason it exists:**

```
  pnpm is not part of Node, and the steps above need it: https://pnpm.io/installation
```

The line is a reference and not a command. The only command that would produce the state — pnpm on the
machine — is an installation, and this tool does not choose an installation for the reader: it audits
supply chains, and a supply-chain auditor that tells a stranger to install something as a side effect of
printed advice is arguing against its own finding.

The condition is derived from the steps already printed. Every pnpm step begins with `pnpm `, so one
test over the pending step list decides it. A path that needs no pnpm step prints no line: a repository
past the start prints its single line and nothing else, and a path whose steps are all this tool's own —
`init --apply`, a commit, `scan` — gains no reference to a command it does not name.

## 3. Why a reference and not a probe

A `pnpm --version` probe looks like the better answer: print the reference only when pnpm is missing.
It is rejected for two reasons.

1. **The path would depend on the machine.** `start` is documented as a function of the repository: it
   reads nothing above the root, measures no fact of its own, and cannot contradict the report about the
   same repository. A probe makes its bytes depend on the reader's `PATH`, so two readers with the same
   repository see different output — and the version manager that supplies pnpm through a shim,
   `corepack`, `mise`, `volta`, is exactly the setup a naive probe misreads. It could tell a reader who
   has pnpm that they do not.
2. **The answer would be a claim about the reader.** "You do not have pnpm" is a statement this tool has
   no business making from a `PATH` lookup, in a command whose whole output is about the repository.

Derived from the step list, the line is deterministic: two machines that see the same repository print
the same bytes, and the suite can assert them.

## 4. Why not `corepack enable`

It is the shortest command that produces the state, and it is the one that ages worst. Corepack is being
removed from newer Node releases, so a path that tells a reader to enable it is wrong on the Node they
install next year — and this tool does not know which Node they run, because it does not probe. A fixed
command in a document that outlives the release is the failure mode 0031 was written about: advice
derived from a state that is about to change.

## 5. Why not `npm install -g pnpm`

It works, and it is the wrong thing for this product to print. It installs a package globally, as a side
effect of running an audit tool, and a global install is one of the least governed installs a machine
has: no lockfile the repository records, no review, no version this tool can name. The line would then
be teaching the posture the tool spends every rule arguing against. A reader who wants that command can
find it in the documentation the reference names.

## 6. What this narrows, and where the narrowing stops

0018's rule is **narrowed** here, deliberately, and in one place: a step that requires a state prints
the command that produces it *when this tool can name that command safely*, and prints a reference when
it cannot. Producing pnpm is an installation, so it cannot.

The limit is what keeps the rule useful:

- The narrowing is only about **installation**. Every other step keeps its command: the branch, the
  resolves, the commits and the migration are still printed in full, because they are commands this tool
  can spell without choosing anything for the reader.
- The line is **one** line, unnumbered, and it is not a step. It carries no count, no flag and no ASCII
  art, and it stays inside the 96-column bound of 10.3.
- The reference is **fixed text**. It is a constant beside the other reasons the path prints, so it
  cannot be assembled from a fact and cannot drift from what it claims.

## 7. The enforcement

A contract that no test reads is a comment, so the line is pinned in three directions: it prints, its
text is exact, and its position is the one this record names — after the list, before `why this order`.
Two more tests pin the conditions that keep it from becoming decoration: a path carrying a pnpm step
prints it exactly once, and a path that carries none prints no reference at all. The suite also proves
the line is not a probe by rendering the same state twice, once with a pnpm reporting a version and once
with none, and comparing the bytes.

## Errata

**2026-11-10 — the wording of the line.** The reference line this record fixed was true and was read as
an unmet prerequisite, so its text is corrected here; the body stays as written.

- **What was wrong.** The line read `pnpm is not part of Node, and the steps above need it:
  https://pnpm.io/installation`. A field session on a machine where pnpm 12.3.4 was installed and on the
  `PATH` read it as "something is missing": at the foot of a plan a URL reads as a remedy for a problem,
  so a reader who already had pnpm took the line as an instruction to install what they had.
- **What replaced it.** The line now reads `pnpm does not come with Node; if it is not on your PATH, see
  https://pnpm.io/installation`. The conditional clause names the condition the line answers, so a reader
  whose pnpm is on the `PATH` reads it as not addressed to them and a reader whose pnpm is not gets the
  way out. No probe was added: the condition is spoken, not detected, for the reason §3 gives — a
  `pnpm --version` probe cannot tell "absent" from "not on this shell's `PATH`". §6's limit, §7's
  enforcement and the rest of the record are unaffected, and the test that pins the exact text still
  pins it.
