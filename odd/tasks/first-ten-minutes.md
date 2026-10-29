# The first ten minutes

A new command that orients a brand-new repository, and a preset that checks only what a project needs on day zero. Tracked as T1-T4 on branch `feat/start` (stacked on `feat/human-output-v2`, because the flow gate and the label renderer live there).

## Specs

S1. The entry point for a new project is a **command**, not a flag: "sería un comando nuevo el start? ya que no me gusta init --starter, creo que confundiría." `init` answers *what do I write*; the starter answers *how much do I check*. They stay apart.

S2. `start` is **read-only**. It never writes, never installs, never touches the machine. It exits `0` whether or not the repository is at policy — it is guidance, not a gate — and `2` only for a usage error. There is exactly one writer in the product, and it is `init --apply`.

S3. `start` derives everything from the same collection and the same write plan that `scan` and `init` use. A second engine that computed its own view could contradict the report about the same repository.

S4. The path is ordered by cause, and only the steps that still apply are printed: `git init` when there is no repository, `pnpm init` when there is no manifest, `funky-secure init --apply` while the plan has writes, `pnpm add <first dependency>` while there is no lockfile, `funky-secure scan --preset starter` last. When every step is done it says so instead of printing a stale checklist.

S5. A new preset, `starter`, runs exactly five rules at their `baseline` severities — `package-manager-pin`, `lockfile-committed`, `exact-versions`, `quarantine`, `sensitive-ignored` — and turns the other seven `off`. It is selectable through `--preset starter` and through the config file, and it does not change `baseline` or `strict`.

S6. **The honesty line.** When the effective policy disables rules, the human report states how many run and names the ones that do not, before the findings. `off` means the rule does not run, is not counted and prints nothing, so a `PASS` under a reduced preset would otherwise claim a coverage it does not have. The JSON document does not change: a machine reader sees `policy.preset` and the counts it already had.

S7. `baseline` and `strict` stay exactly as they are, including every severity and every declared deviation of section 9.1.

S8. The contract is recorded before the code ships: section 9.1 gains the `starter` row, 10.3 gains the honesty line, 11.7 is the new command, and `docs/spec/README.md` lists sections 9, 10 and 11 as amended by record 0003. `docs/cli.md`, `docs/guide.md`, `docs/architecture.md` (a fifth flow diagram) and the README entry point follow.

S9. No rule changes behaviour, no probe is added, no dependency appears. `start` reads facts the product already collects.

## Tasks

| ID | Spec | Work | Commit |
|---|---|---|---|
| T1 | S5, S6, S7 | `starter` in the policy, the honesty line in the human renderer, tests for both | `988c577` |
| T2 | S2, S3, S4 | `src/commands/start.js`, the `COMMANDS` entry, help, tests for every state of the path | `88b6a71` |
| T3 | S8 | Spec 9.1, 10.3, 11.7, amendment rows, cli/guide/architecture/README, RFC 0003, decision rows | `88b6a71` |
| T4 | all | Suite, self-scan, goldens zero diff, review | this commit |

## Log

L1 (verbatim): "me gusta, sería un comando nuevo el start? ya que no me gusta init --starter, creo que confundiría."

L2 (verbatim, the requirement): "cuando inicializo un proyecto por lo general quiero que tengamos lock de pnpm, no usar carets, un minimum release age, y poco mas, un comando muy basico y tal vez que lo configure, es lo minimo que un proyecto requiere para inicializarse a mi parecer, pero escucho tu opinion"

L3 (measured, parent): on an empty git repository today, `init` writes the workspace block and the ignore block but cannot pin (there is no manifest), and its next steps say `pnpm install`, which fails in a directory with no `package.json`. `scan` then reports the missing lockfile as an error. The zero state has no correct path, and the order is wrong: `savePrefix: ''` and `minimumReleaseAge` only act on an install that happens after the block exists.

L4 (decision, parent): `start` does not write, even though "que lo configure" invites it. Every writer is a security surface — `validateWriteTarget`, digest checks, the dirty-tree refusal — and a second one doubles the review load to add no capability. `start` names `funky-secure init --apply` instead.

L5 (decision, parent): the starter set is the five rules the owner named plus the pin, which is what makes "use pnpm" enforceable. `env-not-tracked` is deliberately left `off` and named in the honesty line: it reports an environment file already tracked, which is a day-two repair; `sensitive-ignored` is the day-zero half, and both are visible in the same line.

L6 (decision, parent): the honesty line is human output only. The JSON document of 10.2 is frozen in this record, and a machine reader already has `policy.preset`; a coverage field would be a separate record with its own consumers.

