# RFC 0007 — Remediation routes

| | |
|---|---|
| **Status** | `implemented` — the scoped `pkg set` path and the file the manual quarantine route lands in. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R5 and §8.2 R4, and the `remediation` string of `src/rules/exact-versions.js` and `src/rules/quarantine.js`. |
| **Supersedes** | nothing. It corrects two commands without replacing a rule. |

## The problem

A finding is only worth the command it prints. Two of those commands were wrong in the direction that
costs the reader the most: they fail on the case the rule is most likely to fire on, or they send the
reader to a file another rule requires them to ignore.

`exact-versions` printed `pnpm pkg set '<section>.<name>=<version>'`. On pnpm 12.3.4 that command exits
non-zero for every scoped name:

```
$ pnpm pkg set 'devDependencies.@types/node=20.19.43'
  × Invalid property path: Unexpected token "@" in property path
    ERR_PNPM_PKG_INVALID_PROPERTY_PATH
```

A dot path cannot carry an `@`. In a project created by `create-next-app`, `@types/*` and
`@tailwindcss/*` are most of the dependency set, so the primary remediation failed on the common case,
and the reader had to edit specifiers by hand.

`quarantine` printed `pnpm config set minimum-release-age-strict true --location=project` with no note
of where that lands. The specification already said it: in pnpm 12, project configuration **is**
`pnpm-workspace.yaml`, and an `.npmrc` is never involved (E8). The message dropped the qualifier, and a
careful reader concluded the remediation writes `.npmrc` — the one path `sensitive-ignored` requires to
stay ignored. A message that makes a careful reader reach a false conclusion is the defect, even when
the fact is written down one file away.

## The decision

**The property path is bracketed, on every name.** `pnpm pkg set '<section>["<name>"]=<version>'`
works for `@types/node` and for `is-number`, so there is one form and one thing to remember. Reviewed
against the alternative — bracket only when the name is scoped — which keeps two forms and buys
nothing.

**A remediation names the file the value lands in.** The manual quarantine route reads `pnpm config set
minimum-release-age-strict true --location=project, which in pnpm 12 writes pnpm-workspace.yaml and
never a .npmrc`, and the same sentence notes that `.npmrc` is where `sensitive-ignored` requires tokens
to stay. The fix is one clause, not a second remediation.

**The pin is a `pkg set`, never an `add`.** `pnpm add --save-exact <name>@<range>` exits 0 and keeps the
declared range on pnpm 12.3.4. The specification had drifted from the measurement: it named `pnpm add
--save-exact` as the remediation that "works whatever the configuration surfaces are". It does not, and
8.2 R5 now states the measured command and records why the other is not it.

## What it costs

Nothing in detection, nothing in severity, nothing in the JSON shape beyond one string in
`remediation.command`. The goldens move by one line: `tests/golden/dirty.json` carries the bracketed
form of the same finding. `savePrefix: ''` still prevents future floats, so the rule keeps reporting a
range that a configuration change has stopped protecting.

## Verification

Measured on pnpm 12.3.4 in a scratch repository with a Next-shaped dependency set
(`@types/node`, `@tailwindcss/postcss`, `typescript`, `is-number`) and a lockfile recording the resolved
versions:

- The scan emits four bracketed commands.
- Running them leaves `"@tailwindcss/postcss": "4.1.13"`, `"@types/node": "20.19.43"`,
  `"typescript": "5.9.2"` and `"is-number": "7.0.0"` — exact, scoped and unscoped alike.
- The dot form fails on the scoped names and succeeds on the unscoped one, which is why the old command
  looked correct in every fixture that used `left-pad`.
- `pnpm config set minimum-release-age-strict true --location=project` creates `pnpm-workspace.yaml` and
  no `.npmrc`, confirming the sentence the message now carries.

## Alternatives rejected

- **Emit both forms.** Two commands for one finding doubles the line and asks the reader to know which
  applies.
- **Keep the dot form and document the failure.** The rule page is read after the message, not before.
- **Move the quarantine fact to the rule page only.** It is already there. The message is what the
  reader acts on.
