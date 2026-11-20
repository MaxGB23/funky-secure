# A `pull_request_target` workflow does not check the pull request head out

Rule id: `pull-request-target`

## Question

Does a workflow combine the `pull_request_target` trigger with a checkout of the pull request head?

## Detection

Two facts per workflow, both read through the structural reader: the trigger, and the steps.

**The trigger** is read from the one place YAML defines it: the top-level `on:` key. Its value may be
a bare event name (`on: pull_request_target`), a flow sequence (`on: [push, pull_request_target]`), a
flow map (`on: {pull_request_target: {types: [opened]}}`) or a block of event keys. Comments are
stripped first, so a commented-out trigger is not a declaration, and the trigger is never found by
scanning the file for the token: an `on: pull_request` workflow whose `run:` body says
`echo "we do not use pull_request_target here"` does not declare it. The reader in
`src/lib/workflows.js` exposes this as `declaresTrigger(text, name)`, shared with
`workflow-run-artifact`.

**The steps** of every job in a workflow that declares the trigger are checked for a checkout of the
pull request head. Code the base repository did not review is what the fork brings. The head is
named in one of two ways, and both count:

- by an **expression** — `github.event.pull_request.head.sha`,
  `github.event.pull_request.head.ref` or `github.head_ref`;
- by the **reference a pull request number addresses** — `refs/pull/<number>/head`,
  `refs/pull/<number>/merge`, `gh pr checkout <number>`, or a `pull/<number>/head` fetch followed by a
  `FETCH_HEAD` checkout. `<number>` may be a literal (`refs/pull/7/head`) or an expression
  (`refs/pull/${{ github.event.pull_request.number }}/head`); either way the reference is recognized
  as written and nothing is resolved.

A head is reported when:

- **any action** receives it in a `with:` value — not only `actions/checkout`. A third-party
  checkout and a local composite action (`uses: ./.github/actions/checkout-head`) put the same tree
  in the same working directory, and the name of the action is not what makes the combination
  dangerous. Every value of the map is read, and the map may be written as a block map (`with:` and
  then the key on its own line) or as a flow map on one line (`with: { ref: refs/pull/7/head }`),
  which YAML defines and GitHub accepts. Both spellings answer the same finding at the same step
  line, and the flow one was unread before I-82 — so a workflow written that way can now hold a
  `pull-request-target-checkout` it did not have, which is a true finding on a spelling that was
  valid all along;
- a `run:` command names it **and checks it out**: `git checkout`, `git switch`, `git worktree add`,
  a hard reset onto it, `git restore --source`, `git merge` onto `FETCH_HEAD`, `gh pr checkout`, or a
  `pull/<number>/head` fetch followed by a `FETCH_HEAD` checkout. A backslash continuation joins the
  lines of one command, so a `git checkout` and the ref it checks out are read as one command and
  two unrelated lines are not.

A command that **names** the head and checks nothing out is **not** a finding:
`run: echo "${{ github.event.pull_request.head.sha }}"` is the ordinary way to report which commit
is under review, and naming a ref is not reading it. That sentence is the rule's own limit as much
as its behaviour: the `run:` half is read by command, and a checkout performed by a script the
workflow calls is outside it.

Each offending step is one `fail`:

- `pull-request-target-checkout` — the trigger and the head checkout in the same workflow.

Any other answer is one finding for the whole repository, never one per workflow:

- `pull-request-target-without-head-checkout` — a workflow declares `pull_request_target` but no step
  checks the head out. This is the safe shape, and one pass is counted for the whole repository
  however many workflows declare the trigger. The count is the only thing a reader sees: the JSON
  report filters pass rows out of `findings` (only the summary counts them) and the human report
  prints `all 1 rule pass`, so a pass's `code` and `message` are never printed by either format —
  `--verbose` names the rule, not which half was found.
- `no-pull-request-target` — no workflow declares the trigger. A head checkout under
  `pull_request`, where the head is the checked-out commit by definition, is this pass.
- `no-ci` — no workflow file to read at all: `.github/workflows` is absent, or it exists and holds no
  `.yml`/`.yaml` file. The skip message says no workflow file exists, which is the fact in both
  cases — a repository whose `.github/workflows` is present but empty is skipped with the same
  sentence, because the directory is never claimed to be missing.
