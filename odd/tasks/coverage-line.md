# The coverage line: make the number match the label, and say why

The header's coverage line reads `not run  6 of 13 rules; off by policy: …` and then names **seven** rules.
`6 + 7 = 13`, so the number counts the rules that **ran** under a label that says they did not. `docs/spec/report.md`
§10.3 defines the number as "how many catalog rules still run", so the renderer matches the spec and **the label is
the surface that lies**.

A real round found it (`docs/validation.md`, "The round at `0.13.0`"): the owner's agent ran `start` on an
npm-leaving and a pnpm-leaving project, every step exit `0`, both scans PASS — and the line it read is the one that
says how much was not looked at. It suggests a smaller hole than there is.

## Specs

- **S1** — **the label stays `not run`, and the number changes to match it.** `7 of 13`, not `6`. The first plan
  proposed renaming the label to `coverage`; two judges refuted it: the number is `policy.active.length`, and active
  rules can still be `not verified` in the same header (`scan --scope machine --preset starter` answers one rule and
  prints `5 rules not verified`), so `coverage 6 of 13` beside `not verified` would contradict itself. `7` needs no
  new word, matches the label's meaning, and is the arithmetic the round's reader arrived at unaided.
- **S2** — the line gains **one continuation stating the lever**: the preset this run used switched those rules off,
  and `--preset strict` runs all thirteen. It must name the cause in plain words (a policy decision, not a skip and
  not a missing rule), name the flag a reader can type, and claim nothing else. The report names the preset in
  `provenance`, three lines above and four when it wraps; `start` prints the same block from the same helper and
  names the preset only in its last step, so the continuation must stand on its own.
- **S3** — the change is **not cosmetic**, and the surface list is the one the judges measured, not the one the first
  plan guessed:
  - `src/lib/render-human.js` — `notRunLines` and the count; **one helper, two commands** (`scan` and `start`).
  - six test files assert the literal or its count: `tests/report.test.js` (`NOT_RUN` constant, the block finder, two
    guards that would go silently vacuous), `tests/invariants.test.js`, `tests/start.test.js`,
    `tests/rules/lockfile-committed.test.js`, `tests/rules/package-manager-pin.test.js`.
  - `docs/spec/report.md` §10.2 **and** §10.3, `docs/spec/commands.md` 11.7 (`start` prints the same block),
    `docs/spec/README.md`'s amendments registry, and a dated `## Errata` in `rfcs/0003-first-ten-minutes`, which
    names the label and exemplifies `6 of 12` — a settled record is corrected by errata, never by editing.
  - `docs/decisions.md` gains a **new** row; `I-29`/`I-30`/`I-32` are append-only.
  - `docs/cli.md`, `docs/guide.md`, `docs/architecture.md`, `docs/rules/quarantine.md`, the two learn pages that paste
    the line (`02-your-first-command`, `commands/start`), and `skills/funky-secure/SKILL.md`'s "report that line
    verbatim".
- **S4** — **the verification must be able to fail.** The first plan's "regenerate the goldens and diff" cannot:
  goldens are JSON (`renderJson`) and the line is human-only. The checks that can fail: the six test files, red before
  and green after; the same `scan --preset starter` run before and after, with both outputs pasted; and
  `node scripts/pack-guard.js` for the surfaces that ship.
