# RFC 0014 — the version and its peer suffix

| | |
|---|---|
| **Status** | `implemented` — `recordedVersion` returns the bare version, and `--help` names exit `3`. `0.7.3`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R5, "Lockfile reader scope"; [`docs/spec/commands.md`](../../docs/spec/commands.md) §10.4. |
| **Supersedes** | nothing. It corrects a read that 0001 wrote, inside the subset it already claimed. |

## The defect

A field agent ran `pin --apply` on a `create-next-app` project and the manifest came back like this:

```json
"@types/react-dom": "19.3.0(@types/react@19.3.0)",
"eslint": "9.39.5(jiti@2.7.0)(supports-color@7.2.0)"
```

Neither is a specifier. The plan's own next step then failed:

```
ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER
  "eslint@9.39.5(jiti@2.7.0)(supports-color@7.2.0)" isn't supported by any available resolver.
```

The command exited `0` both times.

**The cause is one shared read, not a mistake in `pin`.** pnpm records a snapshot resolved against peers
as `version: 9.39.5(jiti@2.7.0)(supports-color@7.2.0)` — the parenthesised tail names the peer set the
snapshot was built with, and the version is what precedes the first paren. `recordedVersion` returned the
whole string, and three call sites consume it:

| Call site | What it did with `9.39.5(jiti@…)` |
|---|---|
| `pin` | wrote it into `package.json` as a specifier the resolver rejects |
| `exact-versions` remediation | printed `pnpm pkg set '…'=9.39.5(jiti@…)`, which cannot work |
| `exact-versions` desync comparison | compared a bare `9.39.5` against the suffixed string and reported a desync that was not there |

The reach is the point: any dependency with peers — `eslint`, `react-dom`, `@types/react-dom`, `next`,
`@dnd-kit/*` — which is most of a real dependency set. On the author's Next 16.0.10 project, the root
importer alone records five such entries.

## The decision

**Read the version, not the snapshot identity.** `recordedVersion` cuts at the first `(`. A version can
never contain a paren; a peer set always starts with one. The suffix is metadata about *how* a package
was resolved, and every consumer of this function asks *what version*.

**Fix it in the reader, once.** `pin` and the rule already share `recordedVersion` — that sharing was the
deliberate move of 0011, and it is what makes one line here repair three behaviours. A guard in `pin`
alone would have left the remediation string and the false desync in place.

**Validate nothing else.** The value is now a bare version by construction, so no second schema check is
added: a resolver is the authority on what a specifier admits, and guessing at it here would be a
private copy of its rules.

**The help names exit `3`.** `--help` listed `0 · 1 · 2` while three writers returned `3` and the shipped
skill documented it. The surface an agent is told to treat as authoritative has to carry the complete
set, or the convention lives only in prose.

## What it costs

Two lines in the reader and one in the help. No schema change, no new flag, no behaviour that a
repository without peers can notice.

## Verification

- A lockfile whose importer records `9.39.5(jiti@2.7.0)(supports-color@7.2.0)` and
  `16.0.10(react-dom@19.2.3(react@19.2.3))(react@19.2.3)` reads `9.39.5` and `16.0.10`.
- The Next 16.0.10 project's real lockfile reads `6.3.1` and `16.0.10` where it used to read the full
  snapshot identity.
- `pin --apply` over that project's manifest writes no specifier containing a paren.
- `pnpm install --lockfile-only` over the result passes, including its 375 supply-chain policy entries —
  the exact command that failed in the field report.
- `--help` prints the fourth code.

## What this says about the fixture

The reader's tests were written by the same hand as the reader, from the shape its author imagined, so
they only ever exercised versions without peers. The scenario kit and a real project found in one run
what the fixture could not. The durable correction is not this patch: it is that a lockfile fixture must
come from a generator, and 0008's lesson repeats — a rule that never runs and a value that is wrong in
the same direction both look like `PASS`.
