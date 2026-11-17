# No other package manager shapes this repository

Rule id: `foreign-lockfile`

## Question

Does another package manager still shape this repository?

## Detection

Reads the resolved presence list for four files at the repository root: `package-lock.json`,
`yarn.lock`, `bun.lock` and `bun.lockb`.

- None present: `pass`.
- One or more present: a single `fail` finding, code `foreign-lockfile`, listing all of them.

When `pnpm-lock.yaml` coexists with a foreign lockfile, the finding is an `error` in `baseline`, in
`strict` and in `starter`, because two lockfiles resolve two dependency trees — the state that works
locally and breaks in CI. A foreign lockfile that stands alone is a `warn`: the product recommends
pnpm, it does not require it (G4), and that is the case the declared deviation from the friction
table of RFC 4.2 covers, where friction 0 would start at `error`. Coexistence is not a preference — it
is two resolutions of one manifest — so the deviation does not reach it (RFC 0029).

Friction is 0, and severity follows the state in every preset: `warn` while the foreign lockfile
stands alone, `error` while `pnpm-lock.yaml` coexists with it. `baseline` and `strict` run every rule;
`starter`, the day-zero preset, runs six, and this rule is one of them, at those same severities. No
preset turns it off. A repository that means to keep its foreign lockfile stops asking the question
with `--ignore foreign-lockfile`, with `--only` naming other rules, or with
`"rules": { "foreign-lockfile": "off" }` in the config file — and each of those leaves neither a
finding nor a count.

## Evidence

`{ files, pnpmLockfile }`:

- `files` — the foreign lockfiles found, in catalog order, as repo-relative names.
- `pnpmLockfile` — whether `pnpm-lock.yaml` is present at the root.

## Remediation

`manual`, through the migrate plan (RFC 11.3). The printed route is the sequence that works from the
state, not one command that refuses in it: removing a foreign lockfile is step 4 of the plan, and it
runs only after `pnpm-lock.yaml` exists, so a repository without that file is told to create it first.

- `pnpm import && funky-secure migrate --from npm --apply` when `package-lock.json` is present.
- `pnpm import && funky-secure migrate --from yarn --apply` when `yarn.lock` is the foreign lockfile.
- `pnpm import && funky-secure migrate --from auto --apply` when only a bun lockfile is present; the
  plan resolves the origin.

While `pnpm-lock.yaml` coexists with the foreign lockfile the lockfile step is already done, so the
finding prints `funky-secure migrate --from npm --apply` alone. Never delete the only lockfile a
repository has: asked to, `migrate` refuses (exit 3, nothing written) and names `pnpm import` as the
step to run first — the refusal the sequence exists to keep the reader out of.

The rule's location is the repository root: the finding carries no `path`, lists the files it found in
`evidence.files`, and a report counts it in the `REPO-ROOT` block.

A foreign lockfile that stands alone is a `warn`, so `scan` passes the run at the default threshold
while the finding names the route above. The closing `next` block names that same route instead of
`nothing to do`, because a run that lists an action cannot end by saying there is nothing to do (RFC
10.3, #360):

```text
  ⚠  Foreign lockfile
     package-lock.json is still present; another package manager still shapes this
     repository
     → pnpm import && funky-secure migrate --from npm --apply

next     pnpm import && funky-secure migrate --from npm --apply
```

## Limits

The rule lists files; it does not read them, does not decide which tree wins and deletes nothing.

A repository on another manager that holds a single lockfile is warned about, never gated. Only the
coexistence state is gated, and it is gated in all three presets. A repository that intentionally
keeps a foreign lockfile can turn the rule off, and the report then carries neither a finding nor a
count for it.
