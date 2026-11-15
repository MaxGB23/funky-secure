# Runtime claims: the probes that close them

Close the three rows `docs/validation.md` still marks as not verified, with measurements taken in this
repository's own CI instead of a static reading. Issue #267.

## Specs

- **S1** In the owner's words: "Ataquemos el pendiente de sondas que quedó pendiente de runtime claims".
- **S2** Row `:87` carries a general claim (the rule's verdict predicts a third-party workflow's runtime) and
  a specific one. Only the specific one is measurable here: this repository's job, with
  `permissions: contents: read`, attempting a write answers 403. The general claim stays a residual.
- **S3** The 403 probe asserts the **status and the error envelope**, never a non-zero exit: a non-zero exit
  comes from a typo, a wrong endpoint or a missing credential.
- **S4** The probe must not run where the answer is imposed by the platform instead of the declared
  permission. A fork pull request gets a read-only token regardless, so the job skips it with a printed
  reason and the row names the skip. Measured contexts: `push` to `main`, and `pull_request` from a branch
  of this repository.
- **S5** The probe cannot write when the permission it expects absent is present: it sends a request that is
  invalid even with write, asserts the envelope, and reads the resource back to prove nothing changed.
- **S6** Probe **logic** lives in `scripts/`, never in YAML; each script is testable through an injectable
  transport. Precedent: `docs/decisions.md` I-68.
- **S7** The remediation probe imports the command strings the catalogue emits (`src/lib/foreign-pin.js:21`,
  `src/rules/exact-versions.js:239,245,461`). A copy would drift, and the claim is about what the tool prints.
- **S8** The remediation claim is **effect, for the command shapes the catalogue emits today**: a lockfile
  exists after `pnpm install --lockfile-only`, and a field carries the value after the `pnpm pkg set` form.
  Not "every remediation", and not the correctness of a resolution.
- **S9** No row says "measured" before the job has run green on the pull request that moves it.
- **S10** Every action is pinned to a SHA; the job declares `permissions: contents: read`. The pin is enforced
  by `tests/ci-coverage.test.js:85-101`; the self-scan is not a backstop (it passes when any declaration
  exists, and `ci.yml:22-23` already declares one).
- **S11** No run ids in any document: a row names the job.
- **S12** The diagram is out of this feature: "La imagen queda pendiente para final justo antes de la release".
- **S13** The gate pins all three steps, not one: a deleted step must fail the suite.
- **S14** No CLI contract changes, so no `docs/spec/` page moves. `docs/delivery.md` moves with T5 only if it
  enumerates the CI jobs, which T0 checks rather than assumes.
- **S15** Review granularity, in the owner's words: "Tres revisiones por commit". The two docs pull requests
  ship separately: "En dos pr".

## Tasks

| ID | Task | Spec | Route | Commit |
|---|---|---|---|---|
| T0 | Issue #267; confirm `docs/delivery.md` does not enumerate the CI jobs | S14 | inline | — |
| T1 | This record, the Engram mirror and the todo projection | S1 | inline | — |
| T2 | `scripts/probe-permissions.js` + test, the `runtime-claims` job with its guard, `tests/ci-coverage.test.js` extended | S2–S6, S10, S13 | inline | `feat: prove the permissions claim on the runner` |
| T3 | The `pack-smoke.js` step and its gate assertion | S6, S7 | inline | `feat: exercise the packed artifact in CI` |
| T4 | `scripts/probe-remediation.js` importing the catalogue's strings, + test + step + gate | S6–S8 | inline | `feat: prove the remediation commands take effect` |
| T5 | Rows `:87`, `:90`, `:91` moved with narrowed subjects; `:92` cross-reference fixed | S2, S9, S11 | inline | `docs: state the three claims as measured` |
| T6 | Verification, native review per commit, `node scripts/open-pr.js` | S15 | inline | — |

## Log

- **L1** The owner's request: "Ahora cetremosnos en el odd y rdd de la feature que teniamos pendiente, ademas
  de su pr de docd. Dame el plan, y usa funky judge antes de entregarme el plan".
- **L2** The three decisions: S1 quoted above, "Tres revisiones por commit", "En dos pr".
- **L3** The plan was judged before it was delivered: two blind reviewers (`jd-judge-a`, `jd-judge-b`), 37
  findings. Three were blockers: `workflow_dispatch` is not dispatchable before the file exists on the
  default branch, so the v1 ordering was unsatisfiable; a job inherits workflow-level triggers, so it would
  have run on fork pull requests; the remediation probe typed commands the catalogue does not emit. v2 is
  `.tmp/plans/runtime-claims-plan-v2.md`, `sha256 7a9052b1…`.
- **L4** Issue #267 opened with `type:feature` and `status:approved` on the owner's in-session authorization
  of the plan.
