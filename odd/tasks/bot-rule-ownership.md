# bot-rule-ownership

Issue **#518** · two behaviour changes from one field-round defect · plan v3 is
[the issue's third comment](https://github.com/MaxGB23/funky-secure/issues/518). Two blind judges per round,
two rounds, both refuted v1 and v2; v3 carries every finding and is the artefact this document indexes.

## Specs

- **S1** — The head-checkout combination belongs to **R11** (`pull-request-target`). R9
  (`no-bot-auto-merge`) drops its clause and the code `pr-target-head-checkout`: R9's question is whether a
  dependency update can merge unread, and the clause never answered it.
- **S2** — R11 widens **per axis**, and each axis has its own rule. `uses`: any action whose **any** `with`
  value names the head. `run:`: **keeps** the checkout-command requirement (`git checkout`, `gh pr checkout`,
  fetch-then-`FETCH_HEAD`) **and gains the verbs it misses** — `git switch`, `git worktree add`, a hard reset
  onto `FETCH_HEAD`, `git restore --source`, `git merge … FETCH_HEAD`. A command that **names** the head
  without checking it out (`run: echo "…head.sha"`) stays a **pass**, and it is the negative control.
- **S3** — R11's `detection`/`evidence`/`limits` strings and `docs/rules/pull-request-target.md` move with the
  widening, because `explain` prints them. R9's `detection`/`evidence` strings lose the clause.
- **S4** — R9's presence signal becomes the finding the spec already asks for
  (`docs/spec/rules.md:328-329`, "present → `info` finding"): `status: 'fail'`, `code: 'bot-config-present'`,
  severity `info` through a `severityWhen` state. Because the state table is **per rule** and the clamp
  requires every finding of the rule to carry the selecting key, the config finding carries
  `botConfig: true` and **every other R9 finding carries `botConfig: false`** — including both skip helpers.
  The reason recorded in **I-6** died when **I-60** shipped `severityWhen`; the spec wins over the record.
- **S5** — The invariant is **scoped to `fail`**: no two `fail` findings share a `code` on the same
  `path:line`. Unscoped it is already false on ordinary output, because six rules emit
  `unparseable-workflow` on one path with no line and both R9 and R11 emit `no-repo` with neither.
- **S6** — Fixtures come from the field round's own files, not retyped (`docs/field-loop.md:87-94`). Six
  shapes: the duplicate, the mention only, the run axis, the action axis, the presence signal, the mechanism.
- **S7** — Two slices, each starting in `docs/spec/` in its own pull request: **D1** (ownership + widening,
  moves the golden, no report-contract surface) then **D2** (the state table, the drift row, the policy test).
- **S8** — Records are append-only: `I-6`, `I-14` and `I-82` are corrected by **superseding rows**, never
  edited; `rfcs/0001:752-761` gains a dated `## Errata`.

## Tasks

| id | what | specs | route |
| --- | --- | --- | --- |
| T1 | `docs/spec/rules.md` R9 and R11, plus the registry if a row moves | S1,S2,S3 | inline, spec PR #520 |
| T2 | `pull-request-target.js` widening per axis; `no-bot-auto-merge.js` clause and dead code out | S1,S2 | inline, code PR #521 |
| T3 | both rule tests, the invariant comment, `node scripts/gen-golden.js` | S2,S5,S6 | inline, code PR #521 |
| T4 | `docs/spec/rules.md` R9's signal | S4 | inline, spec PR #522 |
| T5 | R9's `severityWhen`, the `botConfig` key on every finding, `README.md:143`, `tests/policy.test.js` | S4 | inline, code PR #523 |
| T6 | the presence-signal and mechanism fixtures, `--fail-on` both ends | S4,S6 | inline, code PR #523 |
| T7 | pages (`docs/rules/*`, `docs/learn/04`), decisions rows, RFC errata, `funky-secure-v0.1.md` Log | S3,S4,S8 | inline, #521, #523, #524 |

## Log

- **L1** — the owner's request, verbatim: *"pasemos a implementar, el plan ya fue refutado por jueces"*.
- **L2** — T1–T3 shipped: #520 (spec D1) and #521 (code D1). R11 owns the head-checkout combination and
  reads both kinds of step per axis; R9 lost the clause, the `pr-target-head-checkout` code and the
  helpers it carried, and the golden moved with the report.
- **L3** — T4–T6 shipped: #522 (spec D2) and #523 (code D2). R9's configuration signal is the `fail`
  carrying `bot-config-present` at `info` in both presets, selected by the `botConfig` key every finding
  of the rule carries; `--fail-on error` exits `0` and `--fail-on info` exits `1`. Suite at that slice:
  967 tests, 966 pass, 1 skip, 0 fail.

- **L4** — closed. Four pull requests: #520 and #521 for D1, #522 and #523 for D2, #524 for the records. Suite at
  close: 967 tests, 966 pass, 1 skip, 0 fail. Measured on the repository that produced the field defect:
  `yarnpkg/berry` `.github/workflows/pr-smart-merge.yml` declares `pull_request_target` and checks the head out in
  two jobs. Before the fix that file produced one `pull-request-target-checkout` and one `pr-target-head-checkout`
  on line 33; now it produces two `pull-request-target-checkout`, at lines 33 and 95, one per job. `action-gh-release`
  carries a `.github/dependabot.yml` and no head checkout: its signal moved from the rolled-up passing line to one
  `info` finding, and the run still exits 0.
