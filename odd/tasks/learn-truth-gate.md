# Learn-path truth gate

The structural gate (`tests/didactic-guide.test.js`) checks that a page exists, has its six headings and links the
catalog. It cannot check that a sentence is **true**, and the closing judge proved that from the other side: two
rounds over the plan produced no false claim, one round over the pages produced **seven** — two of them
contradicted by a capture pasted two pages earlier. This adds the second half: a test that fails when one of those
seven comes back, or when the shape that let it in returns.

## Specs

- **S1** — the gate asserts **only claims this feature already got wrong**, and says so in its header. It is a
  regression gate, not a truth oracle: a new kind of error still needs a reader. Stating that limit is the
  difference between this and a promise nothing can keep.
- **S2** — two families, each with its own reason.
  - **Absence**: the exact sentence that was false must not reappear. A fixed string, the page it lived on, and the
    fact that replaced it. Five of the seven are this shape.
  - **Presence**: a fact a page must carry, where its absence is the defect. Two are this shape — both missing
    program spellings (`command not found` and PowerShell's `is not recognized`), because the page's whole
    diagnostic section is unusable for a Windows reader without the second.
- **S3** — the absence strings are the ones `#485` corrected, quoted from the record, not paraphrased:
  `the eight steps` arithmetic · the boot list's `why this order` · `is always the final line` · `the only nonzero
  code` · `got the identical report`.
- **S4** — presence checks are derivable from the repository, never from a run: fifteen pages exist · every `Next:`
  line in `docs/learn/` is a markdown link · `05`'s table has one row per dispatched command, each linking its page
  · `06-glossary.md` links `../cli.md` or `../rules/` at least three times · `01` carries both spellings.
- **S5** — **the gate is falsified before it is trusted.** Three of the seven defects are reintroduced by hand, the
  test is watched going red on each, and the page is restored. A gate that has never failed is a gate nobody has
  tested, and this feature's whole subject is sentences nobody checked.
- **S6** — no page changes to satisfy the gate unless the page is wrong. If an assertion cannot be written without
  editing prose, the assertion is dropped and the reason recorded.
- **S7** — the same shape as the existing gate: deterministic, reads files, writes none, spawns nothing, and its
  failure message names the page and the correction.

## Tasks

| ID | Task | Spec | Route | Commit |
|---|---|---|---|---|
| T0 | This plan, judged at `J1` | S1–S7 | `PAIR` | — |
| T1 | the absence family, five strings, one page each | S2, S3, S7 | inline | — |
| T2 | the presence family, five derivable facts | S2, S4, S7 | inline | — |
| T3 | falsify it: three defects reintroduced, three red runs, then restored | S5 | inline | — |
| T4 | `docs/testing.md` gains its row: what this gate proves and what it cannot | S1, S6 | inline | — |
| T5 | `J2` on the diff | S1 | `SINGLE` | — |

**Slices**: two. `P1` T1–T3 (the gate and its falsification, one file plus one page), `P2` T4 with the map row.
Both under 200 authored lines, so no slice arithmetic to argue.

**Route: inline.** One test file, one row, and a mutation round whose whole value is watching the exact assertion go
red — a worker would have to be handed the three defects and would report a colour I could not see.

## Risks

`Risk: item 6` — the gate can only catch what it names. A page that invents a **new** falsehood passes, exactly as
the seven did before they were found. `S1` puts that in the file's header where the next reader meets it, and `S5`
is the mitigation for the gate itself: an assertion that cannot be made to fail is decoration.

## Log

**L1** — the owner's request, verbatim:

> Ataquemos eso, para no dejar cosas sin soluciona

referring to the closing judge's first open destination: *"a truth gate (fixed-string assertions over the claims
this feature got wrong, so the sixth cannot ship silently)"* — recorded in `odd/tasks/didactic-guide.md` `L9`.
