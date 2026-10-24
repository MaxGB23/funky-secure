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
`no-bot-auto-merge`.

**The steps** of every job in a workflow that declares the trigger are checked for a checkout of the
pull request head. Code the base repository did not review is what the fork brings:

- an `actions/checkout` step whose `with.ref` is `${{ github.event.pull_request.head.sha }}`,
  `${{ github.event.pull_request.head.ref }}` or `${{ github.head_ref }}`;
- a `run:` command that checks one of those expressions out, with `git checkout` or
  `gh pr checkout`. A backslash continuation joins the lines of one command, so a `git checkout` and
  the ref it checks out are read as one command and two unrelated lines are not.

Each offending step is one `fail`:

- `pull-request-target-checkout` — the trigger and the head checkout in the same workflow.

Any other answer is one finding for the whole repository, never one per workflow:

- `pull-request-target-without-head-checkout` — a workflow declares `pull_request_target` but no step
  checks the head out. This is the safe shape, and the pass names which half was found.
- `no-pull-request-target` — no workflow declares the trigger. A head checkout under
  `pull_request`, where the head is the checked-out commit by definition, is this pass.
- `no-ci` — the repository has no workflow at all.
- `unparseable-workflow` — a workflow the reader cannot attribute is skipped per file, and no pass is
  added on top of it: the rule never guesses from a line scan.
- `no-repo` — no repository facts were collected.

Friction is 1. Severity is `error` in `baseline` and `error` in `strict`: this is a declared
deviation from the friction table of RFC 4.2/9.1, where friction 1 starts at `warn` in `baseline`.
The finding only fires on the combination, and the fix is one edit — dropping the trigger or the
step. A repository that never writes `pull_request_target` is never touched.

## Evidence

The job, the step index, the kind (`uses` or `run`) and the raw expression that checks the head out,
reported at the step line. A `run:` step reports the command that carries the expression, so the
expression is read in the context that made it a checkout.

## Remediation

`manual`, printed as the choice to make: remove the `pull_request_target` trigger, or remove the
step that checks the pull request head out, so the workflow never runs fork code in the base
repository's context. The tool never edits a workflow.

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
- It does not decide whether the checked-out code is built or executed. A checkout with no later
  step that runs it is reported the same way as one followed by `pnpm install && pnpm test`, because
  the rule reads the workflow's declared steps, not the behavior of a script they call.

A workflow the reader cannot parse is skipped per file; a skipped file is not a pass, and a
composite action or a reusable workflow that checks the head out is outside the step set read here.
