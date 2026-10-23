# No other package manager shapes this repository

Rule id: `foreign-lockfile`

## Question

Does another package manager still shape this repository?

## Detection

Reads the resolved presence list for four files at the repository root: `package-lock.json`,
`yarn.lock`, `bun.lock` and `bun.lockb`.

- None present: `pass`.
- One or more present: a single `fail` finding, code `foreign-lockfile`, listing all of them.

When `pnpm-lock.yaml` coexists with a foreign lockfile, the message uses error-level wording because
two lockfiles resolve two dependency trees — the state that works locally and breaks in CI. The
severity stays `warn` in both presets: the product recommends pnpm, it does not require it (G4).
This is a declared deviation from the friction table of RFC 4.2, where friction 0 would start at
`error`; G4 wins, and the deviation is recorded here and in RFC 9.1.

Friction is 0, severity is `warn` in `baseline` and `warn` in `strict`.

## Evidence

`{ files, pnpmLockfile }`:

- `files` — the foreign lockfiles found, in catalog order, as repo-relative names.
- `pnpmLockfile` — whether `pnpm-lock.yaml` is present at the root.

## Remediation

`manual`, through the migrate plan (RFC 11.3):

- `funky-secure migrate --from npm --apply` when `package-lock.json` is present.
- `funky-secure migrate --from yarn --apply` when `yarn.lock` is the foreign lockfile.
- `funky-secure migrate --from auto --apply` when only a bun lockfile is present; the plan resolves
  the origin.

The removal of a foreign lockfile is step 4 of that plan, and it runs only after `pnpm-lock.yaml`
exists. Never delete the only lockfile a repository has.

## Limits

The rule lists files; it does not read them, does not decide which tree wins and deletes nothing.

Severity stays `warn` in `strict` as well as `baseline`, so a repository on another manager is
warned about, never gated. A repository that intentionally keeps a foreign lockfile can turn the
rule off, and the documentation still reports it.
