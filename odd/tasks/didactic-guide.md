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
- **S2** — each command answers six questions in one fixed order, and the six are **written here as literal heading
  strings**, because a gate that checks "the six headings in order" against prose cannot be written (a judge's
  `C3`). Four are the owner's, with questions 1 and 4 of the owner's five collapsed into one; two are added by
  this plan and labelled as such:

  1. `## What it answers` — the owner's *what it is* and *what it is for*, one answer
  2. `## What it does` — the owner's *su función*: what it reads, what it writes, what it refuses
  3. `## When you use it` — the owner's *cuándo se usa*
  4. `## When it is superfluous` — the owner's *cuándo no es necesario usarlo y está de más*
  5. `## What you will see` — **added by this plan**: a reference page shows a contract, a beginner needs a picture
  6. `## What you do next` — **added by this plan**: the path has a destination (S8)

  Every page also carries a line beginning `**Adds:**` - defined once, in S9 - and that label is mechanical
  (S6 check 5).
- **S3** — «lo manejamos en formato de docs con indices, secciones, etc». An index and sections, but the index
  reads as a **path**, not an A–Z reference: a reader who does not know that `pin` exists cannot look it up.
- **S4** — English. `docs/cli.md`, `docs/guide.md` and the thirteen rule pages are English, and the repository's
  own gate compares text with text.
