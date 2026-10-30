# Measurements behind RFC 0030

Two sessions, 2026-10-30. All cases ran in isolated directories under `.tmp/phase1/` (git-ignored), each
with its own `pnpm-workspace.yaml` so the repository root's workspace could not be touched. `package.json`
was hashed before and after every case: it was identical in all of them. `pnpm-lock.yaml` and
`package-lock.json` verdicts are byte comparisons, not readings.

**Environment:** node `v24.16.0`, npm `11.13.0`, pnpm `12.3.4` (the only pnpm installed). pnpm `11.28.10`
was obtained as a local tarball (`npm pack pnpm@11.28.10`, no global install) and run as
`node package/bin/pnpm.mjs`.

## 1. The value that guards the repository also disables the mechanism that makes the pin work

`packageManager: "pnpm@12.3.4"` in the manifest, running pnpm **11.28.10**:

| `devEngines.packageManager` | exit | what happened |
|---|---|---|
| absent | **0** | re-executed as 12.3.4 — `Done in 69ms using pnpm v12.3.4` |
| `{version: "12.3.4", onFail: "error"}` | **1** | *"This project is configured to use 12.3.4 of pnpm. Your current pnpm is v11.28.10"* |
| `{version: "12.3.4"}` — no `onFail` | **0** | re-executed as 12.3.4 — `Done in 52ms using pnpm v12.3.4` |

Writing `onFail: "error"` converts the pin from "works on any machine" into "install the right pnpm
first". Omitting the key leaves pnpm on its documented default (`pmOnFail: download`), which is the
behaviour the pin already relies on.

## 2. npm's own default is the strict one

`devEngines.packageManager: {name: "pnpm", version: "12.16.0"}`, npm **11.13.0**:

| `onFail` in the manifest | exit | `package-lock.json` |
|---|---|---|
| absent | **1** | not written — `npm error code EBADDEVENGINES` |
| `"warn"` | **0** | **written** — `npm warn EBADDEVENGINES` |
| `"error"` | **1** | not written |

And with the pin present as well (`packageManager: "pnpm@12.3.4"` + the field): `npm install` exit 1,
`npm ci` exit 1 (the check runs before the missing-lockfile error), no lockfile written. `npm install
--force` and `npm ci --force` exit **0** and write `package-lock.json` — the bypass is real and documented
in npm's own source.

## 3. pnpm reads the field, and each `onFail` value does something different

`devEngines.packageManager.version` deliberately different from the running pnpm:

| `onFail` | pnpm 12.3.4 | pnpm 11.28.10 |
|---|---|---|
| `error` | exit 1, `ERR_PNPM_BAD_PM_VERSION`, lock untouched | exit 1, same |
| `warn` | exit 0, **lock rewritten** recording 10.0.0 | exit 0, lock untouched |
| `ignore` | exit 0, silent, nothing touched | exit 0, nothing touched |
| `download` (pnpm's default) | exit 0, downloaded and re-executed: `pnpm --version` inside the directory answered `10.0.0` | same |

With versions **matching**, `packageManager: pnpm@12.3.4` + `devEngines {version: 12.3.4}` on pnpm 12
produces a `pnpm-lock.yaml` **byte-identical** to the pin-only control. On pnpm 11 the lockfile gains a
`packageManagerDependencies` block, and `--frozen-lockfile` fails with *"Cannot update
packageManagerDependencies with \"frozen-lockfile\" because the lockfile is not up to date"* until that
resolve has run once; after it, `--frozen-lockfile` is green.

`--pm-on-fail=ignore` on the command line overrides `onFail: "error"` on both majors: exit 0, no message.

## 4. `preferFrozenLockfile` is not the production gate

Recorded here because the decision was argued against it:

| state | command | exit | lockfile |
|---|---|---|---|
| lockfile satisfies the manifest | `install` | 0 | byte-identical (`Done in 2ms`, headless) |
| manifest changed, lockfile stale | `install --frozen-lockfile` | 1 | unchanged, `ERR_PNPM_OUTDATED_LOCKFILE` |
| manifest changed, lockfile stale | `install` | 0 | **rewritten** |
| manifest changed, lockfile stale | `CI=true install` | 1 | unchanged, `ERR_PNPM_OUTDATED_LOCKFILE` |
| manifest changed, lockfile stale | `CI=true install --no-frozen-lockfile` | 0 | rewritten |

`preferFrozenLockfile` (default `true`) only skips resolution when the lockfile already satisfies the
manifest; it is an optimisation of the healthy path, not a guarantee. `frozenLockfile` is the guarantee,
and it defaults to true only under CI.

## Not verified

- pnpm 11 ran from a tarball with version management neutralised where a case needed the running major to
  stay put; its results describe pnpm 11.28.10, not "whatever pnpm 11 the reader has".
- `onFail: "download"` for a version inside the machine's `minimumReleaseAge` window is refused
  (`ERR_PNPM_NO_MATURE_MATCHING_VERSION`), so the download path was measured with a version outside it.
- npm versions other than 11.13.0 were not measured; the whole npm 10 line is unmeasured.
- yarn and bun were not measured at all.
