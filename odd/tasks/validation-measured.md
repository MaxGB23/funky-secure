# Validation, re-measured

The owner asked whether the release should ride on the verdicts already written in `docs/validation.md` or on
fresh field rounds over real repositories. He chose the full campaign, and named the standard the page must meet:
the verdicts must be **real and coherent** — every row a command somebody can run against this tree, and nothing
claimed that the tree no longer backs. The release comes after the measurement, and the portfolio data after the
release, so both reflect what actually ships.

## Specs

**S1 — The campaign runs over the ten real repositories, not a sample.** Owner: "Campaña completa de diez repos".
Each repository at `M:/pruebas/real` is measured read-only: `scan --scope repo --format json`, its exit code, its
`summary` counts and its per-rule counts. A hash manifest and `git status --porcelain` are taken before and after
each run, so the claim that nothing is written is re-established on all ten rather than on the five the page
records.

**S2 — A field round is discovery, and it runs on the path that changed.** Owner: "delegar unas rondas de
testeos en repos reales". Since `v0.15.0` the product changed in one commit — `097770a`, the dirty check asked in
one coordinate system and failing closed — so the blind sessions follow the writing paths (`init --apply`, `pin`,
`migrate`) over dirty trees and through a junction, which is the class of defect the suite cannot see. One fresh
session per scenario, per `docs/field-loop.md`: self-contained brief, expected result stated before the run, the
finding of gold named in advance, the report contract, and the prohibitions (no network, no installs, no
`--force`, never "fixing" the fixture to make the tool pass).

**S3 — `docs/validation.md` says only what a command says.** Owner: "el validation.md debe ser real y coherente".
Every row keeps or gains the command behind it; every count is re-derived at the commit under test; a row the tree
no longer supports is corrected rather than defended; a row nobody can run is moved to *Not verified — deliberately,
and why*, with what would close it. The page stops carrying a claim that the ten clones contradict.

**S4 — The release follows the measurement, through the repository's own ritual.** `v0.15.1`: patch, because the
only product change since `v0.15.0` is a fix. Staged candidate, human approval, CI evidence — the order is
`.agents/skills/release/SKILL.md`, and publishing stays the owner's decision with 2FA.

**S5 — The portfolio data reflects the release.** After `v0.15.1` is published, `odd/tasks/next-release-backlog.md`'s
data file is corrected so it describes what shipped. Out of scope until then, on the owner's own ordering.

**S6 — Findings ship as units.** A confirmed defect gets its issue and its pull request, each with the fixture that
pins it (field loop, step 3). A finding whose fix ships without its case leaves the product as exposed, one commit
later. Nothing here re-opens a settled RFC; behaviour changes start in `docs/spec/`.

## Tasks

| ID | Spec | Task | Route |
|---|---|---|---|
| T1 | S1 | Measure the ten clones: scan, exits, summaries, per-rule counts, read-only hashes | inline |
| T2 | S2 | Blind sessions on the written paths: dirty tree, junction, `migrate` sequence | `funky-lakra`, parallel |
| T3 | S3 | Adjudicate every report and re-derive the page row by row | inline + judge |
| T4 | S6 | Fix what the campaign confirms, each with its fixture | issue + PR |
| T5 | S3 | `docs/validation.md` corrected, committed as one unit | issue + PR |
| T6 | S4 | `v0.15.1` through the release ritual | `.agents/skills/release` |
| T7 | S5 | The portfolio data reflects `v0.15.1` | issue + PR |

## Log

- **L1 — the owner's request, verbatim.** "El data de portfolio esbpara que refleje los últimos cambios. Creo que
  es hora de sacar release y después el data de portfolio. Pero para no sacar una release apresurada, crees que
  debamos delegar unas rondas de testeos en repos reales, o los veredictos actuales de validation.md ya son
  suficientes ?"
- **L2 — the answer measured, and the owner's choice.** From `v0.15.0` to `main` there is one `src/` commit
  (`097770a`) and nothing else of product; `docs/validation.md`'s verdicts are strong but date from before it, and
  the darwin gap is named at `:119` with what would close it. Offered three routes — narrow round, no round, full
  campaign — the owner chose the **full campaign** over the ten repositories.