- **S5** — `docs/validation.md`'s round is **corrected, not re-read**. Two things: the sentence claiming all seven
  `off by policy` rules are CI rules is **false** (`Environment files` is a `repo-root` rule the starter preset turns
  off) — already fixed; and the record keeps its own judgement, *"and it is not cosmetic"*, which the first plan
  would have reversed. The section gains the issue number (#498) and keeps saying the flow was clean.
- **S6** — the no-workflows case is **run**, not asserted: `scan --preset starter` in a fixture with no
  `.github/workflows/`, before and after, with the two outputs pasted into the record. The first plan said "check it
  first" and assigned no task that runs anything.

## Tasks

| ID | Task | Spec | Route |
|---|---|---|---|
| T0 | This plan, judged at `J1` | S1–S6 | `PAIR` |
| T1 | spec: `report.md` §10.2/§10.3, `commands.md` 11.7, the amendments registry, `rfcs/0003` errata | S1–S3 | inline |
| T2 | renderer: the count and the continuation | S1, S2 | inline |
| T3 | the six test files, red then green | S3, S4 | inline |
| T4 | the docs surfaces, the decisions row, the validation correction | S3, S5 | inline |
| T5 | the two runs pasted (starter with and without workflows) | S4, S6 | inline |
| T6 | `J2` on the diff | S4 | `SINGLE` |

**Slices**: two. The spec alone first (T1) — and it must state the label, the number and the sentence, because the
example it carries is a capture and a capture is pasted from a run that does not exist until T2. The example's number
is arithmetic (`13 − 7 = 6` active, so `7 of 13` not run) and the seven names do not move, so the spec's own example
changes by one digit and stays true.

## Risks

`Risk: item 3` — the header is a consumed surface. The JSON document does not carry the line (`docs/spec/report.md`
§10.2), so no machine contract moves; the human text is what every capture in `docs/` restates, and the line is also
printed by `start`. Mitigation: the six test files assert the literal, so a miss is red rather than silent, and the
two commands are checked by running both.

## Log

**L1** — the owner's request, verbatim:

> soluciona todo. Usa jueces para lo que se requiera. Cuando esté solucionado, adapta los docs de validation.md de mi
> testeo real, para que reflejen la realidad del off policy, ya que lo importante era el flujo de npm y pnpm y todo
> fue PASS perfecto, flujo impecable

and, from the round itself: *"Dice 6 y lista 7 nombres … El número correcto es 7 de 13"*, with the owner's reading
that `off by policy` is "honestidad, no pereza" — the line is right to exist, the label is what misleads.

**L2** — `J1`, two blind judges. **Both refuted the first plan**, and they agree on every load-bearing point:

- **the label rename overclaims** (A) and is unnecessary inside the gutter's nine-character geometry (B): the number
  is the count of rules the policy left **on**, and a run can leave active rules `not verified`, so `coverage 6 of
  13` beside `not verified` contradicts itself. **Keeping `not run` and printing `7`** needs no new word and is what
  the round's reader already computed.
- **the surface list was wrong**: five test files and a shared helper that `start` also calls, `§10.2`, `commands.md`
  11.7, the amendments registry, three decisions rows, and `rfcs/0003` — a settled record that names the label, which
  requires **errata**. The first plan named none of them and counted "seven learn pages" where the repository has
  two that paste the line.
- **the stated verification could not fail**: goldens are JSON and the line is human-only.
- **S5's premise was false**: `docs/validation.md` already says the round found "no false sentence, no broken
  command, no dirty tree"; and the plan would have reversed the record's own *"and it is not cosmetic"*.
- **a false premise of my own**: "the preset named two lines above in `provenance`" — it is three, four when it
  wraps, and `start` prints no provenance line at all.
- **one false sentence already merged** in the round's record: *"all seven `off by policy` rules are CI rules"* —
  `env-not-tracked` targets `repo-root` and the starter preset turns it off. Corrected in the same branch that
  carried it.

What survived: the diagnosis (`6 + 7 = 13` under a label that says otherwise), the spec's own words defining the
number, and the round as evidence.

- **L3** — the line shipped as S2 wrote it, and a diff judge refuted the continuation: `--preset strict runs all
  thirteen` is false whenever the repository's own config turns a rule `off`, because that map wins under every
  preset (I-30) — the run is strict and still prints `1 of 13`. **S2's last clause is superseded**: the
  continuation now reads `--preset strict turns none off by itself`, which names the lever and its limit, and a
  test covers config-off under strict. A second judge then found the evidence page contradicting itself (the
  reproduction capture carried the corrected bytes under a sentence calling them false), `I-86`'s "never" too
  strong for a rule declaring `strict: 'off'`, and two reflow stubs; all corrected. Recorded in `I-86` and the
  dated errata in `rfcs/0003`.

- **L4** — the continuation gained its **why** (issue #514). Two judges refuted the two designs before it: deriving the
  cause from the preset name is false because a config can turn a rule off *under* `starter`, and enumerating what the
  rules read ("CI, bot or environment files") is false for `ci-no-safety-overrides`, which reads the root `.npmrc` — a
  `repo-root` target, not a CI file. What shipped classifies **per rule** (`off ∩ policy.overridden` is the config's,
  the rest the preset's) and prints one of three clauses. `start` re-resolves with no config, so its block is always
  the preset's, which is the caller the owner needed it for.
