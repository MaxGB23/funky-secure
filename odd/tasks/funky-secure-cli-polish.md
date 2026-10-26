# funky-secure — CLI polish: a tool that explains itself, and an `init` that makes a pnpm project

Specification: the owner's request in this session (Log L1-L4) plus the measured evidence recorded in
L5. No version is fixed by this document: the release number is decided at the end. Branch:
`feat/cli-polish`.

## Specs

S1 — `init` is deterministic and independent of the machine that runs it. Its plan reads the
repository's own files and the declared policy (preset plus repository config), never the effective
value the host's pnpm configuration happens to satisfy. A key the repository does not declare is
planned even when the machine already satisfies it, because a repository that only passes on its
author's laptop is the defect this product reports.

S2 — `init` initializes a pnpm project, not just the findings it happened to see. With `--apply` it:
creates `pnpm-workspace.yaml` when absent (the managed block only, never a `packages:` key);
writes `packageManager` when missing; writes the quarantine managed block; writes the `.gitignore`
managed block; writes `funky-secure.config.json` under `--preset strict`; and adds `savePrefix: ''`
to the same managed block so a later `pnpm add` cannot reintroduce a caret. Measured on pnpm
12.3.4: `pnpm add left-pad` saves `^1.3.0` without the key and `1.3.0` with it.

S3 — `init` ends with a `next steps` block naming only the steps a human must run, in order, never
executed by the tool: `pnpm install` when no `pnpm-lock.yaml` exists, `funky-secure migrate --from
npm --apply` when a foreign lockfile exists, and `git add` of the paths it wrote. A plan with no
human step prints no `next steps` heading.

S4 — Every `fail` carries an actionable remediation. A rule that cannot fix what it reported prints
the exact human action instead of nothing, so `lockfile-committed` names `pnpm install`. The
`exact-versions` remediation must be a command that works on pnpm 12.3.4: the measured no-op
`pnpm add --save-exact <name>@<range>` is replaced by
`pnpm pkg set 'dependencies.<name>=<version>'` followed by `pnpm install`.

S5 — A message a human reads ends with the action. Usage errors, refusals and exit-2 failures print
one actionable sentence first; the internal diagnosis follows only after a `reason:` label or under
`--verbose`. `migrate --apply` on the default branch says "switch to a feature branch" before it
explains the `origin/HEAD` fallback.

S6 — A `skip` informs. A rule skipped because of the scope contract names what was not verified and
the command that verifies it (`--scope all`), instead of printing only the contract reason.

S7 — The report states its provenance in one header line, and never claims more than was measured.
The preset and the file it came from are exact and are printed. For the quarantine floor the line
says whether the repository itself declares the key (`declared in pnpm-workspace.yaml`) or not
(`not declared in this repository`), and does not attribute a value to the project or the machine,
because E2 measured that pnpm reports no origin. The line also states whether the machine scope was
excluded. The JSON report carries the same facts.

S8 — Documentation in English, all of it. `docs/guide.md` is new and is the entry point: how to read
the output (symbols, `summary`, `verdict`), the basic commands with no flags, a "if you see this, do
this" table for the twelve rules, the advanced flags and scopes, the CI recipe, per-project
configuration, and the questions a newcomer asks (why it never installs, why it never writes the
machine, why `--scope repo` does not verify the pin). `README.md` follows the shape of
`M:/funky-forge-v2/README.md` (identity and emoji kept, image still pending) and links to the guide.
`docs/architecture.md`, `docs/cli.md`, `docs/concept.md` and `docs/decisions.md` are updated wherever
this feature changes what they describe; `docs/rules/*.md` are updated where a remediation changes.

S9 — Nothing else moves: no dependency, no network, no machine write, no write outside the closed
target list, and no version bump. The drift gate, the goldens and the self-scan stay green.

## Tasks

| ID | Task | Spec | Route | Commit |
|---|---|---|---|---|
| T1 | Messages and remediations: actionable failures, one-sentence exit 2, informing skips, provenance header | S4, S5, S6, S7 | worker | — |
| T2 | Deterministic `init`, pnpm bootstrap, `savePrefix: ''`, `next steps` | S1, S2, S3 | worker | — |
| T3 | `docs/guide.md`, README in the funky-forge shape, architecture/cli/concept/decisions sync | S8 | inline | — |

## Log

L1 — 2026-10-26, owner's request, verbatim: "necesitamos un doc que sea facil de entender, como lo
que proponia mi rfc inicial, comandos basicos vs avanzados. Bien descritos y cómo interpretarlos, el
cli ya debería dejar claro el mensaje y no un error o exit codes raros."

L2 — 2026-10-26, owner's pain points, verbatim: "A veces solo quiero inicializar un proyecto con pnpm
y que ya tenga una config minima. Sin contar la config global, a veces podría preferirse por proyecto
algo diferente." Answered by S1, S2, S3 and by the existing `quarantineMinutes` / `rules` overrides in
`funky-secure.config.json`, which S7 makes visible.

L3 — 2026-10-26, owner's constraints, verbatim: "evita el voseo, español neutro solo en nuestra
conversacion. Docs todo en ingles, incluso el nombre docs/guide, etc. La version inicial en npm aun
no se lanza, saldrá cuando yo sienta que funciona bien. Haz odd para implementar todo. El bump de
version se decidirá al final."

L4 — 2026-10-26, owner on the README, verbatim: "para readme podemos guiarnos del readme de
funky-forge, aunque la imagen queda pendiente". The emoji title is his identity and stays.

L5 — 2026-10-26, evidence measured before this feature was written, all on pnpm 12.3.4 and reused by
the specs: `init` scans with `scope: 'all'`, so a host with a global `minimumReleaseAge: 4320` makes
`quarantine` pass and the quarantine block is never written (S1); `pnpm add --save-exact
left-pad@^1.3.0` exits 0 and leaves `^1.3.0` in `package.json` (S4); `savePrefix: ''` in
`pnpm-workspace.yaml` changes `pnpm add left-pad` from `^1.3.0` to `1.3.0` (S2); the live `migrate`
refusal leads with the `origin/HEAD` fallback instead of the action (S5).

L6 — 2026-10-26, S7 corrected before implementation: RFC 9.4 and E2 record that the effective pnpm
configuration reports no origin, so the report states only what the repository file declares. The
first draft of S7 asked for a `project`/`machine` attribution and would have printed a fact the tool
cannot measure.

L7 — 2026-10-26, T1 first handoff and the decision taken on it. S5 and S7 landed with the two-line
refusal shape (`funky-secure: <action>` then `reason: <diagnosis>`) and the `provenance` line/field,
goldens were regenerated deliberately, and the suite stood at 328/329 with the single failure being
S6. The worker could not satisfy S6 because the two skip messages are owned by
`src/rules/package-manager-pin.js` and `src/rules/quarantine.js`, which the handoff's surface list did
not include, so it stopped and asked instead of widening its own scope. Decision: approve option A
(rule, doc and test page for both rules) and extend it — S4 says *every* fail carries an actionable
remediation, and the worker measured that `no-bot-auto-merge` and `env-not-tracked` still carried
`kind: 'none'`, so those two rules and their pages join the same work unit. Recorded because the
narrow surface was the parent's defect, not the worker's, and because a spec sentence ("every fail")
was implemented for the two rules the task named instead of for the catalog.
