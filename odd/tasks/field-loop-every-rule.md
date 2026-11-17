# The field loop, one rule at a time

`0.13.0` shipped thirteen rules whose coverage was measured one side at a time, and the round that followed
reached all thirteen and found that each answers. What nobody has done is take a rule and try to break it from
all four directions at once, with a fixture for each, and prove that the command it recommends actually works.
This document is that work, one task per rule, plus the axes that belong to no single rule.

## Specs

**S1** — the owner's request, verbatim:

> Post feature, requiere un odd dedicado un field loop para todas las reglas que sea posible? ya que quiero probar todo a profundidad, todo pero con el plan de refutar y romper

**S2** — the follow-up, verbatim:

> continua, deja todo limpio, cuando esté todo limpio pasamos al field loop por regla, el plan juszgado por jueces antes recuerda

**S3** — "todas las reglas que sea posible" is a countable thing. `explain --list` is the catalog and it names
thirteen rules; `docs/rules/` carries exactly thirteen pages, one per rule. Each rule gets **four sides**
measured: it **fails** (with its own `code`, at the `path` and `line` the finding names), it **passes** (and the
pass is counted, not merely absent), it **skips for want of a fact** (with the skip `code` and the fact named in
the message), and it is **off by policy** (it contributes neither a finding nor a count). A side that cannot be
reached on this machine is written as not reachable with its reason — never as covered.

**S4** — four sides are the floor, not the depth. Every rule also owes: **the remediation is true** — where the
finding carries a `remediation` command, running it on a disposable copy clears that finding, and where it says
`none`, no command exists that would; **the two formats agree** — the same flags in human and `--format json`
produce the same status, the same `code`, the same `path` and the same count; and **the page agrees** — the
rule's `docs/rules/<id>.md` describes what the run actually does, or the page is corrected in the same commit.

**S5** — a fixture is taken from the agent's own files, never retyped by the person who wrote the parser: a
fixture written by the same hand exercises only the shape its author imagined. Where the finding is an absence,
the test asserts the absence directly — a hash before and after, a tree state, a byte-identical file. Where the
defect was a promise the product makes, the test is named after the promise.

**S6** — the loop refutes rather than confirms. Every claim this plan makes about the code, and every claim a
rule's page makes about its rule, receives **one attempt to break it**: re-run it from a different directory,
read it in the other format, recount it. A claim that survives is reported as surviving; a claim that does not
becomes a defect, and the wording that made it plausible is kept in the record, because that wording is usually
a defect of its own.

**S7** — the instrument, and it runs before the first source write. Two blind judges (`jd-judge-a` and
`jd-judge-b`) receive this document frozen by `sha256`, with **the same enumerated questions**, neither seeing
the other or this plan's defence, and a word cap. The questions come from the `before-code` flow contract and
the discipline from `funky-judge-protocol` — the protocol carries no question set, and a handoff that says it
does has misread the instrument. A finding becomes work only after it is verified against the code or a run; a
finding refuted by a fact becomes a lesson instead of work. The adjudication is recorded in this document's Log,
naming which finding won, which lost, and the fact that decided it. Two rounds is the cap, the second attacks
the corrections only, and **no judge reviews its own correction**.

**S8** — what this machine cannot reach is named, with the reason, and never counted as covered. After two
judges, one side remains out of reach: a failing `env-not-tracked` needs a tracked `.env` fixture, and the
harness refuses to write a `.env` path. Two deferrals this document carried in its first revision were **wrong**,
and the correction is the lesson: a failing `quarantine` **is** reachable — `pnpm config list --json` runs with
`cwd` = the invocation directory, so a fixture whose own `pnpm-workspace.yaml` sets `minimumReleaseAgeStrict:
false` yields `quarantine-not-strict` — and a failing `workflow-run-artifact` **already has its fixtures** in
`tests/fixtures/workflows/workflow-run-pair/`. A deferral names a fact, never an assumption about a host.

**S9** — every moved row in `docs/validation.md` names the repository, the command and the observed output, and
nothing is claimed that was not run. Coverage claimed is coverage nobody tests again.

**S10** — delivery follows the repository's rules, and the two it names first are the ones this plan would
otherwise break: a **behaviour change starts in `docs/spec/` in its own pull request**, so a task that finds the
run and the spec disagree corrects the spec first and the page after; and **a pull request is
`node scripts/open-pr.js`, never a sequence written by hand**. Then: one work-unit commit per task, its own
issue and its own pull request for every defect found, and a merge only on `gh pr checks <n> --json state` with
no state outside `SUCCESS`, `SKIPPED` and `NEUTRAL`.

