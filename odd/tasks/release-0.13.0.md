# 0.13.0 — what must land before the release

The release closes the backlog work of the last campaign. The three artifacts it was written for have landed:
the validation page no longer carries a count nothing checks and declares which side of five rules was
measured; the `migrate` plan's import step names what re-running it costs and says the step may already be
satisfied. What remains is the release itself — last, and only with the owner's approval.

## Specs

- **S1** The release is always last, and it needs the owner's approval: *"la release siemore queda para el
  final y con aprobación"*. A new defect found on the way becomes its own issue and its own pull request
  before the release, never a silent deferral: *"debemos dejar todo pulido junto con docs, si sale alguna
  Problemática, abre issue nuevo y su pr"*.
- **S2** `docs/validation.md` stops carrying a suite count. The page's opening states the precedent for the
  version: *"The version is deliberately omitted — a table that carries a number becomes wrong at the next
  release, and the suite itself is the authority for it"*. The row keeps its claim and loses the number: the
  suite is green, and `node --test` is the command behind it.
  - The alternative S14 allowed — *"a test derives it from a fact the run can read"* — is not taken, and the
    reason is recorded rather than implied: a test cannot assert the total of the run it is part of. The CI
    contract asserts the version strings and the rule count (`docs/validation.md:133-136`,
    `tests/docs-contract.test.js:274-305`), and no test anywhere derives this total, so it is the one claim
    the page makes with nothing on the other end.
- **S3** The five rules the campaign named are declared per rule, not as a group, because the rows are not
  uniform — read at `c86f37a`, and classified by what each row reports rather than by the side the campaign
  assumed: `foreign-lockfile` (`:46`), `actions-pinned-sha` (`:51`) and `workflow-permissions` (`:55`) report
  the failing side only; `quarantine` (`:47`) reports the passing side only; and `exact-versions` (`:48`)
  reports its failing side plus a comparator measurement that is **not** a pass — *"0 mismatches and 0
  desyncs over 245 specifiers"* is accuracy of the comparator, because the rule's pass is *"No floating
  specifier and no desync"* (`docs/rules/exact-versions.md:130`) and `shadcn-ui/ui` floats 206. So the
  passing side of four rows is not measured, and the declaration says that, in the terms the campaign
  allowed (*"the residual declaration says so"*). It claims nothing about repositories no sweep read: it is a
  statement about this page, not about the five clones.
- **S4** `migrate`'s import step keeps being printed, and its text names what re-running it costs: it
  **replaces** the versions resolved from the manifest with the ones the foreign lockfile pins. It is not
  skipped when `pnpm-lock.yaml` is present — presence is not proof the import ran, and the tool records no
  provenance (`docs/spec/commands.md:186-187`, `src/lib/lockfile.js:5-9`) — and the tool does not run it
  (4.9: it is a human step). The step line and the criterion sentence printed below it (`migrate.js:376-379`)
  must agree, and a test pins that the step line carries the clause.
- **S5** 0.13.0 is the next version (minor: new rules and options since 0.12.0). The bump is its own pull
  request, and it moves everything the contract derives from the manifest — three mechanisms, not one:
  - `tests/docs-contract.test.js:227-268` requires `funky-secure@<version>` in `README.md` and
    `docs/guide.md`, and every `"version": "x.y.z"` in the shipped documents **except `docs/decisions.md`**,
    which the test carves out at `:247` because that page quotes other tools' manifests as evidence.
    Rewriting those would falsify the record.
  - `:259-268` requires the frontmatter of `skills/funky-secure/SKILL.md`.
  - Every golden carries the manifest's version (`src/lib/tool.js:4-7` → `tests/golden/clean.json:5`) and
    `tests/drift.test.js:358-373` compares them byte for byte, so `node scripts/gen-golden.js` runs as part
    of this task. This is the case S6's "only when the report changes on purpose" was written for: the report
    changes because its identity does.
  The tag, the staged candidate, the 2FA approval and the GitHub Release follow
  `.agents/skills/release/SKILL.md`, never a command written by hand.
- **S6** Every candidate carries the repository's gates: `node --test`, `node scripts/pack-guard.js`, the
  self-scan, `node scripts/check-pr-policy.js` before the push, `node scripts/gen-golden.js` only when the
  report changes on purpose, and a merge only on `gh pr checks <n> --json state` with no state outside
  `SUCCESS`, `SKIPPED` and `NEUTRAL` (S16).
- **S7** Pull requests merge with a merge commit, never a squash: *"no hacemos merge con squash, mantenemos
  historia"*. The exception the owner allowed is a branch whose commits are agreed noise, or a repository
  policy that requires it.
- **S8** This plan is judged blind before the first source write, and each pull request's claims are judged
  before its merge (L3).
- **S9** A pull request that changes the tool's behaviour or its printed text changes the specification
  first, in its own pull request (`CONTRIBUTING.md:8-9`), and every pull request closes an issue
  (`CONTRIBUTING.md:41`) — the policy script refuses a body with no `Closes #N`/`Refs #N`
  (`scripts/check-pr-policy.js:22-24`).

## Tasks

- **T0** Open the issue the campaign never opened for T11: the validation page's uncheckable count and its
  one-sided measurement — S2, S3. Issue #320.
