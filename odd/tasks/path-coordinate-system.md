# The plan lives in one coordinate system

Issue #210, opened by the sample test in #209 and pursued through six CI runs across five commits.
The defect has two halves and only one of them is understood: a dirty tree can be called clean when
the working directory is the 8.3 short spelling of the repository root, and a plan asked from that
spelling prints `../../../..` paths. Three attempts are spent and recorded below; the next one starts
at T1, with evidence rather than arithmetic.

## Specs

### S1 — a target the plan writes is refused from any spelling of the directory

> ⨯ a dirty target is refused from either spelling of the directory
>   expected: 3
>   actual: 0

Measured in T1, and the premise of this spec was wrong. The guard compares the plan's **own**
targets, and on the runner one of them is missing:

> local:  paths = ["package.json","pnpm-workspace.yaml",".gitignore"]  dirty = [" M package.json"]
> runner: paths = ["pnpm-workspace.yaml",".gitignore"]                 dirty = []

`package.json` is not written where pnpm is not found, so nothing looks at it and exit 0 is the
contract working, not failing open. What remains required: the dirty target the plan does write is
refused, and the refusal names the file — `refusing to write over uncommitted changes: <file>` — from
either spelling of the directory.

### S2 — no step names a path outside the repository it was printed for

The step has to be pasteable where the reader stands (`docs/spec/commands.md` §11.7 row 5: "The step
names those paths instead of staging everything"). On the runner it printed this instead:

> git add ../../../../../runneradmin/AppData/Local/Temp/funky-secure-sample-ODNhlU/pnpm-workspace.yaml ../../../../../runneradmin/AppData/Local/Temp/funky-secure-sample-ODNhlU/.gitignore && git commit -m "chore: apply funky-secure"

### S3 — the published plan document keeps its fields

> the JSON plan document carries target, operation, absolute path, digest, reason and state

A repository-relative name is now carried on the item for the writer to compare with git, and the
projection that builds the document leaves it out. Adding a field would be a contract change, and this
issue does not have one.

### S4 — an ordinary directory prints what it printed before

With a cwd in its natural spelling, `start`, `scan --scope repo --json` and `init` must produce
byte-identical stdout, stderr and exit code against the previous commit. Measured with a worktree of
`main` in a scratch directory, never as a committed test.

## Tasks

| ID | Spec | Route | Commit |
|---|---|---|---|
| T1 | S1 | inline: temporary diagnostic on a Windows runner — print the plan names and both sets | `37d1363` (branch `chore/t1-path-evidence`, PR 214) |
| ~~T2~~ | — | dropped: T1 shows no fail-open. The comparison over the plan's own targets is correct; `package.json` was absent from the plan on the runner, which is why nothing refused | — |
| T3 | S2 | inline: presentation from `git rev-parse --show-prefix` instead of subtracting two absolute paths | — |
| T4 | S2 | inline: the two tests that subtract string lengths (`tests/init.test.js`), and a guard whose dirty file is a path the plan always writes | branch `fix/canonical-working-directory` |
| T5 | S2 | inline: unblock #209 by merging `main` into it; never relax the test | — |
| T6 | S3, S4 | inline: a `D-n`/`I-n` entry in `docs/decisions.md` recording the coordinate decision | — |

## Log

### L1 — the decision to open this arc, verbatim

> vamos con 2

### L2 — where it starts

PR #211 is closed without merging after six CI runs. The branch `fix/canonical-working-directory`
keeps five commits as evidence: `9ce22fd` (canonical cwd), `dd9c081` (canonical root), `a36d1c9`
(structural comparison, canonicalization still present), `d2fc80e` (canonicalization reverted, the
comparison kept), `9c1468d` (the catalog name the plan already declares). Issue #209 stays blocked;
its sample test is correct and proven in both directions.

### L3 — the three hypotheses, and why each died

Canonicalizing the cwd with `realpathSync.native` broke four existing tests, and the runner showed why:
on that volume `.native` answers the **short** form, so canonicalizing does not pick a stable spelling,
it picks a different one than the caller used, and every reported string stops matching its fixture.
Canonicalizing the root as well produced eleven failures, `validateWriteTarget` among them. Dropping
canonicalization and comparing structurally recovered every regression — which is what located the last
subtraction: `writtenPaths` recomputed a name the plan already carried.

### L4 — why the four existing regressions prove less than they look

Every pre-existing dirty test passes on `main` on the runner, and it passes for the wrong reason: git
rejects the escaped pathspec with exit 128, so the tool refuses by accident. Those tests therefore
cannot witness the fail-open. The only tests that do are the two added here, and they still fail.

### L5 — the open question, stated so it can be answered

With no `realpath` left in the path and the names taken from the catalog, what makes the intersection
empty on that volume? Measure before changing another line of arithmetic: the plan names and the raw
porcelain output, printed from inside the runner.

### L6 — T1 measured it, and the premise was wrong

The instrument printed, on both Windows runners and on this machine, the cwd, the root git answers,
and both sets at the point of comparison:

> local:  {"cwd":"...\FUNKY-~1","root":"C:/Users/.../funky-secure-t1-...","paths":["package.json","pnpm-workspace.yaml",".gitignore"],"dirty":[" M package.json"]}
> runner: {"cwd":"...\RUNNER~1\...","root":"C:/Users/runneradmin/...","paths":["pnpm-workspace.yaml",".gitignore"],"dirty":[]}

The intersection is not broken. `package.json` is missing from the plan where pnpm is not found, so
the guard never looks at it, and exit 0 is the contract working. There is no fail-open to close: the
one the verifier reported was produced by the canonicalization this branch already reverted, which put
two spellings into the same comparison.

The first instrument was itself broken — a newline inside a string, pushed without the suite being
run, which is the failure the rule about short suites exists for. `String.fromCharCode(10)` removed
the escapes.

What survives from the branch is not a fix: it is the removal of a redundant subtraction
(`writtenPaths` recomputing a name the plan already carries) and three test comparisons that sliced
strings of different lengths. Both are worth keeping and neither is a defect.
