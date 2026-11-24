# The prefix crosses the drive

The human report prefixes each printed command with `(cd "<root>" && <command>)` when the reader stands
below the repository root. Issue #549 measured that in `cmd` such a `cd` does not change drive: exit 0,
prompt unchanged, and the command runs in the wrong directory in silence. This record says what the code
may do about it, and closes the route/probe findings the approved review of #552 left open (#553).

Two versions were refuted by blind judges and this one is written from what was measured, not from what
seemed right: the redesign they killed is recorded with its measurements in L2, and the reachability
claim is narrowed to what the evidence supports in L3.

## Specs

**S1. The measured defect is real; the reachable distance does not cross a volume.**
`cmd` reads `cd "M:\funky-secure-v2"` from a `C:` prompt as a success, keeps `%CD%`, and the next command
runs in the wrong directory with exit 0 (measured twice, independently). But the tool renders that prefix
only when `cwd` is below `root`, and both come from the same shell context: `root` is
`git rev-parse --show-toplevel` run from the invocation directory (`src/lib/git.js:24-27`) or `cwd`
itself (`src/lib/targets.js:324-326`), and no flag (`src/cli.js:57-88`), positional
(`src/cli.js:234-239`), config key (`src/lib/config.js:18`) or environment variable carries a root. On a
real drive both land on one volume — `M:` is a fixed drive and the machine has no `subst` mapping
(measured).

**S2. The residual is named, and the input surface is pinned.**
An alias of the same directory whose resolution fails (`subst`, a junction, a disconnected UNC mapping)
could still put a git spelling and a `process.cwd()` spelling on different letters. That shape is **not
measured** and this record does not claim it safe; it is named as a limit, together with a UNC root pasted
into `cmd`, which refuses loudly and stops the `&&` chain. What is pinned is the input surface: a test
asserts that `--root`, `--cwd`, `--dir` and `--project-root` are refused as unknown flags, that `scan`
takes no positional, and that a config file carrying a `root` key is rejected. An environment variable is
named as a limit rather than pinned, because nothing in this repository enumerates the environment.

**S3. The redesign is rejected on measurement, not on taste.**
`pnpm -C "<root>" -C packages/api pkg set …` is `error: the argument '--dir <DIR>' cannot be used multiple
times`, rc 2, because the pin already carries the importer directory; `pnpm install --lockfile-only &&
funky-secure scan --only exact-versions` has a second segment with no directory flag at all (`src/cli.js`
has none); `corepack` has none either; and a renderer that hands back nothing prints `→ null` and
`next null`, because neither print site guards the return (`src/lib/render-human.js:202`, `:669`). A
mechanism that composes with none of those is not a mechanism, and the position it would fix is S2's
residual, not S1's distance.

