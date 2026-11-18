# Didactic guide — a path from zero to the seven commands

A learning path under `docs/learn/`, English like the rest of `docs/`, for a reader who has never opened a
terminal. Every command gets one page answering the same six questions, and one of them is the question no
existing page answers: **when not to use it**. Issue #460.

## Specs

- **S1** — the audience is a reader who has never opened a terminal. The owner's words: «La idea es que cualquier
  persona e incluso niños pequeños puedan adentrarse a este mundo». A literal child was considered and rejected
  in `L2`: the tool cannot be operated by one, and writing as if it could would put fiction inside the repository
  whose stated failure mode is a sentence that is not true.
- **S2** — each command answers six questions in one fixed order: «qué es cada comando, para que se usa, cuando
  se usa, cual es su funcion, cuando no es necesario usarlo y está de mas». Questions 1 and 4 of the owner's list
  collapse into one (what it is, what it is for); the six are: the question it answers · what it does and writes ·
  when you use it · **when you do not, and when it is superfluous** · what you will see · what you do next.
- **S3** — «lo manejamos en formato de docs con indices, secciones, etc». An index and sections, but the index
  reads as a **path**, not an A–Z reference: a reader who does not know that `pin` exists cannot look it up.
- **S4** — English. `docs/cli.md`, `docs/guide.md` and the thirteen rule pages are English, and the repository's
  own gate compares text with text.
- **S5** — every capture is pasted from a real run, never typed from memory. `docs/README.md` states this as habit
  2 and the field loop paid for it twice.
- **S6** — every command the CLI dispatches has exactly one page, and a gate in `node --test` fails otherwise.
  Today the CLI dispatches **seven**: `start`, `scan`, `init`, `pin`, `migrate`, `explain`, `skill`.
- **S7** — "when not" is grounded in the CLI's own data: whether it is read-only or writes, its exit codes, its
  refusals. Not taste, and not a synonym for "rarely".
- **S8** — the path has a destination: a reader who reaches the end can run this tool on their own repository
  without reading anything else.
- **S9** — no page restates `docs/cli.md` (the reference) or `docs/guide.md` (ten minutes for someone who already
  has a terminal); the path **links** to them. Measured, not assumed: these are the two pages it must not
  duplicate.
- **S10** — the thirteen rules are **stateless**: each is a pure function of the repository's state, no rule reads
  another rule's result, and no run remembers the previous one. The page that explains the rules says this,
  because it is the fact that explains the report's shape — thirteen independent answers in one pass.
- **S11** — the repository already fails `node --test` when "a command [has] no section in `docs/cli.md`, no flow
  in `architecture.md`, or no row in the README" (`docs/README.md`, *What already fails the build*). The new gate
  is the same class, extended to this tree, not a new mechanism.

## Tasks

| ID | Task | Spec | Route | Commit |
|---|---|---|---|---|
| T0 | This plan, judged at `J1` before any page is written | S1–S11 | `PAIR` | — |
| T1 | `docs/learn/README.md` — the path: where you are, what comes next, one map | S3, S8 | inline | — |
| T2 | `docs/learn/00-the-problem.md` — the problem in plain words, no terminal yet | S1 | inline | — |
| T3 | `docs/learn/01-your-first-command.md` — open a terminal, run one command, see the output | S1, S5 | inline | — |
| T4 | `docs/learn/02-reading-the-output.md` — what it is telling you, and why it has that shape | S1, S10 | inline | — |
| T5 | `docs/learn/03-why-the-rules-exist.md` — thirteen rules by consequence, each independent | S10 | inline | — |
| T6 | `docs/learn/commands/<name>.md` — seven pages, the six questions in the same order | S2, S6, S7 | inline | — |
| T7 | `docs/learn/04-when-not-to-use-it.md` — the whole decision in one table | S2, S7 | inline | — |
| T8 | `docs/learn/05-glossary.md` — one term, one line | S1 | inline | — |
| T9 | the gate: every dispatched command has a page with all six headings; `docs/README.md` gains its row | S6, S11 | inline | — |
| T10 | `J2` on each pull request, `J3` before the close | S5, S8 | `PAIR`/`SINGLE` | — |

**Slices** (~400 authored lines each, one pull request each, all `Closes #460` except the last three which say
`Refs #460`):

- **P1** — T1, T2, T3: the beginning, which fixes voice and the page shape.
- **P2** — T4, T5.
- **P3** — T6 and T9 together: the seven pages and the gate that keeps them honest ship as one unit.
- **P4** — T7, T8, the map row, and the close.

**Route: inline.** Not a worker per page: the product is one voice across ten pages, and a writer per page drifts.
The writer rule's trigger (independent units heavier than a subagent start) does not fire on prose that must sound
like itself.

## Risks

`Risk: item 6` — the gate can verify that a page exists and has six headings; it cannot verify that the sentence
under heading 4 is **true**. Mitigation, per page and not in the aggregate: every claim about writing, exit codes
or refusal is run before it is written, and the capture is pasted from that run (S5). Pages that make no such
claim carry no capture.

## Log

**L1** — the owner's request, verbatim:

> continuemos con la feature didactica. La idea es que cualquier persona e incluso niños pequeños puedan
> adentrarse a este mundo. Cuál es tu plan, lo manejamos en formato de docs con indices, secciones, etc, o qué
> recomiendas?

and, before compacting:

> la idea es hacer unos docs que sirvan de modo didactico, para que cualquier persona pueda entender qué es cada
> comando, para que se usa, cuando se usa, cual es su funcion, cuando no es necesario usarlo y está de mas.

**L2** — two decisions taken with the owner, in one question set: **English** (the repository's convention, and
the gate compares text with text) and **a reader who has never opened a terminal** (not a literal child: the tool
cannot be operated by one, and the repository's stated failure mode is a sentence that is not true).

**L3** — the owner's correction while the issue was being written: «son 13 reglas stateless». Recorded as S10,
and it changes the page in T4 and T5 rather than only T5: the report reads as thirteen independent answers, not as
a pipeline of checks.