L7 (measurement, parent): the probe writes. `pnpm --version` creates `pnpm-lock.yaml` when the
repository declares `packageManager` and has no lockfile; isolated in three scratch directories, and
`pnpm config list --json` alone does not do it, nor does either probe without the pin. The tool s own
code writes nothing, but its probe chain contradicts "never installs, never writes" in exactly the
window this feature lives in. It also makes step 4 disappear on the second `start` run. Not fixed
here: changing the closed probe list (12.1) and the version-ambiguity semantics (12.2) is its own
record. Note for that record: `pnpm config list --json` already reports `userAgent`, which carries the
version, and is the value the ambiguity check compares against.

L8 (correction, parent): the honesty line shipped counting `policy.active`, which also fires for
`--only` and `--ignore` and called a selection "off by policy". It now counts the rules whose
severity is `off`, through `offByPolicy(policy)`, so narrowing a run claims no coverage.

L9 (evidence): 385/385 tests and the self-scan at exit 0 on the final tree; 376/376 on `988c577` in a
clean worktree, so the first slice stands alone. Goldens show zero diff against `main`.

L10 (measurement and amendment, 2026-10-28): two framework-generated shapes were built and measured
after the first slice shipped. Shape A, an `npm create next-app` repository — manifest with `next`,
`react` and `react-dom` ranges, `app/page.jsx`, a `.gitignore`, `package-lock.json`, no
`pnpm-lock.yaml`: `funky-secure start` printed `pnpm add <your first dependency>` as step 2, which
writes a second lockfile beside the npm one, and `scan --preset starter` reported nothing about the
foreign lockfile at all, because the preset turned `foreign-lockfile` `off`. Shape B, the same
repository with `pnpm-lock.yaml` instead of `package-lock.json`: already answered correctly, and it
stays the regression case. Amends S4 and S5; S1-S3 and S6-S9 stand.

- S5 now reads six rules: `foreign-lockfile` joins the `starter` set at the `warn` it already carries
  in `baseline`, and the other six rules stay `off`. `baseline` and `strict` are untouched. The
  honesty line becomes `not run  6 of 12 rules; off by policy: Environment files, Pinned actions, Bot
  auto-merge, CI install flags, pull_request_target, Workflow permissions`.
- S4's path gains one conditional step: while a foreign lockfile is present, `funky-secure migrate`
  is printed before `funky-secure init --apply`, because the posture is written once the repository
  has one package manager, and `pnpm add <your first dependency>` is not printed, because adding now
  would write a second lockfile. A `pnpm-lock.yaml` that appears during the migration is the
  migration's business, not that step's. The rest of the path and the continuous numbering are
  unchanged, and `why this order` grows by exactly one line in that state.
- The fact comes from the repository presence list the collector already resolved, from the same
  context the command already receives: no probe, no rule change, no dependency (S9 holds).
- Evidence: 388/388 tests and the self-scan at exit 0; `tests/policy.test.js` asserts the six-id
  active set and the untouched `baseline`/`strict`, `tests/start.test.js` asserts both framework
  shapes end to end through the real CLI. Recorded in the RFC as `## Amendment — 2026-10-28`, because
  that record is still `accepted` and its branch is open.

L11 (decision and amendment, 2026-10-28): the skill was distributed through `pi install
npm:funky-secure`, which made one agent runtime the way to get it. funky-secure is an ordinary npm
CLI, npm has no convention for installing a skill, and a `postinstall` writing into a home directory
is the side effect this tool audits other packages for. The binary is the channel instead:
`funky-secure skill` prints `skills/funky-secure/SKILL.md` on stdout byte for byte, so a redirect
installs it for any runtime that reads a directory, and stderr carries two lines naming the
project-local `.agents/skills/funky-secure/` and user-level `~/.agents/skills/funky-secure/`
destinations and no agent product. The command is read-only, takes `--help` only, resolves the file
against the installed module rather than `process.cwd()`, collects no repository fact, spawns no probe,
and exits `2` with the usual two lines and an empty stdout when the shipped file cannot be read.

- `package.json` drops the `pi-package` keyword, which was gallery metadata framing the package as an
  agent extension, and keeps `"pi": { "skills": ["skills"] }`, which is inert for npm and lets Pi read
  the directory it already reads. It is not the documented path.
- Spec 11.8 is the new contract, and it states that record 0004 amends it. The amendment row in
  `docs/spec/README.md` is not added here: that file is outside this change's surfaces, so the row
  stays for the parent to add. `docs/spec/README.md` maps record sections, and 11.8 is a subsection of
  section 11, which the table already lists as amended by records 0002 and 0003.
- `skills/README.md`, `docs/cli.md`, `docs/architecture.md` and the README now lead with the binary and
  keep the tarball copy as the alternative; the Pi paragraph is one sentence, clearly secondary.
