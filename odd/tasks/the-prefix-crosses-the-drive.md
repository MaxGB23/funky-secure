# The prefix crosses the drive

The human report prefixes each printed command with `(cd "<root>" && <command>)` when the reader stands
below the repository root. Issue #549 measured that in `cmd` such a `cd` does not change drive: exit 0,
prompt unchanged, and the command runs in the wrong directory in silence. This record answers what the
code may do about it, and closes the two route/probe findings the approved review of #552 left open
(#553). It was refuted twice as a redesign; it now states what was measured instead.

## Specs

**S1. The measured defect is real, and the tool cannot reach it.**
From a prompt on `C:`, `cmd` reads `cd "M:\funky-secure-v2"` as a success, keeps `%CD%` on `C:`, and the
command after it runs in the wrong directory with exit 0 (measured, twice, independently). But `root` is
`git rev-parse --show-toplevel` run from the invocation directory (`src/lib/git.js:24-27`) or `cwd`
itself (`src/lib/targets.js:324-326`), the flag list is closed and carries no `--root`/`--cwd`/`--dir`
(`src/cli.js:57-88`), commands take no positional (`src/cli.js:234-239`), and no config key or
environment variable carries a root. So the only distance this tool renders is **`cwd` below `root`**, and
an ancestor is on the same volume by construction: no supported invocation puts a printed `cd` on another
drive.

**S2. The limit is pinned, not assumed.**
A test asserts that the rendered root is `cwd` or an ancestor of it, so a future flag, config key or
positional that lets a root be supplied breaks the suite instead of silently reaching S1's position. The
reachable residual is named in the record rather than worked around: an alias of the same directory
(`subst`, junction, UNC) that `sameDirectory` cannot fold, and a UNC root pasted into `cmd`, which
refuses loudly and stops the `&&` chain.

**S3. A refused spelling is better than a wrong directory, but only for a position that exists.**
The redesign is rejected on measurement, not on taste: `pnpm -C "<root>" -C packages/api pkg set …` is
`error: the argument '--dir <DIR>' cannot be used multiple times`, rc 2, because the pin already carries
the importer directory; the line `pnpm install --lockfile-only && funky-secure scan …` has a second
segment with no directory flag at all; `corepack` has none either; and a renderer that hands back nothing
prints `→ null` and `next null`, because neither print site guards the return
(`src/lib/render-human.js:202`, `:669`). A mechanism that composes with none of those is not a mechanism.

**S4. The probe fails when it measures nothing (R4-002, #553).**
`pinCommand` returning `null` for a fixture is currently skipped (`scripts/probe-remediation.js:315`,
`:333`), so a rule change that refuses the fixtures leaves the Windows leg green with no pin executed.
The probe reports a problem instead of skipping, and a test pins that both fixtures still produce a
command — the guard is only worth having if it can fail.

**S5. The refusal names the reason it refused (R2-002, #553).**
The prose route gives one shell-expansion reason for every refusal, but `pinCommand` also refuses values
outside npm's grammar, so a shell-safe but illegal name is told the wrong thing. The sentence names both
causes.

**S6. Four append-only records say the pin's spelling is chosen by the name.**
The code chooses by the name **and** the version (`!version.includes('*')`,
`src/rules/exact-versions.js:270-273`), and these still say otherwise: `rfcs/0042` line 54, the
amendment row in `docs/spec/README.md:122`, `docs/decisions.md:141` (I-96) and
`docs/rules/exact-versions.md:179`. Each is corrected the way this repository corrects a record: a dated
`## Errata` on the RFC (its body frozen), an `I-98` row that supersedes I-96's clause by number, and the
two present-tense pages edited in place.

**S7. `R4-004` is recorded, not fixed.**
`unsafeRoute` would print `edit /package.json` for `dir === ''`, and `frozenRoute`
(`src/rules/exact-versions.js:421`) repeats the same derivation. No caller can pass `''`: the root
importer is pushed as `'.'` (`src/lib/targets.js:362`) and workspace entries are cleaned to `'.'` or a
relative path. There is no public surface to test, so the finding is recorded here and the issue says so;
a change with no observable behaviour and no test is not a change this record makes. `R4-003` is
refuted outright: the scoped pin prints the bracketed spelling, so the Windows leg already executes both.

**S8. The evidence lands where the reader looks for it.**
`docs/validation.md` names the `runtime-claims-windows` job and the shells each leg executes;
`docs/cli.md` and §10.3 gain the limit sentence S2 pins; the four records of S6 are corrected.

## Tasks

**T1 — the reachability test.** A test that renders a report from below the root and asserts the rendered
root is `cwd` or an ancestor; a second assertion that the CLI rejects `--root`, `--cwd` and a positional.
RED first: the flag assertions fail today only if the flags were accepted, so the test states the closed
list positively and is observed to fail against a stubbed acceptance.

**T2 — the probe guard.** `probe()` reports a problem when a fixture yields no command; a test asserts
both fixtures produce one, so the guard cannot go vacuous.

**T3 — the refusal sentence.** Both causes named; the existing message assertions move with it.

**T4 — the docs PR.** §10.3's limit sentence, the amendment row, the 0041 errata, the 0042 errata, the
`I-98` row, `docs/rules/exact-versions.md`, `docs/validation.md`'s Windows leg. Append-only: no RFC body
is rewritten.

**T5 — reconcile the log below with the measurement worker's matrix when it lands.** The cells it
measured (`cd`, `cd /d`, `pushd`, `-C`, per shell and per root shape) are the evidence behind S1 and S3;
they are quoted here only once they arrive.

## Log

- **L1** — the owner's request, verbatim: «Crea el plan para solucionar lo que queda, revisa la memoria de
  engram. Evita trabajar de mas, cualquier cosa prioriza delegar para mantener contexto limpio. Explorers,
  workers, etc. Vuelve con el veredicto de jueces e implementa de una vez, sin detenerte, sólo puedes
  parar cuando haya una decisión muy crítica. Si tú la puedes responder en base a la filosofía del
  proyecto, no hace falta detenerse. Tú tienes el mando, la filosofía manda siempre».
- **L2** — v1 (commit `83677b4`, sha256 `943b79c5…`) proposed a per-segment `-C` prefix. Both blind judges
  returned **NO SHIP**: judge B found that it drops the importer directory and writes the root manifest,
  that the quoting was unspecified and the grammar enumerated refusals instead of allowing values, and
  that it silently deletes the two-segment `pnpm install --lockfile-only && funky-secure scan …` line;
  judge A measured `error: the argument '--dir <DIR>' cannot be used multiple times` (rc 2) for the
  composed flag, and added that `spellAtRoot` returning nothing prints `→ null` and `next null`.
- **L3** — reachability, traced twice independently (judge A's code read and an explorer's): no flag,
  positional, config key or environment variable supplies a root; `root` is `cwd` or an ancestor. The
  position #549 measures therefore cannot be produced by this tool, which is why the redesign was
  withdrawn rather than corrected.
- **L4** — judge A's corrections to v1's evidence, kept because they are measurements: `cd /d` works in
  `cmd` (rc 0, correct drive); `bash -c 'cd /d "M:/…"'` → `cd: too many arguments`, rc 1; `dash -c 'cd /d
  "M:/…"'` → **rc 0, lands in `/d`** (the third shell fails silently too, which v1 got wrong); `sh -c
  'pushd /tmp'` → rc 127 here; an accented root needs `chcp 65001` in a batch file, and `pnpm` inside a
  `.bat` needs `call`.
- **L5** — judge A's audit of the records: four append-only pages still say the spelling follows the name
  alone (S6). v1 named only the §8.2 R5 sentence.