- `unparseable-workflow` — a workflow the reader cannot attribute is skipped per file, and no pass is
  added on top of it: the rule never guesses from a line scan.
- `no-repo` — the repository was excluded by `--scope machine`, or nothing resolved one.

Friction is 1. Severity is `error` in `baseline` and `error` in `strict`: this is a declared
deviation from the friction table of RFC 4.2/9.1, where friction 1 starts at `warn` in `baseline`.
The finding only fires on the combination, and the fix is one edit — dropping the trigger or the
step. A repository that never writes `pull_request_target` is never touched.

`starter`, the day-zero preset, turns this rule `off`: it runs its six rules at their `baseline`
severity and counts nothing for the rest, so this one contributes neither a finding nor a count
there. `--ignore pull-request-target`, or `"pull-request-target": "off"` in the repository config,
does the same.

## Evidence

The job, the step index, the kind (`uses` or `run`) and the raw expression or reference that names
the head, reported at the step line. A `run:` step reports the command that carries it, so it is
read in the context that made it a checkout.

## Remediation

`manual`, printed as the choice to make: remove the `pull_request_target` trigger, or remove the
step that checks the pull request head out, so the workflow never runs fork code in the base
repository's context. The tool never edits a workflow.

Both halves hold, measured: taking the trigger out of the failing workflow turns the `fail` into a
counted pass, and deleting the offending step with the trigger left in place does the same, because
what remains is a `pull_request_target` workflow that no longer names the head.

## Limits

It proves that a declared event and a declared step name the combination. It does not prove the
workflow is exploitable, and it does not prove it is safe:

- It does not read whether the job has secrets. `pull_request_target` exposes the base repository's
  context whether or not a secret is referenced, and whether a secret exists is not a repository
  file this rule reads.
- It does not evaluate `permissions:`. A workflow that grants `write-all`, or that needs a token
  with write access, is not distinguished from one that grants `contents: read`.
- It does not resolve the expression. Whether `github.head_ref` points at the fork branch at run
  time, and where git fetches it from, is decided by GitHub, not here; the strings are matched as
  written, including inside a longer expression.
- It does not resolve an expression, and it does not need to for a head reached by pull request
  number. `refs/pull/<n>/head`, `refs/pull/<n>/merge`, `gh pr checkout <n>` and a `pull/<n>/head`
  fetch followed by a `FETCH_HEAD` checkout are literal references: they are recognized as written
  without evaluating anything, so the expression limit above does not reach them. A literal number
  (`refs/pull/7/head`) and a number that arrives as an expression
  (`refs/pull/${{ github.event.pull_request.number }}/head`) are both references, not expressions to
  be resolved.
- It does not decide whether the checked-out code is built or executed. A checkout with no later
  step that runs it is reported the same way as one followed by `pnpm install && pnpm test`, because
  the rule reads the workflow's declared steps, not the behavior of a script they call.

A workflow the reader cannot parse is skipped per file; a skipped file is not a pass. A reusable
workflow that checks the head out is outside the step set read here, and so is a script a step
calls: the `run:` half reads the commands the workflow itself writes.

A `with:` value that names the head is read as a checkout reference, which is an inference: an
action that receives the head and never reads it is indistinguishable here, and the rule reports it
rather than guessing which actions consume their input. The widening to every action and every
`with:` key was measured against the shapes it could newly flag — `run: echo "…head.sha"` is the
one that must stay a pass, and it does — and it is the reason the `run:` half keeps its command
requirement instead of matching a bare mention.

A `with:` map may be written in **flow style** as well: `with: { ref: refs/pull/7/head }` is valid
YAML, GitHub accepts it, and the shared reader models it (`src/lib/workflows.js`, I-82 of
[`docs/decisions.md`](../decisions.md)), so the head that map names is reported exactly as the same
`ref:` written on its own line under `with:` is. That is deliberately the only step map read in flow
style: a flow mapping anywhere else — a job, an `env:` map — is not attributed, and a `with:` map
that does not close on its own line, or that carries a block body under it, makes the workflow
unparseable, which this rule reports as `unparseable-workflow` and never as a pass.
