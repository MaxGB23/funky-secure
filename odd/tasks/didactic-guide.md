# Didactic guide — a path from zero to the seven commands

A learning path under `docs/learn/`, English like the rest of `docs/`, for a reader who has never opened a
terminal. Fifteen files: an index, seven concepts, seven command pages. Issue #460 is the umbrella; each slice
carries its own issue and closes it.

Judged at `J1` before any page was written: `PAIR`, frozen at `84bfdb5` (93 lines). Both verdicts are in
`L4`/`L5`; what they refuted is in `L6`, and the specs below are the survivors.

## Specs

- **S1** — the audience is a reader who has never opened a terminal, and **every task binds to it**, not only the
  prose ones. The owner's words: «La idea es que cualquier persona e incluso niños pequeños puedan adentrarse a
  este mundo», narrowed by the owner's own selection of *"a reader who has never opened a terminal"* (recorded
  verbatim in `L3`). Consequences: `01-before-you-start.md` exists because the audience cannot open a terminal by
  being told to (a judge's `Q8`: nothing in the first plan got the reader a terminal, Node or the tool); and the
  six GitHub-Actions rules are introduced through what an attacker does with a workflow, not through trigger
  syntax.
- **S2** — each command answers six questions in one fixed order. Four are the owner's (questions 1 and 4 of the
  owner's five collapse: *what it is* and *what it is for* are one answer); **two are added by this plan and
  labelled as such**: *what you will see* (because a reference page shows a contract and a beginner needs a
  picture) and *what you do next* (because the path has a destination, S8). Provenance is stated so no page has to
  guess why the list has six.
- **S3** — «lo manejamos en formato de docs con indices, secciones, etc». An index and sections, but the index
  reads as a **path**, not an A–Z reference: a reader who does not know that `pin` exists cannot look it up.
- **S4** — English. `docs/cli.md`, `docs/guide.md` and the thirteen rule pages are English, and the repository's
  own gate compares text with text.
- **S5** — every capture is pasted from a real run, never typed from memory.
- **S6** — every command the CLI dispatches has exactly one page, and the gate checks **four** things, because
  presence alone is vacuous (a judge's `Q3`): the page exists · its six headings appear **in order** · no heading
  is empty · no page names a command the CLI does not dispatch. Today the CLI dispatches **seven**: `start`,
  `scan`, `init`, `pin`, `migrate`, `explain`, `skill` (measured: `COMMANDS.length` → 7).
- **S7** — "when not" is grounded in what the tool itself does, in four forms: it is read-only or writes · its exit
  codes · its refusals · **what it duplicates** (the report already carries `doc: funky-secure explain <rule>`, so
  `explain` is superfluous when you have the finding in front of you). Where the honest answer is a fact about
  the reader's situation rather than about the tool — `skill` is the case, and a judge's `Q2` found it — the page
  **says so and names the fact** instead of inventing tool data.
- **S8** — the path has a destination: a reader who reaches the end can run this tool on their own repository
  without reading anything else. `01-before-you-start.md` is what makes that true.
- **S9** — no page restates **three** sources: `docs/cli.md` (the reference), `docs/guide.md` (ten minutes, and
  already a line-by-line walk of the report at `:23-129` plus a twelve-of-thirteen rule table at `:194-213`), and
  `docs/rules/` (1618 lines, the rules' own pages). The first plan named two and a judge found the third, the
  largest. Each page states, in one line, **what it adds that those three do not have**, and non-duplication is
  checked by `J2` on the diff — no mechanical gate can check a paraphrase.
- **S10** — the thirteen rules are **independent**: none reads another's result, and no run remembers the previous
  one. Two corrections the judges forced, both of which change the page's sentences: they are pure functions of
  the **resolved context** — repository **and machine** **and policy** — because `quarantine` and
  `package-manager-pin` read `ctx.machine`; and the report's order has **two** causes, independence **and** catalog
  order, which is public contract (`src/rules/index.js:1-4`). And one fact that would have been wrong to teach:
  the **write plan is not independent** — `src/lib/writers.js` chains on `sensitive-ignored`'s and
  `package-manager-pin`'s findings. Independence is a property of the scan, not of the tool.
- **S11** — the repository already fails `node --test` when a command has no section in `docs/cli.md`, no flow in
  `architecture.md`, or no row in the README (`docs/README.md`, *What already fails the build*). The new gate is
  the same class, extended to this tree, not a new mechanism.

## Tasks

| ID | Task | Spec | Route | Commit |
|---|---|---|---|---|
| T0 | This plan, judged at `J1` | S1–S11 | `PAIR` | `84bfdb5` |
| T1 | `docs/learn/README.md` — the path: where you are, what comes next | S3, S8 | inline | — |
| T2 | `docs/learn/00-the-problem.md` — the problem in plain words, no terminal yet | S1 | inline | — |
| T3 | `docs/learn/01-before-you-start.md` — terminal, Node ≥22, git, where pnpm comes from, and `command not found` | S1, S8 | inline | — |
| T4 | `docs/learn/02-your-first-command.md` — run `start`, read what it says | S1, S5 | inline | — |
| T5 | `docs/learn/03-reading-the-output.md` — **why** the report has that shape (independence + catalog order); the field anatomy stays in `guide.md` | S9, S10 | inline | — |
| T6 | `docs/learn/04-why-the-rules-exist.md` — the attack each rule answers, per-rule **links**, no consequence table | S9, S10 | inline | — |
| T7 | `docs/learn/commands/<name>.md` — seven pages, six questions | S2, S6, S7 | inline | — |
| T8 | `docs/learn/05-when-not-to-use-it.md` — the whole decision in one table | S2, S7 | inline | — |
| T9 | `docs/learn/05-glossary.md` — one term, one line | S1 | inline | — |
| T10 | the gate (four checks, S6); `docs/README.md` and `AGENTS.md` rows; the `package.json` `files` decision — `docs/learn/` ships or it does not, and the plan decides **it ships** | S6, S11 | inline | — |
| T11 | `J2` on every slice, `J3` before the close | S5, S9 | `PAIR`/`SINGLE` | — |

**Slices** — five, ceiling ~450 authored lines each; a slice opens its own issue and closes it (`Refs #460`), and
the umbrella closes with the last one. The first plan sliced four times at "~400" and a judge measured the seven
command pages alone at 420–910 (`Q6`).

- **P1** — T1, T2, T3: the beginning, which fixes voice and page shape.
- **P2** — T4, T5.
- **P3** — T10's gate plus T7's first four pages (`start`, `scan`, `init`, `pin`).
- **P4** — T7's remaining three (`migrate`, `explain`, `skill`).
- **P5** — T6, T8, T9, and the rows that make the tree findable.

**Route: inline.** The product is one voice across fifteen pages; a writer per page drifts. The writer rule's
trigger does not fire on prose that must sound like itself.

## Risks

`Risk: item 6` — the gate can verify structure; it cannot verify that the sentence under heading 4 is **true**, and
a paraphrase can cite the right page and still be wrong. Two mitigations, neither in the aggregate: every claim
about writing, exit codes or refusal is run before it is written and its capture pasted from that run (S5); and
`J2` reads each slice's diff for restatement of the three sources (S9).

## Log

**L1** — the owner's request, verbatim:

> continuemos con la feature didactica. La idea es que cualquier persona e incluso niños pequeños puedan
> adentrarse a este mundo. Cuál es tu plan, lo manejamos en formato de docs con indices, secciones, etc, o qué
> recomiendas?

and, before compacting:

> la idea es hacer unos docs que sirvan de modo didactico, para que cualquier persona pueda entender qué es cada
> comando, para que se usa, cuando se usa, cual es su funcion, cuando no es necesario usarlo y está de mas.

**L2** — two decisions put to the owner as one question set and answered by selection: **English** (the
repository's convention, and the gate compares text with text) and **a reader who has never opened a terminal**.
The first plan recorded this as "decisions taken with the owner" with no owner statement in the artifact; two
judges marked it, and `L3` records the exact selections.

**L3** — the owner's selections, verbatim from the question set: *"Inglés, como el resto de docs/"* and *"Nunca
abrió una terminal"*. And the owner's correction while the issue was being written: «son 13 reglas stateless» —
recorded as S10, and it changes the page in T5 **and** T6, not only the latter.

**L4** — `+VERIFY`, run by the parent before the round, recorded after it (never during: a file that changes while
a judge reads it destroys the round, which happened once in this repository and is the reason this note exists):

| Claim | Command | Result |
|---|---|---|
| seven commands | `node -e "import('./src/cli.js').then(m=>console.log(m.COMMANDS.length, m.COMMANDS.map(c=>c.name)))"` | `7 -> start,scan,init,pin,migrate,explain,skill` |
| thirteen rules | `ls docs/rules/*.md \| wc -l` | `13` |
| no rule imports another | `grep -rn "from './" src/rules/*.js` | only `src/rules/index.js` imports rule modules |
| the `docs/README.md` quote | `grep -c "no section in ..."` | `1` |

**L5** — what `+VERIFY` did **not** establish, found by a judge and corrected here: the third row proves the rules
do not import each other; it says nothing about purity, and two rules read `ctx.machine` (`quarantine`,
`package-manager-pin`). The plan's S10 said "state of the repository" — my check was narrower than my sentence, and
the sentence would have been taught. Corrected in S10.

**L6** — adjudication of `J1`. Two judges, eight questions each, no disagreement in substance; three findings
decided the plan's shape:

- **The audience failed at page three.** Both judges: nothing in the first plan got the reader a terminal, Node or
  the tool, and `01-your-first-command` presupposed all three in one imperative. → `01-before-you-start.md` is now
  T3, before the first command, and S1 binds every task instead of four.
- **The "stateless" sentence destined for the pages was false as written.** It described the *scan* (true) and
  called it a property of the tool (false: the write plan chains on findings), and it located the cause of the
  report's shape in independence alone when catalog order is the other half. → S10, and T5/T6 rewritten around it.
- **The slice was understated by 1.5–2.5×.** Measured precedents: 124 lines per rule page, 346 for the existing
  docs contract test, 38 for a real scan capture. → five slices with a ~450 ceiling, and the arithmetic in the
  task table instead of a round number.

Also accepted, each with the fix it forces: `explain` cannot be grounded by the three original forms and `skill`
cannot be grounded at all (→ S7's fourth form and its honest case); "six headings present" is vacuous and S6 also
asked for "exactly one page" that T9 did not check (→ S6's four checks); S9 omitted `docs/rules/`, the largest
overlap target, and `docs/guide.md` already carries twelve of thirteen rules and a full walk of the report (→ S9
names three sources, T5/T6 are concepts-only with links, and `J2` verifies non-duplication on the diff); "ten
pages" against fourteen files and a README row routed twice (→ fifteen files, one owner per row); and three of four
pull requests would have said `Refs` where `CONTRIBUTING.md:41` requires every pull request to close an issue
(→ one issue per slice).

**Refuted by neither judge, and kept as written**: the seven-command count, S11's description of the existing gate,
and "no rule reads another rule's result".

**Found outside the plan, filed separately**: `src/cli.js:2` says *"six commands"* and the CLI dispatches seven —
a false sentence in the source, independent of this feature, with its own issue and its own pull request.
