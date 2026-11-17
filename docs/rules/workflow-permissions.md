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
comment, or a `with:` map key is not a declaration — measured: a workflow whose line 1 is
`# permissions: write-all`, whose `run:` echoes the same text and whose step `with:` map carries a key
of that name reports `workflow-permissions-missing`, never a `write-all`.

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
  jobs that inherit the repository setting. The message names those ids only when some jobs declare
  their own block — `2 of its 3 jobs (a, b) inherit` — and says `every job inherits` when all of them
  do; `evidence.jobs` carries every id either way. A job that declares its own block is never listed:
  its declaration governs it, so a workflow whose only declarations are per job is not reported at
  all. The fix is one line.
- `workflow-permissions-write-all` — a `write-all` at the workflow level, or in a job. It is
  reported at the line of the declaration that grants it, and `evidence.level` says which: the
  workflow's own line with `level: workflow`, or the line of that job's `permissions:` key with `level: job` and
  `evidence.job`. A workflow-level `write-all` is reported even when a job narrows it, because the
  workflow still grants every scope to every job that does not narrow it — including the next job
  somebody adds. A job-level `write-all` is reported even when the workflow level is narrow, because
  that job overrides the narrow default with everything.
- `least-privilege-permissions` — one `pass` for the repository: every job's permissions come from a
  declaration and no declaration is `write-all`. `read-all`, `{}` and a map of narrow scopes are all
  least privilege here. One pass covers however many workflows pass, and it is a count in the
  summary rather than a row: a passing finding is never printed, so a repository whose every
  workflow passes reads as `1 passing` in both formats.

A repository with no workflow is `skip: no-ci`, not a pass. A workflow the reader cannot parse yields
`skip: unparseable-workflow` for that file and no pass is added on top of it. No repository facts in this scope is
`skip: no-repo`. `no-ci` covers both the absent directory and a `.github/workflows` directory that
exists and holds no workflow file — measured, both report the one skip, and the skip's message reads,
"there is no workflow file, so no workflow can declare permissions", which is the fact in either case.
The directory is never claimed to be missing, because it may exist and hold none.

Friction is 1, and the severity belongs to the rule rather than to one of its codes: measured, a
`write-all` fixture reports `warn` under `baseline` and `error` under `strict`, and an absent
declaration does the same. The rule carries none of the `error`/`error` deviation of R10 and R11,
because what a missing declaration means depends on a repository setting the tool cannot read;
`strict` calls it an error because there the declaration is required.

## Evidence

`evidence.level` is `workflow` or `job`, and a `write-all` finding is reported at the line of the
declaration that grants it. A job-level finding also carries `evidence.job`, and it is reported at the
line of that job's `permissions:` key, which is the line the fix replaces. The missing declaration has
no `write-all` line to point at: it is reported at line 1 and carries `level: workflow` with `jobs`,
the ids that inherit the repository setting.

## Remediation

`manual`, printed as the declaration to write:

- absent — add `permissions:` with `contents: read` at the top level, and widen it only in the job
  that needs it.
- `write-all` — replace it with the exact scopes the workflow or that job writes.

Measured: applying each printed instruction to the failing fixture clears its own finding, turns the
run into one counted pass, and leaves no `write-all` anywhere in the file — the declaration that
silences the finding is the declaration that narrows the grant. The workflow-level text prints "the
exact scopes the workflows write"; the job-level one prints "the exact scopes that job writes", and the
replacement keeps the indentation of the key it replaces.

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
  fact set. That is why this rule's findings are `warn` in `baseline` and `error` in `strict`
  instead of an error everywhere.

A workflow the reader cannot parse is skipped per file; a skipped file is not a pass. Only
`.github/workflows` files the collector resolved are read: a workflow invoked through a reusable
workflow in another repository, or a composite action, is outside the set.
