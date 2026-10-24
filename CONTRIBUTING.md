# Contributing

This repository ships one package, `funky-secure`, whose only job is to tell the truth about a pnpm
repository's supply-chain posture. Every contribution is judged by that: a wrong finding is worse
than no finding, and a written file is worse than a refused plan.

Read [`docs/concept.md`](docs/concept.md) for what the tool is, and
[`rfcs/funky-secure-rfc.md`](rfcs/funky-secure-rfc.md) for the normative contract. **When a change
disagrees with the RFC, the RFC changes first, in its own pull request.** Decisions already made are
listed in [`docs/decisions.md`](docs/decisions.md); do not reopen one with code.

## Hard rules

These are not style preferences. A pull request that breaks one is not merged, however good it is.

1. **Zero dependencies.** No `dependencies`, no `devDependencies`, no build step, no bundler, no
   TypeScript. The package runs on Node `>= 22` with ESM and nothing else. Adding one dependency
   is an RFC change, not a dependency update.
2. **The tool never reaches the network and never installs.** No registry client, no resolution, no
   lifecycle script, no telemetry.
3. **A rule is a pure function.** `detect(ctx, { policy, severity })` reads resolved facts only: no
   `fs`, no `child_process`, no `Date`, no ambient `cwd`. A missing fact degrades to `skip` with
   `probeUnavailable`; it never becomes a `pass`.
4. **Every write goes through the guard.** A planned write passes `planItem` →
   `validateWriteTarget` (RFC 11.5) before touching disk. A refused guard becomes a `conflict` in the
   report, never a write and never a silent skip.
5. **The catalog is the single source of truth.** A rule's `id`, severity, friction and `docs` path
   live in `src/rules/index.js` and are rendered into `--help`, `explain` and `docs/rules/<id>.md`.
   The drift gate fails when they disagree; never edit a rendered page by hand without the catalog.
6. **No `Co-Authored-By` trailers** in commits, and conventional commits only (see below).

## Issue first

Every pull request closes an issue. Open the issue before the branch; a bug report and a feature
request have different checklists because they need different evidence.

### Bug report checklist

- [ ] One sentence naming what `funky-secure` did and what it should have done.
- [ ] The exact command, its full output, and the exit code (`0`, `1` or `2`).
- [ ] The rule id (`explain --list`) and whether `--format json` shows the same verdict.
- [ ] A minimal reproduction: the smallest repository layout that still fails, not your real project.
- [ ] Environment: `node --version`, `pnpm --version`, operating system, and whether the repository
      is a pnpm workspace.
- [ ] If a file was written, the original bytes and the bytes after the run.
- [ ] Confirmed the finding is not a documented deviation (RFC 8.2 and
      [`docs/decisions.md`](docs/decisions.md)).

### Feature request checklist

- [ ] The problem, not the solution: what question about a repository this tool cannot answer today.
- [ ] Which of the nine rules it touches, or the argument for a tenth (RFC 8.3 is the intake).
- [ ] The facts it needs and where they come from (`ctx.repo`, `ctx.machine`, a collector probe).
- [ ] What it does when that fact is missing: the `skip` code and its message.
- [ ] Severity in `baseline` and `strict`, friction, and the single command that fixes it — or why it
      is unfixable by design.
- [ ] The RFC section that must change before the code does.

### Issue acceptance

An issue is workable when a maintainer labels it `status:approved`. Issues without that label are
discussion, not a queue. Labels: exactly one `type:*` (`type:bug`, `type:feature`, `type:docs`,
`type:refactor`, `type:chore`, `type:breaking-change`) plus `status:approved` when accepted.

## Pull requests

Use [`\.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md). The body must carry the
issue reference, exactly one checked type, the evidence of what you ran, and the checklist below.

### Pull request checklist

- [ ] The branch is named `type/description` (for example `feat/quarantine-floor`) and matches
      `^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)/[a-z0-9._-]+$`.
- [ ] The body closes the issue (`Closes #N`, `Fixes #N` or `Resolves #N`) and the issue carries
      `status:approved`.
- [ ] Exactly one `type:*` label is applied, matching the commits.
- [ ] Every commit message is conventional (`type(scope): description`) and the history is a
      sequence of reviewable work units, not one commit per file.
- [ ] `node --test` passes, and the command and its counts are in the test plan.
- [ ] Behavior changes are test-first: the new test fails before the change and passes after it. Tests
      assert every observable effect (exit code, exact stdout and stderr, and that rejected input
      leaves stored files and counters untouched) through the public interface.
- [ ] A rule or library change has its `docs/rules/<id>.md` page updated; a command, flag or message
      change has `docs/cli.md` and the help text updated.
- [ ] The drift gate passes: `node --test tests/drift.test.js` (help, `explain`, rule pages, README
      table and `docs/architecture.md` still agree with the catalog).
- [ ] Goldens are regenerated only when the report was meant to change, with the intended diff read
      line by line: `pnpm golden`, then `git diff tests/golden/`.
- [ ] The repository still passes its own audit: `pnpm self`
      (`scan --scope repo --fail-on warn`) exits `0`.
- [ ] `pnpm pack --dry-run` still ships the expected files when `package.json` or the published
      directories change.
- [ ] The risk line is honest: `Risk: items 1-6 (reason)` or `Risk: none`, using the high-risk list
      in the RFC's delivery section. Anything touching credentials, permissions, stored data, CI
      delivery or a published contract is high risk and gets its own commit.
- [ ] New fixtures, goldens and tests are deterministic: no clock, no network, no machine state, no
      absolute paths.

### Size

Keep a pull request reviewable: about **400 authored lines** per work unit, with tests and docs
alongside the behavior they describe. A larger change is a chained sequence of pull requests, not one
bigger one. Generated files (goldens, lockfiles) do not count toward that budget, but the diff a
reviewer must read does.

### Review

This repository uses its own rules to review itself. A candidate that touches a high-risk area gets a
native review of the frozen candidate before merge, and the review never replaces the checks above:
tests, drift gate, goldens and the self-scan run either way. Expect findings to be fixed in a bounded
correction commit rather than argued away.

## Local checks

```sh
node --test                                   # the whole suite
node --test tests/drift.test.js               # catalog, docs and help agree
node bin/funky-secure.js scan --scope repo --fail-on warn   # the repository audits itself
node scripts/gen-golden.js                    # regenerate the golden reports, deliberately
node bin/funky-secure.js explain --list        # the catalog, in report order
```

CI runs the suite, the drift gate and the self-scan on every pull request, on Ubuntu and on Windows,
and at the declared `engines.node` floor as well as at the Active LTS. A red check is a real failure, not a
flake; if a check is flaky, fix the check.

## Commits and language

Conventional commits (`feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `test: ...`,
`chore: ...`). One idea per commit, imperative mood, no trailers.

Code, comments, tests, fixtures, commit messages, documentation and pull request bodies are written in
English.
