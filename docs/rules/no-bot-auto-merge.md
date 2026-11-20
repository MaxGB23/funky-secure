# No dependency update is merged automatically
Rule id: `no-bot-auto-merge`

## Question

Can a dependency update reach the default branch without a human reading it?

## Detection

Two independent signals.

**Configuration.** A `.github/dependabot.yml` or `.github/renovate.json` means automated updates
exist and must be reviewed by a person. The RFC calls this an `info` finding, and it is one: a
single `fail` carrying `code: bot-config-present` and `evidence: { files, botConfig }`, whose
severity the rule's state table lowers to `info` in `baseline` and in `strict`. It is reported,
counted and printed — under `REPO-ROOT`, with an `ℹ` and the action that replaces it — and it never
fails a run at the default threshold. `--fail-on info` is what makes it fail one, and that is the
reader's decision, not the rule's. It is one finding for the configuration as a whole, not one per
file.

The severity follows the state of the finding, and the table selects **per rule**, so every finding
this rule emits carries the selecting key: `botConfig: true` on this one and `botConfig: false` on
every other, the skips included. A finding that omitted it would make the table throw rather than
silently keep the lenient pair (9.2).

**Merge path.** Each workflow is read by the structural reader (`src/lib/workflows.js`), so every
step is attributed to the job that runs it. One failure is possible, reported as `fail`:

- `automerge-for-bot` — a job whose `if`/`name` mentions `dependabot[bot]` or `renovate[bot]` and a
  step in it either runs `gh pr merge` with `--auto` or `--merge`, or uses one of the known
  automerge actions: `peter-evans/enable-pull-request-automerge`, `pascalgn/automerge-action`,
  `alexwilson/enable-github-automerge-action`, `reitermarkus/automerge`.

The `pull_request_target` hazard is not read here. A job that runs on that trigger and checks the
pull request head out is `pull-request-target`'s finding, because that rule asks the question the
combination answers; this rule asks whether an update can merge unread, and a head checkout is
neither an update nor a merge. Reporting it here as well produced two findings on one line, which
is what issue 518 was filed for.

Neither signal firing is a pass whose message states the rule: an update is merged by a person
after reading the diff and running the gate. A workflow the reader cannot parse yields one
`skip: unparseable-workflow` for that file, and the rule never adds a pass on top of it. When the
repository is excluded by `--scope machine`, the rule yields one `skip: no-repo` whose message
names the flag, and that run carries no pass either.

**Policy.** Severity is `error` in `baseline` and `error` in `strict` for the merge path, and
`info` in both for the configuration signal — the one state this rule declares, `config-present`. This rule is not one of the
six day-zero rules, so `starter` turns it off: a `starter` run carries neither a finding nor a
count for it, and it fails no run. `--ignore no-bot-auto-merge`, `--only` naming other rules, and
`"rules": { "no-bot-auto-merge": "off" }` in the config file veto it the same way — neither a
finding nor a count.

## Evidence

For `automerge-for-bot`: the job, the step index and the offending `run` or `uses`. For the
configuration signal: the bot files found. Every finding carries `botConfig`, the key the state
table selects on.

## Remediation

`manual`, and it names the edit rather than a shell command: no command deletes a step from a
workflow, so printing one would be a claim the tool cannot keep.

- `automerge-for-bot` on a `gh pr merge` step — `edit <workflow>:<line> and delete the automatic merge
  step`.
- `automerge-for-bot` on an automerge action — `edit <workflow>:<line> and delete the automerge action
  step`.
- `bot-config-present` — no edit: the action printed is the rule itself, "an update is merged by a
  person after reading the diff and running the gate".

The line is the 1-based line where the step begins, so an editor opens at the place to edit. That
is not always the line carrying the `run:` or the `uses:`: a step written as `- name: enable
automerge` above `uses: pascalgn/automerge-action@v0.16.3` reports the `name:` line, one above the
action, and the edit is the whole step rather than that one line. The rule does not edit workflows
and does not rewrite one: removing an automation is a review decision. The message states the rule
that replaces it — an update is merged by a person after reading the diff and running the gate.

## Limits

- Only the four listed automerge actions are recognized. A custom merge script that does not shell
  out to `gh pr merge` is not detected.
- The bot condition is matched textually in the job `if` and `name`. A workflow that decides
  authorship in a separate step, or a merge triggered outside these jobs, is outside the
  attribution.
- Whether a human actually read the diff is not observable. The rule proves that no automation path
  is declared, and stops there.
- A workflow the reader cannot parse is skipped per file; the rule never guesses from a line scan.
