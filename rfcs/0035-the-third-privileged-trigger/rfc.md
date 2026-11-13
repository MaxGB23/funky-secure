# RFC 0035 - the third privileged trigger

| | |
|---|---|
| **Status** | `draft` - the decision is settled; this body is the argument for it and the contract moves when the rule merges. |
| **Revision** | 1 |
| **Present contract** | `pending` - nothing in the contract names this rule today. It becomes [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R13 and the §8.4 paragraph when the rule merges. |
| **Supersedes** | none |
| **Superseded by** | none |

> The normative text lives in `docs/spec/` and `docs/rules/workflow-run-artifact.md` once the rule
> merges. This record holds the decision and the reasoning; the contract is what the code owes.

## Context

The CI family holds five rules: `actions-pinned-sha`, `no-bot-auto-merge`, `ci-no-safety-overrides`,
`pull-request-target` and `workflow-permissions`. Each asks its question about one workflow at a time,
and none of them reads the `workflow_run` trigger. A workflow that runs because another run finished is
outside what the family models.

Measured on `main@1b5d344`, with `GIT_CEILING_DIRECTORIES` set to this repository so the parent's
lockfile cannot contaminate the fixture, the scan over issue #153's exact two files prints the CI block
and no finding at all:

```
CI
  all 5 rules pass
```

Exit code `0`. Verdict `PASS`. Issue #153 says a `workflow_run` workflow that consumes an artifact
produced by an unprivileged run and holds a write token passes with every CI rule green, and the issue
is accurate: the trigger is not modelled, so the pair cannot be reported.

The two files are ordinary, and each is correct on its own. The producer declares `on: pull_request`
and `permissions: contents: read`, uploads its artifact, and can do nothing else. The consumer declares
`on: workflow_run`, `permissions: contents: write`, downloads the artifact by
`github.event.workflow_run.id` and carries the token in a step `env`. The escalation is assembled
between them: a fork's bytes travel into a run that holds this repository's write token. The README
has carried this as the one hole in the rule set, in its own words, while the scan called it a pass.

**Why the two existing rules do not reach it.** `pull-request-target` asks whether a workflow combines
its trigger with a checkout of the pull request head (R11, 0024). That question is a trigger plus a
checkout, and #153 has neither: the consumer's trigger is `workflow_run`, and no step checks anything
out. Widening the rule to read the second trigger would make its id name an event it does not name, and
its remediation ("remove the trigger, or remove the step that checks the head out") would be false for
this pair. `workflow-permissions` asks whether a workflow declares least-privilege permissions for its
own event (R12). In #153 both declarations are explicit and correct for the file they live in: the
producer is read-only, which is what makes it safe to run on a fork's pull request, and the consumer's
`contents: write` is a legitimate grant for a run that this repository started. A rule that read the
two files together would no longer answer the question its id names, and it would have to withhold
`least-privilege-permissions` from a workflow that does declare least privilege.

What is missing is a question nobody asks: does a privileged workflow read bytes an unprivileged one
produced? That is a new rule, not a widening of the two.

**The reader had to carry it first.** `parseWorkflow` returned `{ok, jobs, permissions}`: `name` was
undefined, the trigger was read only as the events a rule already needed, and a step was
`{index, line, name, uses, raw, with, run}` with no `env`. #153's consumer names its producer by
workflow `name:` and carries the token in step `env`, so neither half of the pair was reachable. The
reader now returns the workflow `name:`, the trigger block with its `workflows` and `types` lists, and
`env` at job and step, on top of the `permissions` levels R12 already reads.

## The decision

### Why thirteen

§8.4 is the budget this rule has to satisfy, and it says so in its own words:

> **And in 0.2 the count still binds.** Nine was a v0.1 budget; 0.2 raised it to twelve, and the budget
> that matters is per release, not per catalog: twelve rules must still fit one screen of output on a
> real repository, one page of documentation, one test file each and one release note. The three that
> shipped first were chosen by that test — each reuses a reader that already exists, so none of them adds
> a new way for the tool to be wrong in public. The catalogue is twelve today, and
> `tests/docs-contract.test.js` counts this file's `#### R` sections against the catalog the code
> exports, so a thirteenth rule cannot arrive without a section here (0024).

Point by point:

- **One screen.** The rule is one more row in the CI family, and the family prints as one block with a
  count: `all 5 rules pass` becomes `all 6 rules pass` on a repository that is clean, and one finding
  is one paragraph, the size of every other CI finding. Nothing moves off the screen to make room.
- **One page.** `docs/rules/workflow-run-artifact.md`, in the shape every rule page has: the question,
  what the rule reads, what it cannot read, and the two edits that clear it.
- **One test file.** `tests/rules/workflow-run-artifact.test.js`, with #153's pair as the fixture that
  must fail and the resolved-producer variants that must pass or skip. The count gate in
  `tests/docs-contract.test.js` compares `#### R` sections against the catalog, so the section, the rule
  and the page land in one pull request (0024).
- **One release note.** One breaking-change line and one upgrade sentence, because the rule is `error`
  in `baseline` (see Consequences), not a feature paragraph.
- **No new way to be wrong in public.** The rule adds a question, not a parser. Every field it reads is
  a field another rule already had to get right: the trigger block with its lists (R11), `permissions`
  at workflow and job level (R12), a workflow's `name:` and a step's `env`. A parser that two rules
  share is a parser whose defects are found twice.
- **What the alternative costs.** §8.4 counts rules; it does not count false passes. Leaving the hole
  is a `PASS` over a pwn request the tool has already documented on its own front page, printed by the
  output a user is told to trust. A budget that protects a known-untrue green is measuring the wrong
  thing: `all 5 rules pass` over #153's pair is worth less than `all 6 rules pass` with one finding in
  it. That is the argument §8.4 asks for, and it is the one this record makes.

### The rule

`workflow-run-artifact`, family CI and merge, friction 1, `severity: { baseline: 'error', strict:
'error' }`, remediation manual, documentation at `docs/rules/workflow-run-artifact.md`.

- **Question:** does a privileged workflow read bytes an unprivileged workflow produced?
- **Detection:** a workflow whose `on:` declares `workflow_run` **and** downloads an artifact, where a
  download is a step whose `uses` is `actions/download-artifact` or a step whose `with.run-id` reads
  `github.event.workflow_run.id` **and** whose permissions grant a write (`contents: write`,
  `pull-requests: write`, `issues: write`, or `write-all`, at workflow or job level) **and** whose
  producer resolves: every workflow in the repository is matched by `name:` against
  `on.workflow_run.workflows`, and the producer that matches declares `pull_request`.
- **Failure:** `workflow-run-artifact`, reported once per consumer workflow at the step that consumes
  the artifact, so the line a reader is sent to is the line the fix edits.
- **Evidence:** the consumer workflow's path and the step's line, the producer's path and the name it
  was matched by, the producer trigger that makes it unprivileged, the download mechanism (`uses` or
  the `run-id` expression), and the scopes the write rests on.
- **Severity:** `error` in `baseline` and in `strict`, a declared deviation from 9.1 for the reason R11
  records: the finding fires on the conjunction of four declarations, removing any one of the four
  clears it, and no repository that never writes `workflow_run` is touched. The friction class of the
  finding is not the friction of the fix.

### Where the rule answers `skip`

A rule that cannot resolve the producer must say so, because a `skip` is printed in the report's
skipped list and a silent `pass` is not. Three states stop the resolution, and each has its own code:

- `producer-unresolved-name`: no workflow in the repository carries the `name:` the trigger names.
- `producer-unresolved-trigger`: the trigger block is a form the reader does not model, so the names
  cannot be read out of it.
- `producer-unresolved-config`: a key the rule reads is `null` (a `null` `workflows`, permissions or
  `with` value).

None of the three is a `fail`, because none of them is a fact the rule read, and none of them is a
`pass`, because the rule did not verify the state it exists to verify.

The rest of the boundary is the shape R11 and R12 already use. No workflow at all skips (`no-ci`); a
workflow the reader cannot parse skips (`unparseable-workflow`); a workflow set that never declares
`workflow_run` is one pass (`no-workflow-run`); a consumer with no artifact download is one pass
(`workflow-run-without-artifact`); a resolved producer that declares no `pull_request` is one pass
(`trusted-producer`).

### Remediation

The privileged workflow must not read untrusted bytes. Both routes are structural, and the tool prints
them as the choice to make:

- Split the workflow so the job that holds the write token never consumes the artifact. The read stays
  where it is, and the write is given to a job in a workflow whose trigger is not an unprivileged run.
- Keep the artifact out of the write path, and re-derive what the job needs from an API the token can
  trust. The run's own metadata (`GET /repos/{owner}/{repo}/actions/runs/{id}`) is GitHub's account of
  the run, not the producer's bytes.

Printing the artifact, hashing it, or copying it into a comment are all reads of untrusted bytes
whatever the job does with them next, and the message says so. The tool never edits a workflow.

## Consequences

### The published contract

A new `error` rule is a breaking change for consumers, whatever the version number says. `--fail-on`
defaults to `error` (10.5), so a repository that carries this pair and was green turns red on the
release that ships the rule, with no change to the repository. §17.5 already admits the shape of this
release: `0.x` may break in a minor, and a break is declared with the `type:breaking-change` label and
a migration note in the release body. The release body names the rule and its severity, because §17.5
requires the note to name every rule added and every deviation from 9.1.

The upgrade sentence is one line: a scan that turns red after upgrading is reporting a finding the tool
did not have, not a change the repository made; read `docs/rules/workflow-run-artifact.md`, and
`--fail-on` is the only thing that changes a verdict without changing a workflow.

### The `starter` preset

`workflow-run-artifact` stays `off` under `starter`. §9.1 decides this case already: a preset that
claims to check less must fail in the safe direction, and an added catalog rule stays `off` until the
preset says otherwise. `starter` therefore still names exactly six rules, none of them a CI rule,
because a project on day zero has no workflows to read. The rule is present in `baseline`, the default,
and it is `error` there. That is where the change is felt.

### The drawing, 2026-11-13

`docs/images/diagram.jpg` still says TWELVE and draws the family split the catalogue no longer has. The
owner redraws it after this release, on their own account, outside it. This record states that as a
dated consequence rather than moving the count in the raster: every text surface that states the count
moves in this release, and the GitHub repository description moves last, because it says twelve too.

Until the drawing is redrawn the package front page and the catalogue disagree by one. The picture is
of a count that has moved, and the divergence is recorded here so a reader who meets it does not have
to decide which of the two documents is lying.

## What this record does not decide

- **The rule's wording.** The message strings, the evidence field names and the goldens are the code's
  to fix; this record decides the question, the conditions and the boundary.
- **The drawing.** Its redraw and its new shape are the owner's, and no date is promised here.
- **A second question about `workflow_run`.** Which producer types count, which artifact names matter,
  whether a `workflow_run` workflow that writes without downloading anything is a finding: one rule,
  one question, and this record admits one.
- **The deferred catalog.** No deferred rule moves into §8.2 and none is admitted by this record.

## Evidence

- **The measurement.** `main@1b5d344`, `GIT_CEILING_DIRECTORIES` set to this repository, issue #153's
  exact two files: `CI` / `all 5 rules pass`, exit `0`. Recorded in `odd/tasks/workflow-run-artifact.md`
  (T1) and posted as a comment on #153.
- **The reader before it grew.** The same run: `parseWorkflow` returned `{ok, jobs, permissions}`,
  `name` was `undefined`, and the step keys were `index, line, name, uses, raw, with, run`.
- **One file at a time, today.** [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R11 and R12, and
  0024 for the agreement between a rule's `detection` and its page.
- **The count.** [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.4, and the gate at
  `tests/docs-contract.test.js` comparing `#### R` sections against `catalog.length`.
- **The hole as the product states it today.** `README.md`: "One hole in the rule set is known and
  open", and [#153](https://github.com/MaxGB23/funky-secure/issues/153).
- **The preset rule that keeps `starter` at six.** [`docs/spec/policy.md`](../../docs/spec/policy.md)
  §9.1.
- **The breakage contract.** [`docs/delivery.md`](../../docs/delivery.md) §17.5.
