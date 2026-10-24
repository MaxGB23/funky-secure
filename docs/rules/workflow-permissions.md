# Every workflow declares least-privilege permissions

Rule id: `workflow-permissions`

## Question

Does each workflow declare least-privilege permissions?

## Detection

`GITHUB_TOKEN` is minted for every job, and the scopes it carries are decided by the closest
`permissions:` declaration: the job's, else the workflow's, else the repository setting. So the
declaration is what a stateless reader can hold, and it is read through the structural reader in
`src/lib/workflows.js` — the workflow-level declaration and each job's, as the reader attributed
them — never by scanning the file for the `permissions:` key. A `run:` body that prints the word, a
comment, or a `with:` map key is not a declaration.

The reader models a declaration as a form, with the 1-based line it was declared on:

| written as | form |
|---|---|
| `permissions: write-all` | `write-all` |
| `permissions: read-all` | `read-all` |
| `permissions: {}` | `none` |
| a flow or block map, e.g. `permissions: { contents: read }` | `map`, with the entries |

A `permissions:` value the reader cannot attribute — an unknown scalar, a block scalar, a body with
no key, a level written as a block scalar — refuses the whole workflow naming the line. The reader
never guesses, and a refused file is a skip for this rule, not a finding about permissions.

Three answers:

- `workflow-permissions-missing` — a job whose permissions come from neither its own block nor a
  workflow-level default. The finding is one per workflow, at line 1, and `evidence.jobs` names the
  jobs that inherit the repository setting. A job that declares its own block is never listed: its
  declaration governs it, so a workflow whose only declarations are per job is not reported at all.
  The fix is one line.
- `workflow-permissions-write-all` — a `write-all` at the workflow level, or in a job. It is
  reported at the line of the declaration that grants it, and `evidence.level` says which: the
  workflow's own line with `level: workflow`, or the line of that job's `permissions:` key with `level: job` and
  `evidence.job`. A workflow-level `write-all` is reported even when a job narrows it, because the
  workflow still grants every scope to every job that does not narrow it — including the next job
  somebody adds. A job-level `write-all` is reported even when the workflow level is narrow, because
  that job overrides the narrow default with everything.
- `least-privilege-permissions` — one `pass` for the repository: every job's permissions come from a
  declaration and no declaration is `write-all`. `read-all`, `{}` and a map of narrow scopes are all
  least privilege here.

A repository with no workflow is `skip: no-ci`, not a pass. A workflow the reader cannot parse yields
`skip: unparseable-workflow` for that file and no pass is added on top of it. No repository facts is
`skip: no-repo`.

Friction is 1, severity is `warn` in `baseline` and `error` in `strict`: an absent declaration is the
one 0.2 finding that does not start at `error` in `baseline`, because what a missing declaration
means depends on a repository setting the tool cannot read.

## Evidence

`evidence.level` is `workflow` or `job`, and the finding is reported at the line of the declaration
that grants `write-all`. A job-level finding also carries `evidence.job`, and it is reported at the
line of that job's `permissions:` key, which is the line the fix replaces.

## Remediation

`manual`, printed as the declaration to write:

- absent — add `permissions:` with `contents: read` at the top level, and widen it only in the job
  that needs it.
- `write-all` — replace it with the exact scopes the workflow or that job writes.

The tool never edits a workflow.

## Limits

It proves what the workflow *declares*; it does not prove the token a job receives, and it does not
prove the declaration is the narrowest one for the job:

- **The declaration is not the effective grant.** A repository setting decides the default for a
  workflow that declares nothing, a reusable workflow a job calls brings its own `permissions:`, and
  an environment can narrow or widen what a job gets. None of those is a file read here.
- **It does not judge whether the granted scopes are the narrowest possible for the job.** A
  workflow that declares `contents: write` where it only reads is reported as a pass, because
  deciding that would mean reading what each step does with the token.
- **It does not evaluate `GITHUB_TOKEN` defaults.** Whether an absent declaration is safe depends on
  a repository setting — the permissive default, or the restricted read-only one — that is not in the
  fact set. That is why the missing declaration is `warn` in `baseline` and `error` in `strict`
  instead of an error everywhere.

A workflow the reader cannot parse is skipped per file; a skipped file is not a pass. Only
`.github/workflows` files the collector resolved are read: a workflow invoked through a reusable
workflow in another repository, or a composite action, is outside the set.