## Tasks

Each rule task follows the same shape: the four sides of `S3`, the three obligations of `S4`, fixtures under
`S5`, and its own commit. `T14`–`T16` are the axes that belong to no single rule.

- **T1** — `package-manager-pin`. Fails with **four** codes: `unparseable-package-json`, `pin-missing` (no declaration), `pin-unversioned` (a pin with no version) and `pin-conflict`; **passes** with `pin-differs-from-machine`, which is information and not a conflict — the repository is the authority and pnpm honours it inside the project, so the machine's own version rides along as evidence; skips with `no-package-json`, with `no-pnpm` when the probe does not answer, with `not-pnpm` when another manager owns the repository, and with `self-managed-pin` when the pin is managed elsewhere. Page: `docs/rules/package-manager-pin.md`. `S3`, `S4`.
- **T2** — `lockfile-committed`. Fails for absent, untracked and ignored, passes when tracked, skips with `no-repo-root`. **No fail of this rule remediates with `none`** — its skips and passes do, by design — because each fail carries the command a person runs: `pnpm install`, `git add [-f] pnpm-lock.yaml`, `git check-ignore -v pnpm-lock.yaml`, and the task proves each one clears its own finding.
- **T3** — `foreign-lockfile`. Fails at `error` beside a `pnpm-lock.yaml` and at `warn` when no pnpm lockfile exists, passes on the eight-of-ten shape measured in `docs/validation.md:76` — a run, not a page — and skips with `no-repo-root`.
- **T4** — `quarantine`. Fails with `quarantine-not-strict` and `quarantine-below-policy` from **fixtures**, since the effective configuration is read from the invocation directory; passes on this host with its own sentence; skips at repository scope. Its page must say which of the two the reader is looking at.
- **T5** — `exact-versions`. Fails on a floating range and on a `lockfile-desync`, passes on exact specifiers, skips with `unparseable-package-json`. The desync fixture already exists at `tests/rules/exact-versions.test.js:301`; the task starts from it instead of inventing one.
- **T6** — `env-not-tracked`. Passes on the clean shape; its failing side is `S8`'s single decision and is recorded as not reachable, with the harness's refusal as the reason and no substitute fixture.
- **T7** — `sensitive-ignored`. Fails by contract for every candidate name absent from `git check-ignore` whether or not the file exists — the shape that made a whole field round look red — and passes when the name is ignored and untracked. The page must say that, or be corrected to.
- **T8** — `actions-pinned-sha`. Fails on a tag or branch ref, passes on 40 hex, and covers the `docker://` digest form the page says is necessary and not sufficient.
- **T9** — `no-bot-auto-merge`. Fails on a bot's automatic merge, passes without one, and says what it does when the workflow cannot be parsed.
- **T10** — `ci-no-safety-overrides`. Fails on `--frozen-lockfile=false` and on a re-enabled lifecycle script, passes when neither is set.
- **T11** — `pull-request-target`. Fails when the workflow checks the pull request head out, passes when it does not, and must not fail a `pull_request_target` that never touches the head.
- **T12** — `workflow-permissions`. Fails with `write-all` at workflow and at job scope, and with `workflow-permissions-missing` **once per workflow**, at `line: 1`, naming every inheriting job in the message and in `evidence.jobs` — not once per job, which is the shape an acceptance written from prose would look for and not find. Passes when every job declares, and covers the one-job and several-jobs sentences the verb fix touched.
- **T13** — `workflow-run-artifact`. Fails on the issue #153 pair the rule's own fixtures already carry (`tests/fixtures/workflows/workflow-run-pair/`, asserted at `tests/rules/workflow-run-artifact.test.js:89`), passes on the shape measured in `t3-create-t3-app`, and says what it does when a workflow has no `workflow_run` trigger.
- **T14** — the invariants, once: the four exit codes against `--fail-on`, the three scopes, the two presets and what each turns off, `--only`/`--ignore` leaving a rule with neither finding nor count, and the parity of both formats across the whole catalog. `S3`, `S4`.
- **T15** — the mutation round, expanded. The round recorded in `docs/validation.md:167-179` killed five of five, and two were held by exactly one test each; this round mutates every rule's decisive branch and names each survivor, because a promise one test holds dies with the next refactor of that test. `S6`.
- **T16** — the evidence and the closing: every moved row in `docs/validation.md` with its repository, command and output, the not-reachable list from `S8` stated as such, and the record naming its own commits. `S9`, `S10`.

