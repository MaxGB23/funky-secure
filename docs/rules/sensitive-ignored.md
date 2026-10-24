# Sensitive files are ignored and untracked

Rule id: `sensitive-ignored`

## Question

Would this repository ignore the files that must never be committed?

The answer is behavioral, not textual. A `.gitignore` line is a claim; `git check-ignore` is the
verdict. A later negation (`!.env`) or a nested ignore file changes the truth, so reading the
`.gitignore` text and grepping for `.env` is exactly the kind of stale assertion this tool exists to
remove (E3).

## Detection

The rule reads the resolved facts collected once per scan: `ctx.repo.ignored`, the per-path result of
`git check-ignore --no-index --stdin -z` for the declared candidates (RFC 12.1), invoked **without**
`-v` because with `-v` a negated path returns exit `0` and prints the negation pattern, inverting the
verdict (E3).

For each candidate path not present in that result — `.env`, `.env.local`, `.env.production`,
`secrets.pem`, `server.key`, `.npmrc` — the rule fails. The missing entries are reported as **one**
`not-ignored` finding carrying the whole list, so one rule keeps one line in the report and the
remediation is one append.

Two further facts are reported independently:

- Every tracked path matching `*.pem` or `*.key` is one `tracked-sensitive-file` finding. Tracked
  means it is already in the index: ignore coverage came too late for it.
- A root `.npmrc` whose text contains a literal `_authToken=` is one `npmrc-token` finding. Presence
  is the fact and the value is `<redacted>` (RFC 12.3) — the rule never prints a token, not even in
  `--format json`.

Outside git (`git rev-parse --show-toplevel` failed) the rule is `skip: no-git` with
`probeUnavailable: true`, never a pass: a repository whose ignore coverage was not measured has not
proved anything. `--strict-probes` therefore turns that skip into an error in CI. When `git ls-files`
cannot answer, the tracked check is `skip: unreadable-tracked-files` instead of an assumed empty
tracked set, and the ignore findings still stand.

All candidates ignored, nothing sensitive tracked and no token is a pass.

## Evidence

- `not-ignored`: `{ path: '.gitignore', missing: [...] }` — every missing candidate, in the declared
  order.
- `tracked-sensitive-file`: `{ path }`.
- `npmrc-token`: `{ path: '.npmrc', token: '<redacted>' }`.

## Remediation

`auto`: `funky-secure init --apply` appends the missing entries to the managed `.gitignore` block.

A tracked sensitive file is manual: `git rm --cached <path>`. Removing a file from the index does not
remove it from history, so a credential that was committed must be rotated — the removal command
alone is not the fix. A tracked root `.npmrc` with a token is removed the same way; an untracked one
is a local credential the rule reports but cannot remove for you.

## Limits

- The rule answers for the six declared candidate paths. Any other sensitive name depends on the
  ignore file the repository already wrote; the rule does not guess a name it was not given.
- A root `.npmrc` that is **tracked and carries no token** is the one documented exception: the
  repository commits it deliberately, so the rule does not demand that it be ignored, and the write
  that fixes ignore coverage does not add it. The exception is resolved by the collector, once, so the
  rule and the write cannot disagree about it. A tracked `.npmrc` **with** a token is reported.
- Ignore coverage is not a history claim. A file that is unignored today may be committed tomorrow,
  and a file removed from the index still exists in earlier commits.
- The token check reads the root `.npmrc` only, and reports presence rather than content. A token in
  another file, or an authentication setting written as something other than `_authToken=`, is
  outside the contract.
- The rule does not demand that `.npmrc` be ignored when a project legitimately commits one without
  tokens; the token finding is separate evidence about that instance only.
- An ignore result is the answer of the git version that ran the probe, on the checkout that ran it.
  It is deterministic for that state and says nothing about another clone.
