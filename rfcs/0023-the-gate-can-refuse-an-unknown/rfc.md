# RFC 0023 — the gate can refuse an unknown

| | |
|---|---|
| **Status** | `implemented` — `--require-verified` puts coverage into the verdict, `--version` answers the install question, and `scripts/pack-smoke.js` runs the packed tarball. `0.8.8`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/report.md`](../../docs/spec/report.md) §10.3 as amended here; [`docs/cli.md`](../../docs/cli.md). |
| **Supersedes** | nothing. |

## What the three have in common

Nothing can check a claim about itself from inside the thing that makes the claim.

- **A green gate** claims the repository is at policy. A `skip` is a rule that decided nothing, and until
  now it never failed the run: `scan --scope repo` could print `PASS … 2 rules not verified` and exit 0.
  The verdict names them (0022) but the exit code does not care, so a CI that reads only the exit code
  believes a coverage it never had.
- **A package** claims to install and run. The suite runs from the repository, where every path exists,
  so a `files` mistake in `package.json` — `src/` left out, the bin removed — passes every test and fails
  every user.
- **An installation** claims a version. There was no way to ask the installed tool which build it is:
  `--version` was rejected as an unknown flag.

## The decision

- **`--require-verified`** (scan only) makes any skipped rule a failing verdict: the run exits 1 and the
  JSON says `verdict: "fail"`, with `policy.requireVerified: true` recorded beside the threshold that
  decided it. Without the flag nothing changes, because not knowing is not a violation — the default
  stays honest for a repository whose managers are absent.
- **`--version`** prints the shipped `package.json` version and exits 0, before any command is resolved.
  It reads nothing: no repository, no config, no probe.
- **`scripts/pack-smoke.js`** packs, installs the tarball into an empty directory, asks the installed
  binary for its version, and runs a report from a directory the package never wrote. It runs in
  `prepublishOnly`, so a publication cannot happen without it.

## Why the verdict changes and not only the exit code

One run must not produce two answers. A `verdict: "pass"` beside exit 1 would leave a machine reading the
JSON and a CI reading the exit code in disagreement about the same scan, and the JSON is the contract. So
with the flag, the gate's definition of a violation widens: unverified is not merely unmeasured, it is
refused.

## What it costs

An opt-in flag that turns previously green builds red for anyone who adopts it, and one more line of
output in `--help`. Both are the point: a flag that cannot change a verdict is a comment.

## Verification

- A lockfile declaring `catalogs` scanned with `--require-verified` exits 1, and its JSON carries
  `verdict: "fail"` and `policy.requireVerified: true`; the same scan without the flag exits 0.
- A repository where every selected rule answered keeps exit 0 under the flag.
- `funky-secure --version` prints `0.8.8`; the help lists it.
- `node scripts/pack-smoke.js` packs `funky-secure-0.8.8.tgz`, installs it into an empty directory, and
  gets `0.8.8` from the installed binary and a report whose `tool.version` matches.
- 452 tests, 451 pass (1 skipped by platform), 0 fail. Self-scan exit 0.

## Alternatives rejected

- **Fail on any skip by default.** A machine without pnpm, or a lockfile shape the tool refuses, would
  make the default gate unusable on correct repositories. Opt-in keeps the default honest and lets a CI
  choose the stricter claim.
- **`--version` as a flag of `scan`.** It answers about the package, not about a repository; it belongs
  before command resolution.
- **Publishing and checking the tarball afterwards.** The first broken publication is already public, and
  `files` is exactly the kind of change whose failure mode is "installs, does not start".