- Evidence: `node --test` passes 397/397 (389 on the base commit, plus the eight tests in
  `tests/skill.test.js`); `node bin/funky-secure.js skill > /tmp/skill-out.md` diffs clean against
  `skills/funky-secure/SKILL.md` at 4386 bytes on both sides and prints the two stderr lines; the
  self-scan at `--fail-on warn` exits 0. The existing drift gates cover the new command without an
  addition to `tests/drift.test.js`: the `docs/cli.md` command sections, the mermaid flow under
  `## Command flows`, the README command check and the `--help` flag listing are all driven by
  `COMMANDS` and `FLAGS`. A differential run of `scan`, `start`, `init`, `migrate`, `explain` and two
  usage errors against the base copy shows one intended difference: `--help` gains the `skill` row.

L12 | 2026-10-29 | The owner rejected the redirect as friction ("no me gusta especificar rutas") and authorised one write outside the repository, on the condition that replacing an installed copy asks first. `skill --install` now writes the shipped bytes to `.agents/skills/funky-secure/SKILL.md` under the worktree root (project, committed) or the home directory (user, `--user` forces it). No path is accepted; a positional is a usage error. A differing file is replaced only after an explicit answer — `--force` and `--keep` are that answer in advance, and neither with no terminal is exit 2. Identical is never rewritten; the write is atomic; a symlink destination is refused. Evidence: 20 tests in tests/skill.test.js (one skipped on Windows, which cannot create a symlink without a privilege), 409 total, self-scan exit 0. Contract: 11.8 rewritten, 11.5 point 7 and 11.6 amended, record 0005, decisions I-35.

L13 | 2026-10-29 | Two decisions closed as documentation, both already implemented on `feat/start`, with no source, test or version change in this entry. (1) **Version before bytes** extends record 0005 rather than opening a seventh record: `skills/funky-secure/SKILL.md` declares `version: 0.4.0` in its frontmatter, `tests/drift.test.js` fails when that value and `package.json` disagree, and `inspectInstallation` returns one of six states — `absent`, `identical`, `unversioned`, `edited`, `older`, `newer` — because "the bytes differ" hides three decisions that are not the same one. An older copy is the upgrade the install exists for, a newer copy is a downgrade this binary has nothing better to offer than, and the same version with different bytes is a local edit a routine command must not discard. A downgrade is refused unless `--force`, `--keep` is accepted as the answer that leaves the newer copy alone, and both the question and the refusal name which case they are about. Recorded as `## Amendment — 2026-10-29 (version before bytes)` in `rfcs/0005-skill-install/rfc.md`, decisions I-36. (2) **Human defaults** is a new record, `rfcs/0006-human-defaults/rfc.md` (status `accepted`, revision 1), because it decides one behaviour and one principle: `funky-secure explain` with no rule id prints the catalog and exits `0`, with `--list` kept as the explicit synonym for the same bytes, and defaults are human while flags are refinements or machine contracts, never requirements for the ordinary path. It states the table of which verb needs which flag (none does), that `--apply` and `--install` are the only flags that turn a plan into an action and `explain --list` was the only flag that gated a read, that the product's single prompt is the replacement question in `skill --install` because it is the one step that discards a local edit, and that a TUI and a wizard were rejected as a second rendering of every command and as questions the repository already answers. Decisions I-37. Contract: 11.4 gains one sentence, the `## Amendments` table maps section 11 to 0006 for 11.4, `docs/cli.md` states the same rule in the `explain` section with the real `funky-secure explain | head -6` capture, and `rfcs/README.md` gains the row and the directory. Evidence: the suite reports 0 failures — 418 tests, 417 pass, 1 skipped (the symlink case Windows cannot create without a privilege) — and the count was 416 when this entry began and 418 when it closed, because `tests/skill.test.js` and `src/commands/skill.js` were edited in the same worktree during it; this entry changed no source and no test. `node bin/funky-secure.js scan --scope repo --fail-on warn` exits 0; `funky-secure explain | head -6` exits 0 and prints the catalog, so the capture in `docs/cli.md` is the bytes the command produces. The three differ-states were captured from real runs of `src/commands/skill.js` with an injected home directory: `is version 0.3.0; this binary ships 0.4.0`, `carries local changes on version 0.4.0`, and `refusing to replace …: it is version 9.0.0, and this binary ships 0.4.0`, with `unversioned` reading `carries no version line, so where it came from cannot be told`. Left open, and outside this entry's surfaces: two prose lines still describe the old command — the `--help` summary in `src/cli.js` reads "or list the catalog with `--list`", and `docs/architecture.md` line 141 lists a missing id among the exit-`2` usages. Both are one-line corrections for a follow-up that may touch source and that file.

L14 | 2026-10-29 | The owner rejected the layered docs gates (generated tables, verbatim-quote gate) as ceremony: what he wants is not to forget where to look. The worker building those gates was cancelled before it wrote, and the answer is docs/README.md — a map from a change to the page that must move with it, three habits, what node --test already catches, and the three things no gate can. Linked from AGENTS.md, README and docs/spec/README.md. No new gate.