**S4. The probe fails when it measures nothing (R4-002, #553).**
`pinCommand` returning `null` for a fixture is skipped today (`scripts/probe-remediation.js:315`, `:333`),
so a rule change that refuses the fixtures leaves the Windows leg green with no pin executed, printing
"no pin command was printed, so none was followed" as a success. The probe reports a problem instead of
skipping, and the null path is **executed by the test**: the fixtures become an optional argument of
`probe()` and the test drives a fixture the rule must refuse, so a guard written as `=== undefined`
instead of `!== null` is red, not green.

**S5. The refusal names every reason it can refuse for (R2-002, #553).**
`pinCommand` refuses three values, each against its own grammar: the dependency name (`SAFE_DEPENDENCY`),
the importer directory (`PROVABLY_SAFE_DIRECTORY`) and the recorded version (`SAFE_VERSION`), plus the
shell reason those grammars exist. The sentence names the three grammars and says the tool never escapes,
quotes or filters a value into shape; the assertions that pin the old sentence in
`tests/rules/exact-versions.test.js` move with it. The same change folds the `''` importer directory into
the root case beside `undefined` and `'.'` in both `unsafeRoute` and `frozenRoute` (#553 R4-004), because
the rule can be driven with a crafted `cwd` context in a unit test even though no CLI invocation produces
it.

**S6. Five present-tense places still say the pin's spelling follows the name alone.**
The code chooses by the name **and** the version (`!version.includes('*')`,
`src/rules/exact-versions.js:270-273`, merged in #552), and these say otherwise:
`rfcs/0042…/rfc.md:54` ("chosen by the name"), `docs/spec/README.md:122` (amendment row 8),
`docs/decisions.md:141` (I-96), `docs/rules/exact-versions.md:179` ("The spelling follows the name"), and
`docs/spec/rules.md` §8.2 R5, which lists the name's three clauses and never the version's. Corrected the
way this repository corrects a record: a dated paragraph appended to 0042's existing `## Errata`, an
`I-98` row whose text states the three-clause predicate and that it supersedes I-96's clause by number
(no row rewritten), and the present-tense pages edited in place.

**S7. R4-003 is refuted; R4-004 is fixed (S5).**
The scoped probe fixture carries `dir: 'packages/api'`, so it prints the bracketed spelling, and
`runtime-claims-windows` already executes both spellings under `cmd`: nothing to add. `R4-004` is the
`''` guard folded into S5 with its unit test.

**S8. The limit lands where the reader looks for it.**
`docs/spec/report.md`'s §10.3 prefix sentence gains S1/S2's limit; `rfcs/0041` gets a dated errata saying
what the prefix assumes (a shell that can reach the repository's volume) and what it does not claim (the
alias residual); `docs/cli.md` restates it; `docs/validation.md` names `runtime-claims-windows` and the
shells each leg executes.

## Tasks

**T1 — the input surface (S2).** Tests, RED first: four flag spellings refused as unknown, a positional
refused, a `root` config key refused; then the documented-flag contract already in
`tests/docs-contract.test.js` binds any new flag to `docs/cli.md`. Deleting the closed-list guard turns
each of them red.

**T2 — the probe guard (S4).** `probe()` reports a problem for a fixture that yields no command; the test
drives the null path through an injected fixture, and asserts both shipped fixtures still produce one.

**T3 — the refusal sentence and the `''` guard (S5, S7).** Both functions, the test file that pins the
sentence, and one unit test for `''` reaching the root case.

**T4 — the docs PR (S6, S8).** Five present-tense places, 0042's errata paragraph, 0041's errata section,
`I-98` in `docs/decisions.md`, the 0041 amendment row (row 10) and the 0042 row (row 8), §10.3, `cli.md`,
`validation.md`. Append-only: no RFC body is rewritten, no decision row is edited.

**T5 — reconcile the shell matrix when the measurement worker returns.** Its cells (`cd`, `cd /d`,
`pushd`, `-C`, per shell and per root shape) become the evidence quoted under S1 and S3; nothing else in
this record depends on it.

## Log

- **L1** — the owner's request, verbatim: «Crea el plan para solucionar lo que queda, revisa la memoria de
  engram. Evita trabajar de mas, cualquier cosa prioriza delegar para mantener contexto limpio. Explorers,
  workers, etc. Vuelve con el veredicto de jueces e implementa de una vez, sin detenerte, sólo puedes
  parar cuando haya una decisión muy crítica. Si tú la puedes responder en base a la filosofía del
  proyecto, no hace falta detenerse. Tú tienes el mando, la filosofía manda siempre».
- **L2** — v1 (`83677b4`) proposed a per-segment `-C` prefix; both blind judges returned **NO SHIP**.
  Judge B: it drops the importer directory and writes the root manifest, the quoting is unspecified, the
  grammar enumerates refusals instead of allowing values, and it silently deletes the two-segment
  `pnpm install --lockfile-only && funky-secure scan …` line. Judge A measured `error: the argument
  '--dir <DIR>' cannot be used multiple times` (rc 2), that `spellAtRoot` returning nothing prints `→
  null`, and that the four records of S6 say the spelling follows the name alone. The redesign was
  withdrawn, not repaired.
- **L3** — v2 (`3b80e05`) claimed the position unreachable; judge B returned one CRITICAL: S1's "by
  construction" contradicted S2's alias residual, and T1's first assertion could not fail for its own
  reason (deleting root resolution leaves `root === cwd`, which still passes). v3 drops the absolute
  claim, names the residual as unmeasured, and moves the tripwire to the input surface.
- **L4** — measured while writing v3: `subst` reports no mapping and `M:` is a fixed drive, so the owner's
  own case is not an alias. The `subst Z:` experiment did not run (the fixture commit was refused by an
  identity guard), so the alias residual stays unmeasured — which is why it is a limit and not a claim.
- **L5** — judge A's measurements kept as evidence: `cd /d` works in `cmd` (rc 0, right drive);
  `bash -c 'cd /d "M:/…"'` → `cd: too many arguments`, rc 1; `dash -c 'cd /d "M:/…"'` → rc 0 in `/d`
  (silent, so v1's evidence was wrong); an accented root needs `chcp 65001` in a batch file and `call`
  before `pnpm`.

## Judged

| Checkpoint | State | Evidence |
| --- | --- | --- |
| `J1` — the plan, before any source write | **done, twice refuted** | v1 `83677b4` by `jd-judge-a` and `jd-judge-b` (both NO SHIP, L2); v2 `3b80e05` by `jd-judge-b` (one CRITICAL, L3). v3 is written from both verdicts and is not re-judged: two rounds are the limit. |
| `J2` — the commit that touches `docs/` | pending | the docs PR (T4) and the code PR (T1-T3) each quote a number and touch `docs/`, so both carry a round. |
| `J3` — every `T*` landed | pending | after T1-T4 |
