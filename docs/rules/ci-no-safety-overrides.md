# CI does not disable the frozen lockfile or re-enable lifecycle scripts

Rule id: `ci-no-safety-overrides`

## Question

Does CI disable the frozen lockfile or re-enable lifecycle scripts?

## Detection

Two facts are read: every workflow through the structural reader (`src/lib/workflows.js`), and the
root `.npmrc` when it exists. Only an explicit override is interesting, because `pnpm install` is
already frozen in CI and already skips dependency lifecycle scripts (RFC 4.1, E5): a plain
`pnpm install`, `pnpm install --frozen-lockfile` and `pnpm install --ignore-scripts` are the
defaults and pass.

**Workflows.** Each `run:` body the reader attributes to a step is split into command words. A word
that begins with a quote is prose, and `#` at the start of a word begins a comment: neither is a
command, so `echo hi # --no-frozen-lockfile` and `echo "--no-frozen-lockfile"` are not findings.

- `ci-frozen-lockfile-disabled` — the word `--no-frozen-lockfile` or `--frozen-lockfile=false`.
- `ci-lifecycle-scripts-enabled` — the word `--ignore-scripts=false`, `--enable-pre-post-scripts` or
  `--enable-pre-post-scripts=true`.

Each offending word is one finding at the line of the step that carries it.

**`.npmrc`.** The repository-root file, key by key, at the 1-based line of the key:

- `frozen-lockfile=false` — `ci-frozen-lockfile-disabled`.
- `ignore-scripts=false` and `enable-pre-post-scripts=true` — `ci-lifecycle-scripts-enabled`.

A `#` or `;` comment line is not a key, so a commented-out override is never a finding.

No override anywhere is one pass carrying `code: ci-safety-defaults`. A repository with no workflow
and no `.npmrc` is `skip: no-ci`, not a pass. A workflow the reader cannot parse yields
`skip: unparseable-workflow` for that file, and the rule never adds a pass on top of it.

Friction is 1, severity is `warn` in `baseline` and `error` in `strict`.

## Evidence

For a workflow: the job, the step index, the offending word and the command line that carries it,
reported at the step line. For `.npmrc`: the key and its value, reported at the 1-based line of the
key, with `path: .npmrc` under the `repo-root` target.

## Remediation

`manual`, printed as the exact step or the removal to perform:

- a workflow: `run: pnpm install --frozen-lockfile` for a frozen-lockfile override, and
  `run: pnpm install --ignore-scripts` for a lifecycle-scripts override.
- `.npmrc`: delete the offending key. pnpm already freezes the lockfile in CI and already skips
  dependency lifecycle scripts, so the key only restores the riskier behavior.

The tool never edits a workflow and never rewrites `.npmrc`.

## Limits

It proves that no declared step and no root `.npmrc` key names the override; it does not prove the
install was frozen. An inherited environment variable, a global configuration, a composite action or
a script the step calls can still pass the same flag.

A word is classified by its own text, not by resolving it: whether the command is an install, and
which package manager would answer it, is not decided here.

Only the root `.npmrc` is read. A workspace package `.npmrc`, an `.npmrc` outside the repository, and
a `PNPM_CONFIG_*`/`NPM_CONFIG_*` environment override are outside the fact set.

A workflow the reader cannot parse is skipped per file; the rule never guesses from a line scan, and
a skipped file is not a pass.