- **T1** `docs/validation.md`: the row loses its number and keeps its claim in exit-code form; a paragraph
  after the rule table declares, per rule, which side each row reports — S2, S3. Branch
  `docs/validation-residual`; body `Closes #<T0>`; gates S6. Commit: `ba5491e` (#321).
- **T2** `#135` spec: `docs/spec/commands.md`'s migrate step 3 (`:181-188`) gains the clause naming what
  re-running `pnpm import` costs, and `docs/cli.md:528-532` **adds** the criterion sentence — the page has no
  such sentence today, and it carries no `migrate` plan block to move, so the prose is where the reader meets
  it. The mapping is the command row (`docs/README.md:10`); `:11` was considered and does not apply, because
  §10.3 governs the report's layout and not a plan step's wording. Branch `docs/135-import-cost`; body
  `Refs #135`. Spec first, alone, before T3. Commit: `2d98627` (#322).
- **T3** `#135` code: the `#` comment on `src/commands/migrate.js:370` carries the same clause, and one test
  asserts the printed step line carries it — nothing pinned that comment, so the test is the only thing that
  keeps the clause from being deleted in silence. Branch `fix/135-import-cost`; body `Refs #135`.
  Commit: `ee3bff1` (#323).
- **T4** `chore/release-0.13.0`: the manifest, the pages S5 names, and the six goldens — S5. Branch
  `chore/release-0.13.0`; body `Refs #135`. Commit: this pull request.
- **T5** The release ritual: gate, tag, staged candidate, the owner's approval, the Release — S5. Commit: not
  applicable.
## Log

- **L1** "el plan me gusta, la release siemore queda para el final y con aprobación, ya que pueden surgir
  nuevos pendientes. Ahora sigamos con la estrategia, crea el plan y nos apoyamos de funky judge protocol."
- **L2** "no hacemos merge con squash, mantenemos historia"
- **L3** "debemos dejar todo pulido junto con docs, si sale alguna Problemática, abre issue nuevo y su pr. la
  idea es no dejar nada sin atacar, te doy permiso"
- **L4** Measured before writing this plan, and the reason T1 exists: `docs/validation.md:13` says
  `765 tests, 764 pass, 0 fail, 1 skipped` while `node --test` reports **767 tests, 766 pass, 0 fail, 1
  skipped**. T12 (#316) replaced one hand-typed number with another, and T15b's two tests made it stale in
  the same session.
- **L5** The premise of S4 was read, not assumed: `src/commands/migrate.js:366-372` prints
  `3. human step (this tool never runs it)` and then the `pnpm import` line with its `#` comment; `:376-379`
  prints the criterion sentence below it, conditional on `hasPnpmLock` (`:334`), while the step itself prints
  on `foreign.length > 0` (`:369`) — two different conditions, which is why the two lines can disagree.
  Four exits were evaluated and three rejected: **skip the step when the lockfile is present** trusts
  presence for provenance; **run the import from the tool** is not what 4.9 lets a plan do; **change the
  condition under which the step prints** is the first exit relocated, since presence would decide it. The
  fourth is S4's: print it always and name the cost.
- **L6** Round 1 of the blind judges ran against `094b6ef4…a6468` (73 lines) and returned six findings.
  Adjudicated: the version cascade (T4), the per-rule sides (S3), the insufficient capture (T2), the
  over-read of the page's closing section (S2), the unmodelled fourth exit (L5) and the missing test (T3)
  were all upheld. Two were corrected rather than accepted: `exact-versions` does not report both sides, and
  the fourth exit is a skip in another place, not a label.
- **L7** Round 2 ran against `8357de71…53c63f` (100 lines) and returned three findings that changed the plan:
  the goldens carry the manifest's version, so a bump regenerates six of them (S5, T4); the docs contract
  carves `docs/decisions.md` out of the `"version"` sweep, and S5 would have sent T4 to rewrite quoted
  evidence; and `exact-versions`' *"0 mismatches and 0 desyncs"* is comparator accuracy, not a pass — its
  passing side is unmeasured like the other three. Two of its findings were refuted by reading: nothing
  asserts the step's comment today, so the test must pin the clause's presence rather than an agreement, and
  the docs contract's count is the rule count, never the suite total, so S2's reasoning stands. Round 2 is
  the protocol's cap; nothing further is judged.
- **L8** While revising this document, one shell substitution executed its backticked content: `node
  scripts/gen-golden.js` ran and the document was overwritten with output. The goldens came back
  byte-identical (`git status --porcelain` clean for `tests/golden/`, no bump had happened) and the document
  was rewritten from this file's own content. The rule this is the third instance of: a document whose text
  contains commands is never edited by a shell substitution — it is written whole.
- **L9** The suite totals this document records are the ones each measurement saw, and they move as tests
  land: L4 saw 767/766 before T3 added one, and at T4 the suite reports 768/767. The plan carries the number
  as history, which is why it stays inside the log and never enters the validation page — that page's row now
  claims the exit code and nothing else.
- **L10** The claim audit of #324 found this document contradicting the head it landed on: T1–T4 still read
  `Commit: —` while their commits were ancestors of the pull request. The tasks now name them, and T0 names
  its issue. A record that lands stale is worse than one that lands late, because the next reader treats it
  as current.
