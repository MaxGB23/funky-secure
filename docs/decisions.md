# Decision log

The normative specification is [`../rfcs/funky-secure-rfc.md`](../rfcs/funky-secure-rfc.md). This page
is the review surface for the decisions behind it: first the product decisions of RFC Appendix A,
then the implementation decisions taken during F0–F4 and recorded in
[`../odd/tasks/funky-secure-v0.1.md`](../odd/tasks/funky-secure-v0.1.md).

Nothing here restates the RFC. Each line names the decision and the section or file it binds.

## Product decisions (RFC Appendix A)

| # | Decision | Binds |
|---|---|---|
| D-1 | The product both analyses a project and initializes it with good practices. | 1.1 |
| D-2 | pnpm's own defaults are the baseline; the tool does not re-implement them. | 1.3, 4.1 |
| D-3 | pnpm is recommended and npm is migrated, never required. | G4, R3, 11.3 |
| D-4 | The product must be lighter and better focused than the one it replaces. | 4, 8.4 |
| D-5 | A global scan that overwrites no user configuration, plus project and workspace scanning. | 7, 12 |
| D-6 | No floating ranges and no automatic dependency merges. | R5, R9 |
| D-7 | In CI: Actions pinned by SHA, sensitive files and `.env` covered by ignore rules. | R6, R7, R8 |
| D-8 | Own repository and package named `funky-secure`, no version suffix. | 6 |
| D-9 | Nine rules now, the rest in v2. | 8.2, 8.3, 8.4 |
| D-10 | `funky-ai` is out of scope and untouched. | 17 |
| D-11 | `exact-versions` is `warn` in `baseline` and `error` in `strict`. | R5, 9.1 |
| D-12 | `init` does not write `pnpm-workspace.yaml` in v0.1 except the managed block, and only with `--apply`. | 11.2 |
| D-13 | Receipt-driven development is enabled for this workspace. | session control |
| D-14 | Help is always current, and complete architecture documentation is a deliverable. | 13, 14 |
| D-15 | The RFC session ends with the document; implementation happens in another session. | whole document |
| D-16 | R4 measures the gate, not the number: a preset-dependent floor, `warn` in `baseline`, `error` in `strict`. | 8.2 R4, 9.1, 9.4, 11.2 |

## Implementation decisions (F0–F4)

| # | Decision | Binds |
|---|---|---|
| I-1 | The ignore probe is split in two lists: `IGNORE_CANDIDATES` is what R7 requires to be ignored, `PROBED_IGNORE_PATHS` adds `pnpm-lock.yaml` so R2 can report an ignored lockfile. One probe, per-path verdicts; merging them would have made R7 demand an ignored lockfile. | `src/lib/targets.js`, 8.2 R2/R7 |
| I-2 | `--scope repo` still resolves the answering pnpm version, but not its configuration (`machineFacts(collector, { withConfig: false })`); `ctx.machine.configOutOfScope` tells `quarantine` that the absent configuration is excluded by contract, not an unavailable probe. | `src/lib/scan.js`, `src/lib/targets.js`, `src/rules/quarantine.js`, 7.2 |
| I-3 | Passing findings are never rendered as findings: the human renderer rolls them up into one `passing …` line and the JSON renderer drops them, because the report already counted them. | `src/lib/render-human.js`, `src/lib/render-json.js`, 10.1, 10.3 |
| I-4 | `quarantine` reports on `repo-root` with `scope: ['repo']`, not on the machine section: the effective value is a repository posture even though the fact comes from the manager. | `src/rules/quarantine.js`, 7.1, Appendix D.1 |
| I-5 | R6 filters the complete tracked list by basename instead of adding a `:(glob)` pathspec probe; the equivalence holds because the tracked list is complete, and the mandatory template exclusion list is what prevents the `.env*` over-match. | `src/rules/env-not-tracked.js`, 8.2 R6, E4 |
| I-6 | R9 rides its configuration signal on a `pass` finding instead of a failure: `info` is a severity in the report contract, not a status, and v0.1 has no per-finding severity override. | `src/rules/no-bot-auto-merge.js`, 8.2 R9 |
| I-7 | R5 classifies specifiers without resolving any: `workspace:*`, `workspace:1.2.3` and `link:` are exact; `workspace:^`, `file:`, partial versions, wildcards, tags and URL/git specifiers are floating; an unrecognized shape is not reported. | `src/rules/exact-versions.js`, 8.2 R5 |
| I-8 | W4 never replaces a config document: a file that already declares exactly `{ "preset": "strict" }` is `would-skip` and keeps its own bytes; any other preset, any other key, an unparseable file, an unreadable file, or a config discovered outside the repository root is a `conflict` with the reason named. | `src/lib/writers.js` (`writeStrictConfig`, `planStrictConfig`), `src/commands/init.js`, 11.2 |
| I-9 | A tracked root `.npmrc` without `_authToken=` is exempt from the ignore requirement in both readers — the rule does not demand it be ignored and the `.gitignore` block does not add it — because a tokenless `.npmrc` is configuration a repository may deliberately commit. | `src/lib/targets.js` (`npmrc.tokenlessTracked`), `src/rules/sensitive-ignored.js`, `src/lib/writers.js` (`trackedNpmrcFacts`), 8.2 R7 |
| I-10 | With `--format json`, `init` writes the plan document to stdout and nothing else; the `write` ledger of `--apply` goes to stderr, because a second document on stdout would make the plan unparseable. | `src/commands/init.js`, 10.5, 11.2 |
| I-11 | The release guard runs npm through its CLI entry point (`node .../npm-cli.js`) rather than a `npm.cmd` shim: a `.cmd` is not executable without `shell: true` on Windows (E7), and the shell fallback earns the DEP0190 warning. It reads `files` from `package.json` instead of duplicating the contract, so the check cannot drift from what npm packs. | `scripts/release-guard.js`, `tests/release-workflow.test.js`, 17.3, 17.4 |
| I-12 | Publication is reachable only from a `v*` tag, and the guard treats a missing tag as a local dry run instead of a failure: `npm publish` from a workstation stays possible for a maintainer, but CI always passes `--tag "$GITHUB_REF_NAME"`, so a mismatch there is fatal and publishes nothing. | `.github/workflows/release.yml`, `package.json` (`prepublishOnly`), 17.3 |
| I-13 | `ci-no-safety-overrides` is `warn` in `baseline` and `error` in `strict`, because friction 1 needs no deviation from 4.2/9.1: removing a flag is one edit, and the finding names an explicit override of pnpm's own CI default rather than a preference, so a repository that never overrides the default is never touched. The two codes keep the frozen lockfile and the lifecycle scripts apart, because the delivery contract (17) rests on the lockfile and the install scripts are the code-execution path. | `src/rules/ci-no-safety-overrides.js`, `docs/rules/ci-no-safety-overrides.md`, 8.3 (0.2 scope), 16 F5 G2, 9.1 |