- **L3 — the owner's standard, verbatim.** "Continuemos, el validation.md debe ser real y coherente".
- **L4 — T1, the ten clones measured read-only.** `scan --scope repo --format json` from each, hashes and
  `git status` before and after: **all ten identical**, so the page's five-clone claim holds on ten. The rows that
  matched: `foreign-lockfile` passes on 8 of 10 (fail in `catalogs` and `berry`), `actions-pinned-sha` 56/64/24 with
  `catalogs` and `vercel` passing, `exact-versions` 206/68/96/26 (and 80 of t3's 96 carry `pnpm -C`), `workflow-permissions`
  32/4 with six of ten failing and `repro-steps-indent` passing. The rows that no longer hold: **berry 121 → 119** and
  **shadcn 281 → 282** findings, and the `no-bot-auto-merge` row ("2 in berry; shadcn passes"). Cause measured, not
  guessed: `berry` at `8f638c0` carries no bot config at all (0 findings, `pass`), and `shadcn` at `96da9cc` carries
  `.kodiak.toml` **and** `.github/dependabot.yml`, whose `bot-config-present` finding is severity `info` with a
  `manual` remediation - an observation that the human gate is what merges, not a verdict. Upstream moved; the
  product did not. The machine rows hold exactly as written: `pnpm` answers 10.33.4 inside `shadcn` and 12.3.4 on the
  PATH; `shadcn` declares `minimumReleaseAge: 2880` and `t3` inherits `4320` from the machine.
- **L5 — F3 was a mis-specified brief, and that is the finding.** The brief assumed `vercel-subscriptions` still
  held a `package-lock.json`; it left npm long ago and holds only `pnpm-lock.yaml`, so the session had no foreign
  lockfile to migrate and its `PASS` proves nothing about the path. The session did the right thing: it refused to
  edit the fixture to force a result, and said so under "what I could not verify". Relaunched as **F3b** with a
  hand-built npm fixture (the shape the page already describes). Two observations from F3, adjudicated by the
  parent: the **exit `2`** on `migrate --from npm` in a repository holding no foreign lockfile is **not a defect**
  (the spec's refusal list in §11.3 is about `--apply`'s conditions, and naming a manager the repository does not
  hold is a flag value that could not be answered); the message **"it holds no foreign lockfile, not
  package-lock.json"** is a real readability defect and goes to the messages unit.
- **L6 — F2 reported FAIL; three of its four claims do not survive re-measurement.** (i) The printed line
  `funky-secure migrate --from npm --apply` dying as `command not found` is the **brief**, not the product: the
  session was told the tool is not installed globally, and every report prints the tool by its own name. (ii)
  `kind: "manual"` beside a `command` is the shape `docs/spec/report.md:23` defines, not a contradiction; `manual`
  means the tool never runs it. (iii) The serious claim reproduced exactly and is **contract, not bug**: on a copy of
  `catalogs` with both lockfiles and a feature branch, `migrate --from npm --apply` exits `0` and removes
  `package-lock.json` - which §11.3 permits, and which the plan itself declares in step 3 ("whether it was imported
  from package-lock.json or resolved from the manifest, only the import carries its versions"). It is recorded as a
  contract observation for the page: a remediation printed on a repository that already carries `pnpm-lock.yaml`
  removes the foreign lockfile without proving the pins survive, by design, with the human step printed above it.
  What F2 did establish, unasked: the default-branch refusal is actionable and the scan itself wrote nothing.
- **L7 - F1, F4 and F3b: three defects confirmed by the parent, three claims rejected.** Verified with my own
  commands in the OS temp directory, never on a report's word:
  - **D1, `init --apply` silently drops a dirty `package.json`.** A fixture with a committed `package.json`,
    then one line appended to it: `init --apply --format json` exits **0**, its `plan` holds only
    `pnpm-workspace.yaml` and `.gitignore` (`["would-write","would-write"]`, `refused: []`), and it writes both
    while the manifest never gets its pin and is named nowhere. §11.2 says such a target is "refused (exit `3`,
    naming the file)", and F1's own run over a dirty `pnpm-workspace.yaml` did refuse. The difference is the
    target: a file the tool edits loses its items, a file it manages refuses the plan.
  - **D2, `start` from a nested directory plans a path that cannot work.** From
    `<repo>/nested/proj` in a repository whose root holds no manifest, `start` roots at the git root and prints
    `pnpm -C ../.. init`, `pnpm -C ../.. add <your first dependency>` and
    `git add ../../package.json`. The root has no `package.json`, so step 4 has nothing to add, step 5 targets a
    file that will not exist, and the last printed step (`scan --preset starter`) answers `FAIL` - which is
    exactly what F4 measured, on a repository shape (`M:/pruebas`, an unborn root holding folders) nobody
    designed for. The path never says the root moved, and its own cure for "not a repository" (`git init`) is
    never offered because a repository exists three levels up.
  - **D3, `migrate`'s step 3 promises a preservation that does not happen.** A fixture with manifest
    `lodash ^4.17.21` and a v3 `package-lock.json` pinning `4.17.20`: `pnpm import` answers `Done in 6ms` and
    records **4.18.1** - neither the pin nor the ranging floor, and a version lodash never published. Reproduced
    twice, offline, byte-identical lockfiles; the store carries no metadata directory, so the value is
    synthesised from the range. The tool prints "only the import carries its versions", which is the opposite
    of what the field measured, and `docs/validation.md`'s `pnpm import` row ("keeping the recorded version")
    is false in this shape as of pnpm 12.3.4. F3b's gold fired and is confirmed.
  - **Rejected, with the reason stated.** F1's "`refused: []` under `--apply --format json`" is the contract:
    `docs/spec/commands.md:119-123` puts the refusal on `stderr` so a script reading the last line of `stderr`
    sees a failure. F1's "a plan digest not reproducible from disk" was measured wrong: my run shows every
    managed-block digest matching its file byte for byte, and the one `DIFFERS` is the **first of two
    sequential items** on `package.json`, whose own bytes are the intermediate state (the second matches the
    final file). F2's four claims survive as: brief (the binary is not installed), contract (`kind: "manual"`
    with a `command` is the shape `report.md:23` defines), contract (the removal the plan declares in step 3).
    F4's "non-repository" fixture is not constructible under `M:/pruebas` because that directory is itself a
    repository; its Run A is environment-contaminated and its Run B, rooted where it was invoked, passed end to
    end: 7 steps, 4 commits, `PASS`, clean tree.
  - **What the campaign settles.** The #567 fix holds: dirty tree, junction and real path refuse identically,
    exit `3`, zero bytes. The read-only claim holds on ten clones. The default-branch refusal is actionable. The
    scan's own promises about writing nothing survived every session.
