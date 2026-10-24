# pnpm-lock.yaml is present, tracked and not ignored

Rule id: `lockfile-committed`

## Question

Is the lockfile present, tracked, and not ignored?

## Detection

Reads the resolved facts for `pnpm-lock.yaml` at the repository root. Nothing is run and nothing is
parsed.

Inside a git repository:

| State | Status | Code |
|---|---|---|
| Absent | `fail` | `lockfile-missing` |
| Present, not in the tracked set | `fail` | `lockfile-untracked` |
| Present, tracked, matched by an ignore rule | `fail` | `lockfile-ignored` |
| Present, tracked, not ignored | `pass` | — |

Outside git only existence is checked: a present lockfile passes with a message stating that the
tracked and ignored parts were not evaluated, and an absent one still fails with
`lockfile-missing`. When git is present but did not report its tracked files, the pass says the gap
instead of claiming a check it did not perform.

An untracked lockfile is the failure mode that produces non-reproducible CI: the repository looks
locked and every runner resolves its own tree. Severity is `error` in both presets, friction 0.

## Evidence

`{ path, present, tracked, ignored }`, with `null` where git did not answer:

- `path` — always `pnpm-lock.yaml`.
- `present` — whether the file exists at the repository root.
- `tracked` — membership in the tracked file set, or `null` outside git.
- `ignored` — whether the resolved ignore verdict matches the lockfile, or `null` outside git.

## Remediation

- `lockfile-untracked` — `manual`: `git add pnpm-lock.yaml`.
- `lockfile-ignored` — `manual`: `git check-ignore -v pnpm-lock.yaml` names the file, line and
  pattern of the ignore source; the fix is removing that rule, or re-adding the file explicitly.
- `lockfile-missing` — `manual`: `pnpm install --lockfile-only` writes the lockfile without
  installing packages.
- Outside git the tracked and ignored parts are not evaluated, so no write is recommended.

The finding never performs a git write. `git add` is printed for the human, not executed.

## Limits

The rule deliberately does not compare the lockfile's `lockfileVersion` against the installed pnpm.
pnpm performs that check on install; a second copy in this tool would only be a staler source of
truth (RFC 4.1).

It also does not parse the lockfile, does not read `.gitignore`, and cannot see an ignore rule git
did not report through the collected facts. A repository that is not under version control gets the
existence answer only.