## Log

**L1** — the owner's request, verbatim, is `S1`. It arrived after the post-release batch closed, and it asks for
the loop over every rule "que sea posible", in depth, with the plan built to refute and to break.

**L2** — the owner's follow-up, verbatim, is `S2`. It fixes the order: this batch is cleaned first, then the loop
per rule, and the plan is judged by judges before it is implemented.

**L3** — round one's adjudication, with the fact that decided each line. Two blind judges over `sha256
2beab8e4…`, both verifying the hash before reading.
- **Won, and verified here by a run**: `quarantine`'s failing side **is** reachable. One judge read that the rule
  consumes only the machine configuration and concluded the deferral was real; the run answered
  `quarantine-not-strict` from a fixture whose `pnpm-workspace.yaml` sets `minimumReleaseAgeStrict: false`,
  because that configuration is read with `cwd` = the invocation directory. The run is the fact, the reading
  loses, and the wording that made it plausible — "it reads only the machine config" — is true and was the
  misleading part. The command, so the next reader can re-run it: a directory whose `pnpm-workspace.yaml` holds
  `minimumReleaseAgeStrict: false` and `minimumReleaseAge: 4320`, then `node bin/funky-secure.js scan --scope
  machine --format json` from it, which answers `quarantine` `fail` `quarantine-not-strict` — "quarantine is
  non-strict: pnpm auto-approves immature packages by writing …".
- **Won, verified here by reading**: `workflow-run-artifact`'s failing side already has fixtures
  (`tests/fixtures/workflows/workflow-run-pair/`, asserted at `:89`), so "nobody has built" was false;
  `pin-differs-from-machine` is a **pass**, not a fail, so `T1` named a side that does not exist; the rule has
  **four** fail codes, not two; `lockfile-committed` never remediates a fail with `none`; a `lockfile-desync`
  fixture already exists; `workflow-permissions-missing` is one finding per workflow at `line: 1`, not one per
  job; the eight-of-ten count lives in `docs/validation.md:76` and not on the rule page; the mutation round is
  at `:167-179`; `S10` omitted `open-pr.js` and the spec-first rule; `S7` attributed a question set to the
  protocol that its own rule 9 forbids, and dropped the rule that a judge never reviews its own correction.
- **Lost**: the second judge's claim that the quarantine deferral was real, refuted by the run above. Also lost,
  as requirements: the same judge's reading of `T5` as unverifiable rather than false — it is false, and the
  fixture that decides it is cited now.
- **Adopted from a judge, not from the plan**: that `T3`'s citation was wrong at the commit it named, which is
  the flow contract's own rule about citations — never stale, always unread.

**L4** — round two's adjudication, and it is the round that earned its place: it found false claims **introduced
by the corrections themselves**, which is the only thing that round exists to catch.
- **Won**: `T1` claimed three fail codes where the rule has **four** — `unparseable-package-json` was missed by
  the original and by its correction, and the enumeration also omitted three skips (`no-pnpm`, `not-pnpm`,
  `self-managed-pin`). `lockfile-committed`'s "never `none`" was true of its fails and false of the rule, since
  its skips and passes default to `none`; the sentence is scoped to fails now. Both were verified against
  `src/rules/package-manager-pin.js:155,220,314,334,171,234,256` and `src/rules/lockfile-committed.js:17,45-51`.
- **Refused**: that the quarantine run is unverifiable. The judge could not certify a run it did not execute,
  which is the protocol working exactly as written; the command and its output are in `L3` now, so the claim
  stops resting on the parent's word.
- **Disclosed by the judge, and worth keeping**: `HEAD` moved from `5409240` to `48e5442` while it read, with
  identical trees — the commit was re-seated onto the plan's branch after it had landed on `main` by mistake.
  The file hash `e495f605…` never changed, which is why the round stayed valid; a hash of the commit would have
  failed where a hash of the artifact did not.

Two rounds is the cap and the third is a human decision. Nothing left in round two is worth one: what remains is
wording, and the wording is fixed.
