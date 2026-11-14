# A privileged workflow does not read an artifact an unprivileged run produced

Rule id: `workflow-run-artifact`

## Question

Does a privileged workflow read bytes an unprivileged workflow produced?

## Detection

`workflow_run` starts a workflow because another run finished, and the artifact that run uploaded is
reachable from the second one. A producer on `pull_request` executes a fork's bytes with a read-only
token, so an artifact it uploads carries bytes a fork can write. A consumer under `workflow_run` that
holds a write token and downloads that artifact closes the loop between the two files: the escalation
is assembled between them, and neither file is wrong on its own.

The producer is named by workflow `name:` in `on.workflow_run.workflows`, which lives in a sibling
file, so the rule reads every workflow the collector resolved and matches the names against each
file's `name:`. Every leg is read through the structural reader in `src/lib/workflows.js`, never by
scanning a file for a token:

- the top-level `on:` block, with its event names and their configuration lists;
- `permissions:` at the workflow level and in each job, as a form (`write-all`, `read-all`, `none`
  for `{}`, or a map of scopes);
- each step's `uses`, `with` and `run`.

A **consumer** is a workflow whose `on:` declares `workflow_run` and whose steps carry an artifact
download:

| download | read as |
|---|---|
| `uses: actions/download-artifact@<ref>` | `uses`, with the raw reference in the evidence |
| a step whose `with.run-id` reads `github.event.workflow_run.id` | `run-id`, with the expression in the evidence |

The finding is one `workflow-run-artifact` per downloading step, at the line of that step, so the
line a reader is sent to is the line the fix edits. It is reported only when all four declarations
hold:

1. the workflow declares `workflow_run`;
2. a step downloads an artifact;
3. the declaration that governs that job's token grants a write - any scope whose value is `write`,
   or `write-all`. The namespace does not matter: `contents`, `pull-requests`, `checks`, `id-token`
   and the rest are one token, and `id-token: write` alone is enough. The job's own `permissions:`
   wins over the workflow's, exactly as GitHub applies it, so a job that narrows the workflow grant
   to `contents: read` holds no write here;
4. the producer resolves, and it declares `pull_request`.

The message and `evidence.scopes` name every write scope the governing declaration holds, in
catalog order, and never a scope the rule did not read. `id-token: write` is the case that made this
plain: it mints an OIDC identity that a storage service accepts in place of a secret, so an artifact
it carries into the upload is a fork's bytes reaching a write token exactly as `contents: write`
would be. `vercel/next.js` runs that shape over an artifact a `pull_request` run built, and the
narrower test the rule shipped with answered `pass / no-write-permission` about it.

A producer that cannot be resolved is a `skip` with its own code, because "I did not resolve the
producer" and "the producer is trusted" must not print the same:

- `producer-unresolved-name` - no workflow in the repository carries the `name:` the trigger names,
  or more than one does: a shared name names no producer, so it is never resolved to one of them.
- `producer-unresolved-trigger` - the `on:` block is a form the reader does not model (a flow
  collection), so the names cannot be read out of it.
- `producer-unresolved-config` - a key the rule reads is absent or `null`: a `workflows:` list the
  reader reports as `null`, or a `workflow_run` trigger that names no workflow at all.

Four passes, each naming the furthest leg the rule did reach:

- `no-workflow-run` - no workflow declares the `workflow_run` trigger.
- `workflow-run-without-artifact` - a `workflow_run` workflow downloads nothing.
- `no-write-permission` - a downloading `workflow_run` job holds no write scope.
- `trusted-producer` - every resolved producer declares no `pull_request`.

A repository with no workflow is `skip: no-ci`, not a pass. A workflow the reader cannot parse yields
`skip: unparseable-workflow` for that file and no pass is added on top. No repository facts is
`skip: no-repo`.

Friction is 1, and severity is `error` in `baseline` and in `strict`: a declared deviation from the
friction table, for the reason `pull-request-target` gives. The finding fires on the conjunction of
four declarations, removing any one of them clears it, and no repository that never writes
`workflow_run` is touched, so the friction class of the finding is not the friction of the fix.

## Evidence

`evidence.job` and `evidence.step` locate the step, and the finding is reported at its line.
`evidence.producerPath`, `evidence.producerName` and `evidence.producerTrigger` name the other half of
the pair: the file, the `name:` it was matched by, and the `pull_request` trigger that makes it
unprivileged. `evidence.downloadKind` is `uses` or `run-id` and `evidence.download` is the value that
was read; `evidence.scopes` lists every write scope the token rests on, in catalog order, or
`write-all`.

## Remediation

`manual`, printed as the choice to make. Both routes are structural:

- Split the workflow so the job that holds the write token never consumes the artifact. The read
  stays where it is, and the write is given to a job in a workflow whose trigger is not an
  unprivileged run.
- Keep the artifact out of the write path, and re-derive what the job needs from an API the token can
  trust. The run's own metadata (`GET /repos/{owner}/{repo}/actions/runs/{id}`) is GitHub's account of
  the run, not the producer's bytes.

Printing the artifact, hashing it or copying it into a comment are all reads of untrusted bytes,
whatever the job does with them next. The tool never edits a workflow.

## Limits

It proves that a declared trigger, a declared step and a declared permission name the pair, and that
a workflow carrying the producer name declares `pull_request`:

- **It does not read the bytes.** Whether the artifact is a diff, a log or a binary, and what the job
  does with the content next, is outside a stateless reader.
- **It does not follow the artifact by name.** Only the download is read; the `upload-artifact` step
  that produced it is not compared with it.
- **It does not decide whether a fork can run the producer branch.** A `pull_request` workflow that
  only runs on `push` after a merge is still read as unprivileged here, and a repository that requires
  approval for fork workflows is not in the fact set.
- **It does not follow a producer into another repository**, nor one reached through a reusable
  workflow. A producer name more than one workflow carries names no producer: the pair is a skip,
  never a resolution to the first in path order.
- **It reads only the spelling of the download it models.** An artifact fetched outside a step's
  `uses` or `with.run-id` is not seen: `pnpm/pnpm` reads fork-produced artifacts with `gh run download`
  and the artifacts API inside a `run:` block, and that read never reached this rule. The workflow
  holds no write scope, so the answer there was right for a reason the rule did not read.
- **It follows no artifact into a reusable workflow.** A job that passes the artifact to a reusable
  workflow, or reads it inside one, is outside what the reader attributes, so a producer reached that
  way names no producer here and a read reached that way is invisible.
- **The scope that carries the bytes to a service is not classified.** Any `write` value counts, and
  the message names the scopes rather than judging which of them the downloaded bytes can reach.
- **A `with:` map written as a flow collection is invisible to the reader today**, so a download that
  only a flow-style `with` carries is not seen; the `uses` signal is the one that always answers.
- **The listed workflows are read only from a block map.** Any other spelling of `on:` is a skip,
  never a guessed list.

A workflow the reader cannot parse is skipped per file; a skipped file is not a pass.
