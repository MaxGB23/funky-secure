# No dependency update is merged automatically
Rule id: `no-bot-auto-merge`

## Question

Can a dependency update reach the default branch without a human reading it?

## Detection

Two independent signals.

**Configuration.** A `.github/dependabot.yml` or `.github/renovate.json` means automated updates
exist and must be reviewed by a person. The RFC calls this an `info` finding. `info` is a severity
in the report contract, not a status, and v0.1 cannot lower one finding's severity below the rule's
policy severity without changing the policy model. So the signal is emitted as one `pass` carrying
`code: bot-config-present` and `evidence: { files }` — counted as a pass, named in the rolled-up
passing line, and never the reason a run fails. That is the decision: the information rides on a
pass instead of inventing a per-finding severity override. It is one finding for the configuration
as a whole, not one per file.

**Merge path.** Each workflow is read by the structural reader (`src/lib/workflows.js`), so every
step is attributed to the job that runs it. Two failures are possible, both reported as `fail`:

- `automerge-for-bot` — a job whose `if`/`name` mentions `dependabot[bot]` or `renovate[bot]` and a
  step in it either runs `gh pr merge` with `--auto` or `--merge`, or uses one of the known
  automerge actions: `peter-evans/enable-pull-request-automerge`, `pascalgn/automerge-action`,
  `alexwilson/enable-github-automerge-action`, `reitermarkus/automerge`.
- `pr-target-head-checkout` — a job that runs on `pull_request_target` and checks out the PR head
  (`github.event.pull_request.head.sha` or `refs/pull/` anywhere in that job's steps). The
  combination hands repository secrets to untrusted code. The trigger is read from the workflow's
  top-level `on:` declaration and from a job `if`/`name` that names it; the head checkout is
  attributed through the reader.

Neither signal firing is a pass whose message states the rule: an update is merged by a person
after reading the diff and running the gate. A workflow the reader cannot parse yields one
`skip: unparseable-workflow` for that file, and the rule never adds a pass on top of it.

## Evidence

For `automerge-for-bot`: the job, the step index and the offending `run` or `uses`. For
`pr-target-head-checkout`: the job and the line of the checkout step. For the configuration signal:
the bot files found.

## Remediation

None. There is nothing to write: removing an automation is a review decision, and the rule does not
edit workflows. The message states the rule that replaces it — an update is merged by a person
after reading the diff and running the gate.

## Limits

- Only the four listed automerge actions are recognized. A custom merge script that does not shell
  out to `gh pr merge` is not detected.
- The bot condition is matched textually in the job `if` and `name`. A workflow that decides
  authorship in a separate step, or a merge triggered outside these jobs, is outside the
  attribution.
- `pull_request_target` is read at the trigger declaration and in job conditions. A trigger written
  in a form the scan cannot attribute produces no finding from that path rather than a guess.
- Whether a human actually read the diff is not observable. The rule proves that no automation path
  is declared, and stops there.
- A workflow the reader cannot parse is skipped per file; the rule never guesses from a line scan.
