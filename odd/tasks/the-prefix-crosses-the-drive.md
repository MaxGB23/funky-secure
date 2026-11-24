# The prefix crosses the drive

A printed command is prefixed with `(cd "<root>" && <command>)` when the reader is not at the root. On
`cmd` that `cd` does not change drive: it exits 0, leaves the prompt where it was, and the command runs
in the wrong directory in silence (#549). The approved review of #552 left two route defects open as
advice as well (#553). This record fixes the prefix and those defects together, because both are about
the same thing: what a printed line is allowed to assume.

## Specs

**S1. The defect is the measured one, and nothing narrower.**
From a prompt on `C:`, `cmd` reads `cd "M:\funky-secure-v2"` as a success, keeps `%CD%` on `C:`, and the
command after it runs in the wrong directory with exit 0. `cd /d` fixes `cmd` and is not a directory to
`bash` (`cd: /d: No such file or directory`); `pushd` does not exist in `dash`. No `cd` spelling
measured so far works in `cmd`, `bash` and `sh`; a spelling that works in two of the three is not a fix,
it moves the defect.

**S2. A printed command works where it is pasted, measured cell by cell.**
The three shells the record names (`cmd`, `bash`, `sh`), from a directory on the same drive and on
another drive, against the root shapes this repository sees (a plain path, a path with spaces, an
accented path, a path carrying a shell metacharacter). Each cell is executed and its directory and exit
code recorded. A cell that was not executed is not a cell this record claims.

**S3. The shell is not asked to do what the tool can do.**
Where a tool accepts its own directory — `pnpm -C <dir>`, `git -C <dir>` — the printed command carries
that flag inside its own segment and no `cd` at all. A printed line is often two commands joined by `&&`
(`pnpm pkg set … && pnpm install`), so each segment carries the directory itself; a line whose segments
are not all commands of a tool with a directory flag is not printed (S5).

**S4. The root is a value with a grammar, like every other value in the line.**
The root is interpolated into a printed command, so it is measured the way names, versions and importer
directories already are (I-97): a root outside the set that is inert in all three shells prints no
command. Spaces and accents are inside it — the field round pasted them and they work; `"`, `$`, a
backtick, `%` and `!` are outside it.

**S5. No qualifying spelling means no command, and the route says so.**
A finding whose line cannot be printed takes the prose route already used for a refused name or version,
naming the manifest edit and the directory it applies to. `corepack` has no directory flag measured yet;
if T1 finds none, a `corepack` finding away from the root takes that route rather than a spelling that
would act on the wrong manifest.

**S6. The prose route names the importer's own manifest (R4-004, #553).**
The root importer is `package.json`. `unsafeRoute` treats only `undefined` and `'.'` as the root while
`pnpmAt` and `provablySafeDirectory` already treat `''` as the root too, so a root finding currently
reads `edit /package.json by hand`.

**S7. A green probe proves it ran (R4-002, R4-003, #553).**
The probe exits 0 only after executing at least one pin command of each spelling it claims, and the
Windows leg executes both the quote-free dotted and the escaped bracketed spelling under `cmd`. A probe
that skips both pins currently reports `ok: true`.

**S8. The evidence lands in the docs, with the cells.**
`docs/spec/report.md` §10.3, the amendment table, `docs/cli.md`, `docs/validation.md` and the §8.2 R5
sentence (the pin's spelling is chosen by the name **and** the version) carry what T1 measured. Docs
follow the code, never the reverse.

## Tasks

**T1 — the measurement matrix, no code.** Every distinct command line the report can print (enumerated
from the rule remediations and the goldens), the candidate spellings for each (`cd "<root>"`,
`cd /d "<root>"`, `pushd`, per-segment `-C <root>`), across `cmd`, `bash`, `sh`, `pwsh` 7 and Windows
PowerShell 5.1, from the same drive and from another drive, against the four root shapes of S2. Record,
per cell: the directory the command actually ran in, the exit code, and whether the command's own effect
was observed. No recommendation in the table; the numbers decide.

**T2 — the spec PR.** §10.3 rewritten clause by clause from T1's facts, the amendment row, the RFC 0041
errata (its body stays frozen), a decision row that supersedes nothing silently, and the R5 sentence.

**T3 — the code PR.** `spellAtRoot` prints the per-segment form for the tools that have one, applies the
root grammar, and hands back nothing when no spelling qualifies; the two print sites keep their single
spelling per report; the tests move with it and keep the never-wrap rule; the probe invariant gains the
root as a fourth value it checks.

**T4 — the advisory batch (#553).** `unsafeRoute` names `package.json` for `''`, the probe cannot exit 0
without a pin per spelling, and the Windows leg executes both spellings.

**T5 — the docs PR.** `docs/validation.md` names the Windows leg and carries the measured cells as
evidence of real-repository behaviour; `docs/cli.md` follows §10.3.

**T6 — the release.** Staged candidate, CI, the maintainer's 2FA — the owner's step, after T1–T5.

## Log

- **L1** — the owner's request, verbatim: «Crea el plan para solucionar lo que queda, revisa la memoria de
  engram. Evita trabajar de mas, cualquier cosa prioriza delegar para mantener contexto limpio. Explorers,
  workers, etc. Vuelve con el veredicto de jueces e implementa de una vez, sin detenerte, sólo puedes
  parar cuando haya una decisión muy crítica. Si tú la puedes responder en base a la filosofía del
  proyecto, no hace falta detenerse. Tú tienes el mando, la filosofía manda siempre».
- **L2** — facts carried from the explorer's map (`src/lib/render-human.js:89-97`, `:70`, `:94`, `:202`,
  `:669`; `src/rules/exact-versions.js:375-380`; `scripts/probe-remediation.js:315`, `:333`, `:345`;
  `.github/workflows/ci.yml:140-162`): the prefix wraps the whole line, the predicate reads the first
  token only, the route's `''` gap is real, and the probe's two pins are both guarded by `!== null`.