- **S5** — every capture is pasted from a real run, never typed from memory.
- **S6** — every command the CLI dispatches has **exactly one** page, and the gate checks six things. Presence
  alone is vacuous (both judges), and the sixth check exists because the first five can all pass on a page that
  teaches nothing:

  1. the page exists, **one per dispatched command and none extra** (`commands/<name>.md`, name ∈ `COMMANDS`);
  2. the six literal headings of S2 appear **in order**;
  3. each heading is followed by at least one paragraph of 40 characters or more — a proxy, and named as one;
  4. no page mentions `funky-secure <token>` where `token` is neither a command in `COMMANDS` nor a global flag
     (`--help`, `--version`, which `docs/cli.md` documents for every command — a judge's `JD-A-012`);
  5. every page carries the `**Adds:**` line of S9;
  6. the rules page links **thirteen** rule ids, asserted against the catalog — `docs/guide.md` carries twelve of
     thirteen today and no check notices, so the page most likely to reproduce that defect is the first to be
     gated.

  Today the CLI dispatches **seven**: `start`, `scan`, `init`, `pin`, `migrate`, `explain`, `skill` (measured:
  `COMMANDS.length` → 7). What no check can do is decide that a paragraph is **true**; that is `J2`'s reading, and
  the plan says so rather than pretending the gate covers it.
- **S7** — "when not" is grounded in what the tool itself does, in four forms: it is read-only or writes · its exit
  codes · its refusals · **what another artifact already prints**. The fourth form is `explain`: it reads no
  repository and prints the same catalog `--help` prints, in a different layout, and the same content `docs/rules/<id>.md` already holds. The first draft grounded it on the report carrying
  `doc: funky-secure explain <rule>`, and both judges refuted the inference: that field exists only in `--format json`,
  the human report hides even the rule id, and the field points **at** `explain` rather than duplicating it. Where
  the honest answer is a fact about the reader's situation rather than about the tool — `skill` is the case, and a
  judge's `Q2` found it — the page **says so and names the fact** instead of inventing tool data.
- **S8** — the path has a destination: a reader who reaches the end can run this tool on their own repository
  without reading anything else. `01-before-you-start.md` is what makes that true.
- **S9** — no page restates **three** sources: `docs/cli.md` (the reference), `docs/guide.md` (ten minutes, and
  already a line-by-line walk of the report at `:23-129` plus a twelve-of-thirteen rule table at `:194-213`), and
  `docs/rules/` (1618 lines, the rules' own pages). The first plan named two and a judge found the third, the
  largest. Each page ends with a line beginning `**Adds:**` that names, in one sentence, what the page has that
  those three do not — presence of the line is checked by the gate (S6 check 5), and its **truth** only by `J2` on
  the diff. No mechanical gate can check a paraphrase, and two judges were right that the line is a slogan until a
  judge reads it.
- **S10** — the thirteen rules are **independent**: none reads another's answer, and no run remembers the previous
  one. Three corrections the judges forced, each of which changes a sentence a page would have taught:
  - They decide from the **resolved context** — repository facts, plus **machine** facts for the two rules that need
    them (`quarantine`, `package-manager-pin`). The engine applies severity and activation **before** any rule runs;
    the policy is a **separate argument**, and exactly one rule reads it inside `detect`. Calling the policy part of
    the context was wrong, and a stale comment in `quarantine.js` says the engine does not pass it at all.
  - The report's order has **two** causes: independence **and** catalog order, which is public contract
    (`src/rules/index.js:1-4`). Independence alone does not explain a deliberately non-alphabetical list.
  - The **write plan is not independent**: it chains on `sensitive-ignored`'s and `package-manager-pin`'s findings
    (`src/lib/writers.js:904-926`). Independence is a property of the scan, not of the tool.
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
| T6 | `docs/learn/04-why-the-rules-exist.md` — the attack each rule answers, thirteen **rule links**, no consequence table | S9, S10 | inline | — |
| T7 | `docs/learn/commands/<name>.md` — seven pages, six questions | S2, S6, S7 | inline | — |
| T8 | `docs/learn/05-when-not-to-use-it.md` — the whole decision in one table | S2, S7 | inline | — |
| T9 | `docs/learn/06-glossary.md` — one term, one line | S1 | inline | — |
| T10 | the gate (six checks, S6); `docs/README.md` and `AGENTS.md` rows; the `package.json` `files` decision — `docs/learn/` ships or it does not, and the plan decides **it ships** | S6, S11 | inline | — |
| T11 | `J2` on every slice, `J3` before the close | S5, S9 | `PAIR`/`SINGLE` | — |

**Slices** — five, ceiling ~450 authored lines each. Every slice's body carries `Closes #<its own issue>` **and**
`Refs #460`; P5 adds `Closes #460`, because `CONTRIBUTING.md:41` requires every pull request to close an issue and
the mechanical gate accepts a bare `Refs` (a judge's `C7`). Two figures from the first draft are gone: "~400" was
understated — a judge measured the seven command pages alone at 420–910 — and the promised "arithmetic in the task
table" was never written there (see `L7`). Measured since: P1 landed at 386 authored lines across four commits.

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

**L7** — adjudication of the second round, on the corrections themselves. Both judges, eight questions each, and
between them **three claims of mine lost**, all three inside `L6` — the entry written to record measurements.

- **"38 for a real scan capture" (C2).** It does not reproduce, and both judges said so independently. The origin
  is traceable and embarrassing: a first-round verdict described the capture by its **line range**, `guide.md:27-64`
  — thirty-eight lines of *file*, not thirty-eight lines of output. I copied the span as if it were a length. Real
  captures measure 3, 26, 2, 14, 48 and 6; this repository's own `scan --scope repo` prints 18. **A number whose
  provenance is a line range is not a measurement.**
- **"the arithmetic in the task table" (C2).** There is no arithmetic in the task table, and there never was. The
  sentence described an intent as a fact about the artifact — the exact defect this project has now paid for six
  times.
- **"Refuted by neither judge, and kept as written: 'no rule reads another rule's result'" (C8).** The clause is
  true; the record called it **verified** on evidence that proves something else. `L4`'s grep (`from './`) proves
  rules do not *import* each other; a shared module or a report read through a helper would pass it. The wider sweep
  is recorded here so the claim has evidence at last: `grep -rn "^import\|require(\|import(" src/rules/*.js` shows
  no rule importing another, no `require(`, no dynamic `import(`; `detect` receives `ctx` and `{ policy, severity }`
  and the accumulator is never passed into the next rule (`src/lib/engine.js:21-31`); and the per-run probe cache is
  per run (`src/lib/probes.js:191`). True, now checked, and the difference between those two words is the whole
  point of `L5`.

What survived, at the line: `L5`'s self-correction (two rules read `ctx.machine`, inside `detect`, exhaustive) ·
`346` for `tests/docs-contract.test.js` · `124` as a **mean** with a 75–262 spread, not a typical page · twelve of
thirteen in `docs/guide.md` with `workflow-run-artifact` the hole · the `writers.js:904-926` chain · and
`CONTRIBUTING.md:41` with the mechanical gate accepting a bare `Refs`.

Fixed in the specs by this entry, not by rewriting `L6`: S2 writes the six headings **literally**, because a gate
cannot check prose (both judges); S6 grows to six checks and loses its claim to cover truth; S7's fourth grounding
form is replaced — the `doc:` inference was backwards and the field is JSON-only; S10 separates the resolved context
from the policy argument, which one rule of thirteen reads; and T6's rule links become gated, because the page most
likely to reproduce the twelve-of-thirteen defect was the only one no check would read.

**Outside the plan, three things this round found.** Issue #460's body still carried the refuted sentence and the
vacuous gate — every slice links it with `Refs`, so a reviewer would have read the old specification as the
specification: edited. And two comments in the source describe a previous version of the program — `src/cli.js:2`
says "six commands" where the CLI dispatches seven, and `src/rules/quarantine.js:12` says the engine does not pass
the policy, which it has since `1e08692`, eleven minutes before that comment was added: one issue, one pull request,
both lines.

**L8** — the feature closed. What landed, and the four places the plan was wrong about its own delivery.

| Slice | Issue | Pull request | Content |
|---|---|---|---|
| record | #465 | #466 | the plan, after two `J1` rounds |
| pages 00-01 | #461 | #467 | the index, the problem, the prerequisites |
| pages 02-03 | #468 | #469 | the first command, reading the output |
| three commands | #470 | #471 | `start`, `scan`, `init`, and a contract test narrowed by one line |
| four commands + gate | #475 | #476 | `pin`, `migrate`, `explain`, `skill`, and the five checks |
| closing pages + check 6 | #477 | #478 | rules, when-not, glossary, and the two map rows |
| spec | #479 | #480 | §14.1 names `docs/learn/`; decision I-84 |
| packaging | #481 | #482 | `files` and `PACKED_SET`, 68 files in 10 entries → **83 in 11** |

First, unrelated and found by a judge: `#463` / `#464`, the two source comments that described a previous version
of the program.

**Measured at the close**: fifteen pages (an index, seven of the path, seven of command), the gate at **6 pass**,
and the suite at **953 tests · 952 pass · 1 skip · 0 fail**. Zero pull requests left open.

**Four deviations, each with its reason.** They are the part of this entry worth reading, because the plan was
confident about a delivery that did not survive contact with the delivery itself.

- **The gate could not ship first.** The plan sliced P3 as "gate plus four pages". A gate that iterates `COMMANDS`
  fails on the three missing pages, so it cannot land until all seven exist — and a suite that is red on half its
  subject is a red suite waiting to be forgotten. The gate therefore shipped with the page that completed the set,
  and its RED was captured when nothing existed: five tests, zero passing, the first failure naming
  `docs/learn/commands/start.md`. Test-first was kept; the artifact order was not.
- **A test file in the working tree breaks delivery even when it is not committed.** `node --test` discovers by
  tree, not by git, so the gate made `open-pr` refuse a slice it had no business refusing. The cure was to move it
  aside until the pages existed, which is also the honest reading: an uncommitted test is a test that runs.
- **482 lines did not fit the delivery preflight.** It budgets **ten seconds** for the native assessment, and a
  candidate that size exceeds it. The cure was to halve the candidate — the record in one pull request, the prose in
  another — and never to raise the budget. A second consequence: a force-push would have rewritten the history the
  findings lived in, so the branch was rebuilt and the old pull request closed with its thread intact.
- **Shipping the directory was a spec change, not a chore.** Adding `docs/learn/` to `files` breaks a test that
  asserts the packed set equals §14.1, and §14.1 is normative. The plan called it T10, one line in the closing
  slice; it became two pull requests, the record first, because the repository's rule is that a behaviour change
  starts in `docs/spec/`.

**What the writing found, which the plan did not anticipate.** Two judges over the plan produced nothing like what
one judge over the diff produced: **sixteen findings, five critical**, all measured — PowerShell's missing-program
message is not `command not found`, `gi` is its alias for `Get-Item`, the pnpm paragraph duplicated `cli.md` clause
by clause, no page carried the `Adds:` line the gate makes mechanical, and the index promised not to restate the
page it shipped. The lesson belongs to the plan's own `Risk`: the gate can verify structure and never truth, and
truth is what a page written for a beginner gets wrong.

**And three product defects, filed rather than fixed here**: `#472` (the `pin` capture in `cli.md` is out of order),
`#473` (`start` promises four pins where `pin` writes three and refuses the fourth), `#474` (`migrate --from` says
"refusing" and exits `2`). A page must not be made true by a code fix, and a code fix must not hide in a docs pull
request.

**One instruction the pages carry that no judge could give them**: `05-when-not-to-use-it.md` closes the promise the
owner made in `L1`, that every command says when it is superfluous — seven rows, each grounded in an observed exit
code, a refusal, or what another command already prints.

**L9** — the closing judge, and what it found over a feature the record had already called closed. `J3` ran once,
read all fifteen pages in order as the declared reader, and answered eight questions. **Its numbers held**: eight
slices, the guest pull request, fifteen pages, six gate checks, `83` packed files in `11` entries, zero open pull
requests — each recomputed, none failed. The suite total it could not run and did not certify, which is the right
answer to a number nobody executed.

**Seven sentences were false, and all seven were mine.** One pull request, `#485`, and the two shapes worth keeping:

- **Two of them contradicted a capture pasted two pages earlier in the same path.** `commands/start.md` claimed the
  boot list prints `why this order` and ends on a scan; `02`'s own capture shows three steps, no such line, and a
  last step of `funky-secure start`. The path refuted itself without needing the program — the clearest evidence
  this feature produced that a page written from memory is not a page written from a run.
- **One was arithmetically impossible.** "Of the eight steps `start` can print, three begin with `pnpm` and four
  with `funky-secure`": `pnpm init` needs no manifest while the four `funky-secure` steps need one, so the two sets
  cannot both be full. Measured 8, 10 and 11 steps depending on the folder; at most two are `pnpm`.

The rest: an unlinked `Next:` (the path's promise is *read it in order*, and it broke at its one non-mechanical
step), a report symbol used before any page introduced it, `start`'s exit `2` described as flags-only when a
malformed `funky-secure.config.json` also produces it, `--fail-on none` called an identical report when the verdict
line names the threshold, a glossary with no link in the whole file repeating four facts from `cli.md` and
`rules/`, and a Commands row promising seven pages while linking one.

**What this puts on the record, and it is the feature's own conclusion**: the gate verifies structure and cannot
verify truth — `S6` said so before any page existed, and the closing round confirmed it from the other side. Truth
was found by running the program, every time: two judge rounds over the plan produced no false claim of this kind,
and one round over the pages produced seven.

**Closed.** Fifteen pages, six gate checks, suite `953 / 952 / 1 / 0`, `83` packed files in `11` entries, zero open
pull requests, and four product defects filed rather than absorbed (`#472`, `#473`, `#474`, and the two source
comments fixed in `#464`).

**Still open, and deliberately not in this feature** — `J3`'s three destinations, each a new feature when the owner
wants it: a **CI recipe** page (`05` sells itself with "before you put it in CI" and no page shows a workflow
file), a **truth gate** (fixed-string assertions over the claims this feature got wrong, so the sixth cannot ship
silently), and a **`--format json` / scripting** page (mentioned in three pages, never shown).
