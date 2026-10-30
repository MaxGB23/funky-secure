# RFC 0017 — the gate declares its own number

| | |
|---|---|
| **Status** | `implemented` — the managed block always writes `minimumReleaseAge`; `1440` under `baseline`, `4320` under `strict`. `0.8.2`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R2, W1b; [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.2. |
| **Supersedes** | nothing. It widens W1b from "under `--preset strict`" to "always", and keeps W1a unchanged. |

## The problem

A field agent ran the pnpm-only path and reported that the gate's threshold was not in the repository:
`quarantine` inherited whatever the active pnpm major defaults to. The report framed it as
reproducibility. Measuring the defaults shows it is worse than that.

| pnpm | `minimumReleaseAge` default |
|---|---|
| 10.16.x | `0` |
| 11.0 and later | `1440` (one day) |

And `minimumReleaseAgeStrict` defaults to `true` **only when `minimumReleaseAge` is explicitly
configured**; the built-in `1440` is deliberately non-strict.

`init --apply` at the baseline preset wrote `minimumReleaseAgeStrict: true` and no age. So:

- on pnpm 11 and 12 the repository got a strict one-day gate it never declared;
- on pnpm 10.16.x the inherited age is `0`, and `strict: true` over an age of zero **enforces nothing**.
  The managed block would describe a gate that protects nothing — the defect this product reports, in
  this product's own output;
- in every case the repository could not state its own number, and `.npmrc` is deliberately kept out of
  the repository by `sensitive-ignored`, so the value had no other home.

## The decision

**W1b always writes the age, in the same managed block.** `minimumReleaseAge: 1440` under `baseline`,
`minimumReleaseAge: 4320` under `--preset strict`. W1a keeps writing `minimumReleaseAgeStrict: true`,
which is still necessary: pnpm 12 does not default strict to true even when the age is explicit (open
upstream issue `pnpm#14409`).

The value is the one a pnpm 12 repository is already enforcing today, now written down. The policy lives
in the repository, which is the product's own first principle: a number that a clone inherits from a
tool's major version is not a policy, and a repository whose gate loosens when a tool is upgraded was
never gated.

## What it costs

One line in the block, one more key in the conflict check, and a wider W1b. A repository on pnpm 11 or
12 sees no behavioural change; a repository on pnpm 10.16.x stops believing it is protected when it is
not.

The trade is deliberate and worth naming: declaring `1440` freezes today's default in every repository
that runs `init --apply`. If pnpm raises its own default later, those repositories keep one day until
someone edits the block. That is the correct direction of authority — a security threshold should not
move under a repository without a diff — but it does mean the default is no longer inherited, and
`--preset strict` is how a reader asks for three days.

## Verification

- `init --apply` writes `minimumReleaseAgeStrict: true` and `minimumReleaseAge: 1440` in one block under
  `baseline`, and `4320` under `--preset strict`.
- A block that declares `minimumReleaseAge` outside the managed block is still a conflict, never a second
  source for the same setting.
- The created `pnpm-workspace.yaml` carries the block and nothing else — no `packages:` key.
- The rule's remediation text names the age and why it is written rather than inherited.
- Full suite and self-scan green.

## Alternatives rejected

- **Write the age only when pnpm's major is below 11.** The block would then depend on the machine that
  wrote it, and two clones of the same repository would disagree about their own policy.
- **Write `4320` always.** It would change the meaning of `baseline` for everyone who adopted it, when
  the goal was to state what `baseline` already was.
- **Leave the value inherited and document it.** Documentation is not a gate, and the case that breaks is
  the quiet one: an older major enforcing nothing while the block reads as hardened.
