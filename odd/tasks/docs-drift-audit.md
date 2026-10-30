# Documentation drift — audited at 0.8.8

Read-only audit of every document against the code, delegated to a `funky-lakra` session and reproduced
with commands on scratch copies under `M:/pruebas/docs-audit/`. 60 findings. Grouped by cause here; the
auditor's per-line table is the evidence and each row below cites it.

## The structural finding: the spec and the code disagree about exit codes

`docs/spec/commands.md:102`, `:157`, `docs/concept.md:48`, `docs/guide.md:110`, `docs/architecture.md:99`,
`:139` and `CONTRIBUTING.md:47` all say a **refusal exits 2**. Measured: a dirty `init --apply` and a
`migrate --apply` without a lockfile both exit **3** (`src/cli.js:353`, `RefusalError`). `docs/cli.md` and
`docs/spec/report.md` already say 3.

This is the one class where the documentation is not merely stale but **normatively wrong**, and it is a
decision, not a typo: either the spec's four codes become five (or 2 is redefined), or the code changes.
The code has said 3 since 0008 — "the tool decided not to act" is a different answer from "the tool could
not answer" — so the spec is what moved, and it needs a declared amendment.

## Cause 1 — a fix landed in code and stopped there

Five documents still print a step the code no longer prints:

| Where | Says | Now |
|---|---|---|
`docs/spec/commands.md:239` (step table) | `pnpm install` | `pnpm import` |
`docs/cli.md:36`, `:72` (capture) | `pnpm install` | `pnpm import` |
`docs/guide.md:135` | one `pnpm install` | `pnpm import` |
`skills/funky-secure/SKILL.md:43` | `pnpm install` | `pnpm import` |

And the managed block: `docs/spec/commands.md:84` (prose), `docs/cli.md:338` (table), `docs/concept.md:33`,
`docs/rules/quarantine.md:79` all say the age is written **only under `--preset strict`**. 0017 made it
always, `1440` baseline and `4320` strict. The 0.8.7 release fixed the row and missed the prose — mine.

The same shape: `docs/rules/actions-pinned-sha.md:43` still prescribes `gh api …git/refs/tags`, while the
finding has said `git ls-remote` since 0021.

**Lesson.** A release that changes a printed step has to grep the step. `grep -rn 'pnpm install' docs
skills README.md` would have caught four of these in the release that created them.

## Cause 2 — the catalogue grew and the spec's count did not

`docs/spec/rules.md:34` is "### 8.2 The nine rules" with `R1`…`R9`; `:242` is "8.3 Deferred catalog (nine
rules, three of them in 0.2)" listing `ci-no-safety-overrides`, `pull-request-target` and
`workflow-permissions` as **not yet built**. All three ship. Twelve rules run.

Echoes: `docs/spec/scope.md:28` ("nine rules do not justify a glob engine"), `:16-19` (the `ci` target row
names two rules where five read it), `docs/spec/machine.md:68`, `docs/decisions.md:29` (D-9), and
`CONTRIBUTING.md:59` ("the argument for a tenth"). Three rules entered the catalogue without a spec section
and nobody noticed because nothing compares the catalogue to the spec.

## Cause 3 — the command surface moved and the tables did not

- `docs/spec/commands.md:55` and `docs/guide.md:210`: `--format json` for `migrate` — the CLI rejects it
  (exit 2, `--format is not accepted by migrate`).
- `docs/cli.md:3`: "six commands", and `pin` is missing from the list; there are seven.
- `docs/cli.md:469`, `:474`, `:476`: `--format`, `--apply` and `--allow-dirty` name `init`/`migrate`
  without `pin`, which accepts all three.
- `docs/cli.md:463`: "Every flag below is in the closed list" — `--version` is accepted by every command
  and appears in no table (0023, mine).
- `docs/spec/commands.md:11-14`: the `scan` synopsis omits `--require-verified` (0023, mine).
- `docs/cli.md:336-341`: the `init` write table lists W1a, W1b, W2, W3, W4 and omits W1c (`savePrefix`),
  and says the ignore block has "six candidate paths" where it now writes eight, including `node_modules/`.
- `docs/architecture.md:225`: "There are two write paths" — `pin --apply` is a third, and
  `README.md:91`, `docs/concept.md:16` and `docs/guide.md:230` repeat the two-writer claim.
- `docs/architecture.md:155`: `explain` with no id is described as an exit-2 usage error; it prints the
  catalogue and exits 0 (as the same page's prose says).

## Cause 4 — the report schema changed and its example did not

`docs/spec/report.md:46` shows `"version": "0.4.0"`; `:50-53` and `:70-72` describe `configPath`,
`machineIncluded` and `quarantineDeclaredIn` as provenance keys. The real keys are `preset`,
`presetSource`, `quarantine` and `machine`, and `policy` now also carries `requireVerified`.
`docs/cli.md:516-521` repeats the old shape.

Same class, smaller: `docs/cli.md:169` and `docs/guide.md:29` show `verdict PASS (threshold: error)` where
the line now names the unverified rules (0022), and the one-line provenance wraps at 96 columns
(`docs/cli.md:167`, `:254`), which the captures do not show.

## Cause 5 — stale numbers a reader takes as current

`README.md:78` and `docs/guide.md:217` say `0.5.0`; `README.md:24` says "three exit codes";
`docs/delivery.md:52` lists the `files` contract without `skills/`; `rfcs/README.md:13-17` marks records
0002–0006 `accepted` ("agreed, not built yet") while all five ship; `docs/decisions.md:13` links only up
to 0006 for a log that runs to I-54; `AGENTS.md:22-36` omits five existing documents from the path map
(`docs/architecture.md`, `docs/cli.md`, `docs/concept.md`, `docs/guide.md`, `docs/images/README.md`).

## What this says about the method

None of the 60 is reachable by a behavioural test. The suite passes because the code is correct; the
documents describe an earlier code. What would have caught them is a **documentation contract test**: the
command/flag surface, the exit-code table, the version strings, and the rule count are all facts a test can
compare against the code in one pass. One exists (`every flag parsed by the CLI appears in docs/cli.md`)
and it covers flags only — not commands per flag, not exit codes, not captures, not counts.

## Not audited

Frozen RFC bodies (0001–0023), `odd/tasks/**`, the exact golden captures for the machine block, and the
correctness of `pnpm import` itself (never executed anywhere in this round).
