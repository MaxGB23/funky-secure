# Quarantine is a gate, not an approval list

Rule id: `quarantine`

## Question

Is the release-age quarantine an actual gate — a decision a human has to make — rather than an
automatic approval list that admits whatever it is pointed at?

The distinction is not cosmetic. pnpm applies a built-in `minimumReleaseAge` of **1440 minutes** on
the 11/12 line and does not report it in `pnpm config list --json`. It also applies it
**non-strictly**: when a resolution meets an immature package it appends a `minimumReleaseAgeExclude`
entry to `pnpm-workspace.yaml` and exits `0` — under `CI=true` too (E1, section 2.2). The number is
present and the gate is not. Only an explicitly configured `minimumReleaseAge` makes
`minimumReleaseAgeStrict` default to true, and only then does the install fail with
`ERR_PNPM_NO_MATURE_MATCHING_VERSION`, or the lockfile check with
`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`.

This is why the rule never reports "no value": absent means **inherited**, never disabled.

## Detection

Read `minimumReleaseAge`, `minimumReleaseAgeStrict` and `minimumReleaseAgeExclude` from
`ctx.machine.config`, the effective configuration `pnpm config list --json` reported (E2).

- **Effective value.** The reported `minimumReleaseAge` when present. Otherwise the documented
  built-in default for the active major — 1440 minutes on the 11/12 line, 0 before 11 — marked
  `inherited: true`. This is measured behaviour, not a claim about a file: pnpm omits the key when
  it is unset (E1 section 2.1).
- **Effective strictness.** The reported `minimumReleaseAgeStrict` when present. Otherwise the
  manager's own rule measured in E1 section 2.5: true only when `minimumReleaseAge` was explicitly
  configured, false for the built-in default.
- **Floor.** `policy.quarantineMinutes` (RFC 9.4): the repository override, else 4320 for `strict`,
  else the built-in default of the active major. The rule reads it from its second argument; until
  the engine passes the policy, it falls back to the baseline floor of the active major, which is
  what the evidence reports.

The rule passes **only** when the strictness is effective **and** the effective value is at least
the floor. Two failure codes keep the reasons distinguishable without parsing a message:

- `quarantine-not-strict` — auto-approval mode. The message names the effective value and whether it
  is inherited or configured, for example
  `quarantine is non-strict: pnpm auto-approves immature packages by writing minimumReleaseAgeExclude (inherited 1440)`.
- `quarantine-below-policy` — a real gate, shorter than the preset floor.

No configuration at all (`pnpm config list --json` unavailable) is `skip: no-pnpm-config` with
`probeUnavailable: true`, so `--strict-probes` turns it into an error instead of a silent pass. A
`minimumReleaseAge` that is not a number is `skip: unreadable-minimum-release-age` for the same
reason: a coerced zero would be a claim the configuration never made.

A machine excluded by the scope contract is different (RFC 7.2, S6): under `--scope repo` the
machine facts are absent by contract, so the skip is `machine-out-of-scope`, it is not an
unavailable required probe, and its message says what was not verified and the command that
verifies it:

> skipped: the quarantine was not verified because the machine configuration is out of scope; run
> funky-secure scan --scope all to verify the release-age gate

**Declared severity deviation (RFC 8.2 R4, 9.1).** `warn` in `baseline`, `error` in `strict`.
Friction 2 would be `warn` in both presets; `strict` promotes it because that is the author's own
bar, while `baseline` only warns on the inherited non-strict default so the rule stays adoptable
anywhere.

## Evidence

`{ effective, inherited, strict, policy, exclusions }`: the effective age in minutes, whether it was
inherited from the manager or configured, the effective strictness, the floor it was compared with,
and every `minimumReleaseAgeExclude` entry (an empty array when absent). The exclusion list is
evidence in its own right: in non-strict mode pnpm itself grows it, and an exemption must never be
invisible in review.

The report does **not** claim where the value came from. The effective listing merges global,
workspace and environment configuration and carries no origin field (E2), so an attribution would be
a guess.

## Remediation

`auto`: `funky-secure init --apply` writes the managed block that sets
`minimumReleaseAgeStrict: true`, plus `minimumReleaseAge: 4320` under `--preset strict`.

Manual equivalents: `pnpm config set minimum-release-age-strict true --location=project` and
`pnpm config set minimum-release-age 4320 --location=project`. In pnpm 12 both write
`pnpm-workspace.yaml`, because project config **is** that file (E8); `--location=global` writes the
pnpm global `config.yaml`. An `.npmrc` is never involved.

The hotfix escape hatch is `minimumReleaseAgeExclude`, the list pnpm already writes in non-strict
mode. An exemption is a reviewed line in `pnpm-workspace.yaml`, not a silent auto-approval.

## Limits

- A hand-written `minimum-release-age` in a project or user `.npmrc` is **silently ignored** by pnpm
  (E8). This rule can only see what `pnpm config list --json` reports, so such a file cannot be
  detected as a wrong setting; the report says what pnpm will apply, not what a file claims.
- The effective value has no attributable source (E2). The rule never says "global" or "workspace".
- When `pnpm --version` is unavailable the active major is unknown and the 11/12 line default is
  used. That direction can only under-report a gate, never fabricate one: an inherited value is
  non-strict and fails anyway.
- The rule does not read the registry and never dates a package. pnpm's own lockfile verification
  uses a different publication timestamp than the registry `time` map (E1 section 2.6), so
  cross-checking a date here would invent a second, staler source of truth.
