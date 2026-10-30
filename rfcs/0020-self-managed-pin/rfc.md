# RFC 0020 — a pin the project manages is not a conflict

| | |
|---|---|
| **Status** | `implemented` — a differing pin beside `devEngines.packageManager` is `skip` / `self-managed-pin`. `0.8.5`, a hotfix for a regression 0.8.4 introduced. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R1; [`docs/rules/package-manager-pin.md`](../../docs/rules/package-manager-pin.md). |
| **Supersedes** | nothing. It narrows R1's conflict case and leaves every other state alone. |

## The regression

0.8.4 made the version probe run outside the scanned repository, because pnpm 12 rewrote the
project's lockfile from inside it (0019). That fix was correct and it had a consequence nobody
measured: **the pnpm that answers is no longer the pnpm the project runs.**

pnpm 12 manages its own version. A project bootstrapped by `pnpm init` on 12.x now carries:

```json
"devEngines": { "packageManager": { "name": "pnpm", "version": "12.16.0", "onFail": "download" } },
"packageManager": "pnpm@12.16.0"
```

From that project's own directory, `pnpm --version` answers **12.16.0** — pnpm re-executes itself with
the version the project manages. From a neutral directory it answers **12.3.4**, the binary on `PATH`.
Both measured on one machine, minutes apart.

So `package-manager-pin` started comparing `pnpm@12.16.0` against `12.3.4` and reporting:

```
✖  Package manager  ·  package.json
   package.json declares pnpm@12.16.0, but the pnpm answering is pnpm@12.3.4
   → corepack use pnpm@12.3.4
```

A false positive whose remediation tells the user to **downgrade** a project that was working. That is
worse than the original bug: the original wrote a file, this one would break a build if followed.

## The decision

**When the project declares `devEngines.packageManager` naming pnpm, the answering binary is not
evidence about the pin.**

- If the declared pin equals the answering version, the rule still reports `pass`: the two facts agree
  and nothing is hidden.
- If they differ, the rule reports `skip` with `self-managed-pin`, and no remediation. The message says
  the project manages its own pnpm and that the pin is confirmed by running `pnpm --version` inside it.
- Without `devEngines.packageManager`, a differing pnpm version is still `pin-conflict` with the same
  remediation as before. The rule did not lose its teeth; it stopped guessing about a project that
  states its own answer.

This follows the line the rule already held: **an unverifiable pin is not a wrong pin.** `no-pnpm` and
`no-package-json` are skips for the same reason. A self-managed pin is the third way the machine can
fail to describe the project.

## What it costs

A project that pins `pnpm@12.16.0` with `devEngines` and *deliberately* runs a different pnpm is no
longer reported. That case is not worth a false positive in the common one, and the project has already
declared what it wants: `onFail: download` means pnpm will fetch the declared version rather than run
something else.

## Verification

- A manifest with `devEngines.packageManager` naming pnpm and a differing `packageManager` reports
  `skip` / `self-managed-pin`, with `remediation.kind = none`.
- The same difference without the `devEngines` entry still reports `fail` / `pin-conflict`.
- `pnpm init` on this machine wrote `12.16.0` while the binary on `PATH` was `12.3.4`; the real
  repository scanned before the fix reported a conflict, and after it reports a skip that names both
  numbers.
- Full suite: 447 tests, 446 pass, 0 fail. Self-scan exit 0.

## Alternatives rejected

- **Move the probe back inside the repository.** It would answer the right version and rewrite the
  user's lockfile again, which 0019 exists to prevent.
- **Compare against `devEngines.packageManager.version` instead of the pin.** It would report a
  pass built from two fields of the same file, which verifies nothing about the machine.
- **Downgrade the conflict to `warn`.** A warning still tells the user their working project is wrong,
  and the remediation still reads as an instruction.
