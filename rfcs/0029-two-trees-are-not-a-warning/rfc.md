# RFC 0029 — two trees are not a warning

| | |
|---|---|
| **Status** | `draft` — the rule's message says CI breaks and its severity says nothing is wrong. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R3 and [`docs/spec/policy.md`](../../docs/spec/policy.md) §9.1, both of which fix `warn` in every preset. |
| **Supersedes** | nothing. It narrows a declared deviation from 0001 §4.2, without reopening the goal it defends. |

## What a reader meets today

`foreign-lockfile` is `warn` in `baseline`, in `strict` and in `starter`. When `pnpm-lock.yaml` coexists
with `package-lock.json` — the state a single accidental `npm install` produces — the message escalates
to error-level wording, because two lockfiles resolve two dependency trees. The severity does not follow:

> Mensaje de error, veredicto verde. Un npm install accidental no rompe CI.

The owner's report is exact. `--fail-on` defaults to `error` (§10.5, `src/cli.js`), so a `warn` finding
cannot fail a CI that was never configured: the run exits `0`, the pull request is green, and the
sentence that says CI will break is printed by the same output that says everything is fine. This tool's
own CI passes `--fail-on warn`, which means the repository has been telling its users less than it tells
itself.

## Why the deviation existed, and why it does not reach this case

0001 §4.2 would make a friction-0 rule `error`. §9.1 records the deviation for one reason: **G4 says
recommend pnpm, it does not require it.** A repository that decided on npm is not a repository in a
broken state, and failing it would be the product insisting on its own preference.

That reasoning holds for a foreign lockfile that stands **alone** — the repository is on npm, the
product suggests leaving, and a suggestion is a `warn`. It does not survive the move to coexistence:

- Two lockfiles are not a preference. They are two resolutions of the same manifest, one of which wins
  locally and one of which wins in CI, and pnpm never reads the other file.
- The state is not "you chose another manager". It is "this repository has two, and nothing decides
  which". A tool that calls that acceptable is not deferring to a preference; it is declining to name a
  defect it has already diagnosed in its own message.
- The refusal is not "use pnpm". `migrate` remains the remediation, and `migrate --from npm --apply` is
  still a plan a human runs. The rule reports the state; the remedy is still a suggestion.

## The decision

**`foreign-lockfile` is `error` when a foreign lockfile coexists with `pnpm-lock.yaml`, and stays `warn`
when it stands alone.**

- **One rule, one code, two severities by state.** Not a second rule id: the question the rule asks is the
  same question, and a reader who meets `foreign-lockfile` should not have to learn which of two ids
  applies to the state in front of them. The `evidence` already carries `pnpmLockfile: true|false`, so the
  split needs no new probe and no new field.
- **The policy table states the split, and says why.** §9.1 loses the unconditional sentence and gains
  the condition. `starter` inherits it: the preset keeps the `warn` of `baseline` for a standalone
  foreign lockfile, and the coexistence state is the one place it is not gentle — because a repository
  on day zero with two lockfiles is exactly the repository nobody should leave that way overnight.
- **`--fail-on` is untouched.** The default stays `error` and the finding now matches it. A user who
  wants warnings to fail still has `--fail-on warn`; a user who wants nothing to fail has `none`, and
  `none` becomes the only way to see this state in green — which is the point.
- **The message stops escalating and starts stating.** With the severity now carrying the weight, the
  sentence says what is true in both cases and the two wording registers collapse into one: the state is
  named, and the `warn`/`error` distinction is the policy's job, not the sentence's.

## What this record does not change

- **The catalog, the rule id, the detection and the remediation.** `migrate --from npm|yarn|auto --apply`
  is unchanged, and the rule still reads the presence list and never the lockfiles (0001 §8.2 R3).
- **A repository on yarna or bun with no pnpm lockfile.** That is a preference, and the product still only
  recommends.
- **The `starter` set of six.** No rule is added or removed from the preset; one severity inside it
  becomes conditional.
- **`no-bot-auto-merge`, `pull-request-target` and the rest of the CI family.** They are `error` already,
  and this record does not touch the catalog beyond R3.

## Evidence

- The severity and the message are both visible in [`src/rules/foreign-lockfile.js`](../../src/rules/foreign-lockfile.js)
  (`severity: { baseline: 'warn', strict: 'warn' }`, and the `pnpmLockfile ? … : …` branch that writes
  "two lockfiles resolve two dependency trees, so the install works locally and breaks in CI").
- The default that makes the mismatch matter is `src/cli.js` (`failOn: 'error'`) and §10.5.
- The owner's reproduction: `preset baseline → 0 errors · 1 warning · PASS · exit 0` with a
  `package-lock.json` created beside `pnpm-lock.yaml`, in both `baseline` and `strict`.
