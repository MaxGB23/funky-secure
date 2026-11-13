# AGENTS.md

Where things live in this repository, and the rules that keep it honest. Two axes: a **record** of what
was decided (`rfcs/`, `odd/tasks/`) and the **present** state (`docs/`, code). A record is frozen once
settled; the present is edited freely, in its own pull request.

## Paths

| Path | What it is |
|---|---|
| `docs/spec/` | **The normative contract.** Where it and the record disagree, the spec wins. |
| `docs/README.md` | The map from a change to the page that must move with it. Start here. |
| `docs/decisions.md` | The decision log, `D-n` product and `I-n` implementation, with the measurements. |
| `rfcs/` | The record: `rfcs/README.md` is the registry, and a settled RFC is never rewritten. |
| `odd/tasks/` | Feature records: specs, tasks and an append-only Log. |
| `src/` | The code, with the suite in `tests/` and the golden generator in `scripts/`. |
| `CONTRIBUTING.md` | The hard rules, the issue and pull request ritual, and the local checks. |

## Working rules

- **A behaviour change starts in `docs/spec/`**, in its own pull request. Behaviour the record never
  decided starts with the next numbered RFC under `rfcs/`, opened as `draft`.
- **The record is append-only.** A settled RFC is corrected by a dated `## Errata` or the next record;
  the Log of an `odd/tasks/` document is evidence and is only ever appended to.
- **Zero runtime and zero dev dependencies, no network, no machine writes as a side effect.** Every
  write inside the repository goes through `validateWriteTarget`; the one outside it is
  `skill --install` (11.5 point 7).
- **CLI output carries symbols (`✖ ⚠ ℹ ✓ –`), never emoji** — double-width glyphs break alignment and
  determinism. Color only on a TTY.
- **The JSON report is the machine contract; the human text is presentation and may change.**
- **A pull request is `node scripts/open-pr.js`, never a sequence written by hand**: it refuses a red
  suite, a red packed set and a policy violation, then creates a labelled pull request that is ready
  from birth. The three facts it checks, and what a red `pr-policy` means, are in
  [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **A pull request merges only on `gh pr checks <n> --json state`, with no state outside `SUCCESS`,
  `SKIPPED` and `NEUTRAL`.** `gh pr checks --watch` is not that gate. When the state says `IN_PROGRESS`
  and `gh run view <run> --json jobs` says `success`, the conclusion is the authority.
- **Waiting for CI is `node scripts/wait-for-ci.js <commit>`.** Exit `0` passed, `1` failed, and **`2`
  never means failure** — no run yet, still running, or the timeout ran out. It reads the matrix, not
  the run summary; on a push to `main` `pr-policy` reads `skipped`, and that is not a failure.
- **A `pr-policy` failure is read before it is re-run.** `gh run rerun --failed` replays the event
  payload, so a label missing from that snapshot stays missing, and the cure is a fresh event. A body
  that links no issue, or a branch outside `type/description`, is cured by no retry.
- **Publishing is a human decision with a mechanical precondition.** CI stages and a maintainer approves
  with 2FA; the order and its preconditions are in
  [`.agents/skills/release/SKILL.md`](.agents/skills/release/SKILL.md).

## Commands

```sh
node --test                    # the suite; fewer tests than the last run has not run faster
node scripts/gen-golden.js     # regenerate goldens after an intended report change
node scripts/pack-guard.js     # the packed set against the `files` contract (`npm run pack:check`)
node bin/funky-secure.js scan --scope repo --fail-on warn   # self-scan, what CI runs
PR_BODY="$(cat body.md)" PR_LABELS=type:docs PR_HEAD_REF="$(git branch --show-current)" \
  node scripts/check-pr-policy.js   # the pull request policy, before the push
```
