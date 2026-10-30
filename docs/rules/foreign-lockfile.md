# No other package manager shapes this repository

Rule id: `foreign-lockfile`

## Question

Does another package manager still shape this repository?

## Detection

Reads the resolved presence list for four files at the repository root: `package-lock.json`,
`yarn.lock`, `bun.lock` and `bun.lockb`.

- None present: `pass`.
- One or more present: a single `fail` finding, code `foreign-lockfile`, listing all of them.

When `pnpm-lock.yaml` coexists with a foreign lockfile, the finding is an `error` in `baseline` and
in `strict`, because two lockfiles resolve two dependency trees — the state that works locally and
breaks in CI. A foreign lockfile that stands alone is a `warn`: the product recommends pnpm, it does
not require it (G4), and that is the case the declared deviation from the friction table of RFC 4.2
covers, where friction 0 would start at `error`. Coexistence is not a preference — it is two
resolutions of one manifest — so the deviation does not reach it (RFC 0029).

Friction is 0, and severity follows the state in both presets: `warn` while the foreign lockfile
stands alone, `error` while `pnpm-lock.yaml` coexists with it.

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

A repository on another manager that holds a single lockfile is warned about, never gated. Only the
coexistence state is gated, and it is gated in both presets. A repository that intentionally keeps a
foreign lockfile can turn the rule off, and the documentation still reports it.
