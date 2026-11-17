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
`jd-judge-b`) receive this document frozen by `sha256`, with identical enumerated questions from
`funky-judge-protocol` and the `before-code` flow contract, neither seeing the other or this plan's defence, and
a word cap. A finding becomes work only after it is verified against the code or a run; a finding refuted by a
fact becomes a lesson instead of work. The adjudication is recorded in this document's Log, naming which finding
won, which lost, and the fact that decided it. Two rounds is the cap.

**S8** — what this machine cannot reach is named, with the reason, and never counted as covered. Three sides
are already known to be out of reach and each is a decision, not a gap: a failing `quarantine` needs a host
whose pnpm configuration is non-strict or below the floor; a failing `env-not-tracked` needs a tracked `.env`
fixture the harness refuses to write; a failing `workflow-run-artifact` needs a `workflow_run` fixture nobody has
built. The list is finished before the tasks run, not after they disappoint.

**S9** — every moved row in `docs/validation.md` names the repository, the command and the observed output, and
nothing is claimed that was not run. Coverage claimed is coverage nobody tests again.

**S10** — delivery follows the repository's rules: one work-unit commit per task, its own issue and its own pull
request for every defect found, and a merge only on `gh pr checks <n> --json state` with no state outside
`SUCCESS`, `SKIPPED` and `NEUTRAL`.

## Tasks

Each rule task follows the same shape: the four sides of `S3`, the three obligations of `S4`, fixtures under
`S5`, and its own commit. `T14`–`T16` are the axes that belong to no single rule.

- **T1** — `package-manager-pin`. Fails for a missing pin and for a pin that differs from the answering machine, passes when they agree, skips with `no-package-json` when there is no manifest. Remediation: the printed declaration clears both fail codes on a copy. Page: `docs/rules/package-manager-pin.md`. `S3`, `S4`.
- **T2** — `lockfile-committed`. Fails for absent, untracked and ignored, passes when tracked, skips with `no-repo-root` when the root cannot be resolved. Remediation is `none`; say so where the finding does.
- **T3** — `foreign-lockfile`. Fails with `error` beside a `pnpm-lock.yaml` and `warn` when no pnpm lockfile exists, passes on the eight-of-ten shape the page already measured, skips with `no-repo-root`.
- **T4** — `quarantine`. Passes on this host with its own sentence, skips at repository scope, and its failing side is `S8`'s first decision — record it as not reachable, never as passing.
- **T5** — `exact-versions`. Fails on a floating range and on a desync, passes on exact specifiers, skips with `unparseable-package-json`. The desync side is the one no fixture has carried yet.
- **T6** — `env-not-tracked`. Passes on the clean shape; its failing side is `S8`'s second decision and is recorded as not reachable.
- **T7** — `sensitive-ignored`. Fails by contract for every candidate name absent from `git check-ignore` whether or not the file exists — the shape that made a whole field round look red — and passes when the name is ignored and untracked. The page must say that, or be corrected to.
- **T8** — `actions-pinned-sha`. Fails on a tag or branch ref, passes on 40 hex, and covers the `docker://` digest form the page says is necessary and not sufficient.
- **T9** — `no-bot-auto-merge`. Fails on a bot's automatic merge, passes without one, and says what it does when the workflow cannot be parsed.
- **T10** — `ci-no-safety-overrides`. Fails on `--frozen-lockfile=false` and on a re-enabled lifecycle script, passes when neither is set.
- **T11** — `pull-request-target`. Fails when the workflow checks the pull request head out, passes when it does not, and must not fail a `pull_request_target` that never touches the head.
- **T12** — `workflow-permissions`. Fails with `write-all` at workflow and job scope, fails with `workflow-permissions-missing` for every job that inherits, passes when every job declares, and covers the one-job and several-jobs sentences the verb fix touched.
- **T13** — `workflow-run-artifact`. Passes on the shape measured in `t3-create-t3-app`; its failing side is `S8`'s third decision and is recorded as not reachable until a fixture exists.
- **T14** — the invariants, once: the four exit codes against `--fail-on`, the three scopes, the two presets and what each turns off, `--only`/`--ignore` leaving a rule with neither finding nor count, and the parity of both formats across the whole catalog. `S3`, `S4`.
- **T15** — the mutation round, expanded. The last round killed five of five, and two were held by exactly one test each; this round mutates every rule's decisive branch and names each survivor, because a promise one test holds dies with the next refactor of that test. `S6`.
- **T16** — the evidence and the closing: every moved row in `docs/validation.md` with its repository, command and output, the not-reachable list from `S8` stated as such, and the record naming its own commits. `S9`, `S10`.

## Log

**L1** — the owner's request, verbatim, is `S1`. It arrived after the post-release batch closed, and it asks for
the loop over every rule "que sea posible", in depth, with the plan built to refute and to break.

**L2** — the owner's follow-up, verbatim, is `S2`. It fixes the order: this batch is cleaned first, then the loop
per rule, and the plan is judged by judges before it is implemented.
