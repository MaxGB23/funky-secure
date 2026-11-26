# Pendings closeout

The four carried defects of the 2026-11-26 ledger, closed one work unit at a time, after the local
hygiene the owner approved. The portfolio data file is out of scope on the owner's own word.

## Specs

**S1 — Scope.** The owner's words: *"vamos con los pendientes, sin tocar el portfolio, eso lo decido yo cuando"*.
The six ledger items minus item 5 (the portfolio data file) are in scope. Item 6 (local hygiene) ran
first and needs no pull request; the rest are four defects, each its own issue and its own pull request.

**S2 — `docs/cli.md` exit codes.** Today `docs/cli.md:503` says *"It refuses — exit `3`, naming the file
or the reason, and writing nothing:"* and its bullet at `:506` claims *"a plan item whose content
changed between planning and writing, or that carries no content."* The contract says the opposite:
`docs/spec/report.md:326` — *"`2` | The tool could not answer: bad usage, unreadable input, malformed
config."*; `src/cli.js:376` — `return error instanceof RefusalError ? 3 : 2;`, with both guards thrown
as `ConfigError` (`src/lib/plan.js:345`, `:348`). Requirement: the page names those two cases as exit
`2`, and a test fails if an exit-`2` case returns to the exit-`3` list.

**S3 — R3-001, the migrate probe.** `tests/migrate.test.js:350` asserts the pathspec only —
`assert.deepEqual(status, ['status','--porcelain','-z','--','package-lock.json'])` — and the stub at
`:88` takes a single argument, so production dropping `root` from `src/commands/migrate.js:188` passes.
Requirement: the subdirectory case asserts the probe's `cwd` is the repository root, and removing the
argument fails it.

**S4 — the advisories of #566 that are still true.** (a) `.github/workflows/ci.yml:96` enforces a floor
of `1000` whose comment justifies its existence, never the number. (b) `ci.yml:53` claims *"the only
leg the product does not branch on"*, false beside its own next clause: the product branches on
`win32` against POSIX, so Ubuntu is also non-win32. (c) `docs/decisions.md:286` (I-99) claims the leg
*"asserts the suite's own fail count, that skip text, and a floor on `tests`"* yet lists no test file,
and no test asserts that job today. (d) The recorded citation drift has no premise: nothing cites
`src/lib/plan.js:302`; the drifted citations are `:291-293` (`odd/tasks/next-release-backlog.md:127`,
`:232`) and `:284-287` (`rfcs/0037-a-refused-plan-says-so/rfc.md:22`), both records, so no rewrite.

**S5 — `docs/decisions.md` holds the registry twice.** 287 lines, 197 `| I-` rows for 99 distinct
numbers, and `:143` truncates I-98 mid-sentence with `# Decision log` pasted into the row. Copy 2
(`:144-286`) is complete and carries the only I-99. Requirement: one row per `I-` number, the complete
copy survives, and a test fails on a repeated number or a heading pasted inside a row.

**S6 — Local hygiene (executed, no pull request).** `main` repointed from `c378e71` to `origin/main`
(`git cherry` marks that commit's patch as already upstream); fourteen merged local branches deleted;
`docs/540-render-rebases` and `docs/541-migrate-step` kept because their three `odd/tasks/` records
(`render-runs-at-the-root.md`, `render-rebases-the-command.md`, `migrate-step-bases.md`) exist nowhere
else.

## Tasks

| ID | Spec | Work | Route | Commit |
| --- | --- | --- | --- | --- |
| T1 | S5 | Dedupe `docs/decisions.md` and guard the registry with a test | inline, test first | `7f138e4` |
| T2 | S2 | Correct `docs/cli.md`'s exit-3 list and guard the direction it loses | inline, test first | `1637a78` |
| T3 | S3 | The migrate subdirectory case asserts the probe's `cwd` | inline, RED by reverting the argument | `b61bc2b` |
| T4 | S4 | CI floor rationale, the false claim, a test for the macOS job, the I-99 file cell | inline | `592121e` |

Each task ends with its own issue and its own pull request through `node scripts/open-pr.js`.

## Log

- **L1** — owner, verbatim: *"vamos con los pendientes, sin tocar el portfolio, eso lo decido yo cuando"*
- **L2** — owner answered two decisions: PR #570 merged with a merge commit (`063e0fb`); the local
  cleanup ran with the listed targets and kept the two record branches.
- **L3** — measured before writing: S4(d)'s premise is stale; nothing cites `src/lib/plan.js:302`.
- **L4** — earlier in the session, on the owner's instruction, the two orphan gentle-ai candidate views
  were removed and the macOS check was renamed and merged (#569, #570).
- **L5** — delivered, in order: T1 `7f138e4` (**#571**, PR **#572**), T2 `1637a78` (**#573**, PR **#574**),
  T3 `b61bc2b` (**#575**, PR **#576**), T4 `592121e` (**#577**, PR **#578**). `assess` put the first three
  under budget (no review due). T4 came back `nativeRisk: high` for `ci.yml`, and
  `review-2e8dbdd9709458d5` (tier high, `risk`+`readability`) approved it and was burned;
  `review-4e28f88409d6d955` did the same for #570 earlier.
- **L6** — T4's review left three non-blocking findings, relayed here as the work they are: **R2-001** the
  floor comment's arithmetic (`1000` is 28 below 1028, and 29 lost cases trip it — and behind that, a
  decision the number never answered: 28 cases of slack against a comment promising "a plan's worth of
  removals"); **R2-002** the new test claims a blocking leg it never asserts (no `continue-on-error`
  check, no proof the gate reads the job); **R2-003** two floor assertions are unanchored substrings. All
  three are deferred to **#579**, on the review's own instruction not to reopen the approved candidate.
- **L7** — #579 closes in its own unit, with the owner's decision recorded: **the floor stays at `1000`**.
  The comment now states the measurement instead of promising slack: `1000` against the 1030 cases `main`
  reports after the four merges, so it trips after 31 lost cases, deliberately tight because the leg is a
  tripwire for a suite that silently stopped running its cases. The earlier 1028/29 pair was true of each
  unit's own base (`063e0fb` + one case) and false of `main`: three of the four units added a case each.
  The same unit asserts the absence of `continue-on-error` (blocking is a conclusion, and
  `scripts/wait-for-ci.js:23`,`:68` read conclusions) and anchors the two floor needles, so a
  commented-out guard no longer satisfies them.