- **L8 — D2 retracted, and the retraction is the finding.** `L7` listed D2 as confirmed on F4's report and my own
  reproduction of the printed path. Reading `docs/spec/commands.md:300-316` after opening the issue settles it the
  other way: the spec decides the nested case explicitly. The plan describes the project at the **repository root**,
  and asked from below it, rows 5/10/14/15 rebase every `git add` path, rows 2/6/7/9/13 carry `-C <the root, from
  here>`, and rows 1/3/4/8/11/12/16 print the same bytes anywhere — row 3 specified to *stage the whole tree*. The
  three things the field session called wrong are therefore the contract, and its remaining consequence ("step 4
  has nothing to add to") was an inference: the row before it (`pnpm -C ../.. init`, row 2) creates the manifest at
  that root, and the session skipped rows 1-7 because they fell outside its write scope, so it never saw it exist.
  Its Run B, rooted where it was invoked, followed all seven steps to `PASS` on a clean tree. Issue #592 carries
  the retraction in full and is closed as not a defect. **The lesson is the doctrine's own fourth sentence**: a
  report is a hypothesis, and re-measuring it against the record is part of the measurement — I had the code
  reproduced and still had to read the contract to find out that reproducing it proved nothing. The record's D2
  entry in `L7` stays as written, because a Log is evidence; this entry corrects it.
- **L9 — D1 retracted too, and this one is mine to own.** The reproduction was real and the cause was not: my
  fixture dirtied `package.json` by appending `/* touched */`, which makes it **invalid JSON**, so the manifest's
  items were dropped by `src/lib/writers.js:690` (`established === null` after `src/lib/targets.js:91` rejected the
  parse), never by a dirtiness question. The control I failed to run: a **clean** copy loses the same two items. A
  dirty but parseable manifest already plans its four items and `init --apply` exits `3` with the exact text the
  issue demanded, pinned by `tests/init.test.js:643`. The delegated worker stopped at `interaction_required`
  instead of inventing a RED, which is the behaviour this repository asks for and the reason the error costs an
  issue rather than a commit. Issue #591 carries the retraction and is closed as mis-diagnosed.
- **L10 — what survives D1, filed as #594 and delegated.** The gap the fixture actually exposed is narrower: with a
  root manifest that exists and does not parse, `init`'s plan names `package.json` nowhere while it writes its
  siblings and exits `0` by §11.2/I-58, and `scan` is the only surface that reports it. The disposition is option 1
  of the worker's own list — the plan carries the manifest as `conflict` with the reason it is not rewritten, exit
  unchanged, no specification change, one test. `docs/rules/package-manager-pin.md:154-156` already promises that
  nothing is written to a file the rule could not read; this makes the plan say the same sentence the rule keeps.
- **L11 — the campaign's ledger, after two retractions and one confirmed defect.** Confirmed and shipped-or-queued:
  **D3** (`pnpm import` does not carry the foreign versions, and `migrate` says it does; #593), the residual **#594**,
  and **D4** (the `--from` wording, inside #593). Rejected with the reason on the record: F1's JSON-refusal channel
  (spec puts it on `stderr`), F1's digest claim (per-item digests are correct), F2's four claims (brief, contract,
  contract), F3's exit-2 (a flag value, not a refusal), F4/D2 (the spec decides the nested case, `:300-316`), and my
  own D1 (invalid-JSON fixture). Two of the seven rejections were contradicted by the record itself rather than by a
  re-run, which is the lesson: **a report and a reproducer both describe behaviour; only the contract says whether
  the behaviour is wrong.**
