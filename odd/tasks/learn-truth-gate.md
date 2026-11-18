# Learn-path truth gate

The structural gate (`tests/didactic-guide.test.js`) checks that a page exists, has its six headings and links the
catalog. It cannot check that a sentence is **true**. The closing judge proved that from the other side: two rounds
over the plan produced no false claim, one round over the pages produced **seven**.

This adds the checks that **are** decidable about those pages — relations between the pages and the program, not
memories of the sentences that were once wrong.

## Specs

- **S1** — the gate asserts **relations that can be recomputed**, never a list of sentences. A fixed string cannot
  tell the lie from the correction: `start.md` legitimately contains `why this order` today, and `02` legitimately
  says `2` is the only nonzero code. A test that must go red when the page is right is a test that will be deleted
  by whoever hits it.
- **S2** — four relations, each chosen because a real defect of this feature had its shape:
  - **every relative link in `docs/learn/` resolves from its own directory** — the unlinked `Next:` was this shape,
    and a broken `../guide.md` in `commands/` was found by hand and by nothing else;
  - **`05`'s table is equal to `COMMANDS`** — one row per dispatched command, each linking its page, none extra.
    Equality, not a threshold: `07`'s table was right when the defect was on the row that was missing;
  - **every rule id cited anywhere under `docs/learn/` exists in the catalog** — check 6 of the structural gate
    reads only `04`, so a page citing a rule that does not exist passes today;
  - **every page that the path's table names as its successor ends with a `Next:` link, and that link points at a
    page that exists** — the defect was an unlinked `Next:`; deleting the line entirely is the same defect wearing
    another face, and a check over the lines that happen to exist cannot see it.
- **S3** — no absence strings, and the reason is written where the assertion would have been: three of the seven
  corrections **use the words the lie used**. `why this order` is on `start.md` at `:18` and `:71` today.
- **S4** — **the gate is falsified before it is trusted**: each of the four is made to fail by hand — a link
  retargeted at a missing page, a table row removed, a rule id invented, a `Next:` unlinked — and the red message
  is recorded with the page. Then restored. A gate nobody has seen fail is a gate nobody has tested.
- **S5** — the falsification is recorded in `docs/validation.md`, not in the test: this repository publishes its
  mutation rounds as measured tables, and a colour nobody recorded is a claim.
- **S6** — the gate goes into the **existing** file, not a second one. `docs/testing.md` forbids two tests owning
  one contract, and both halves check the same fifteen pages.
- **S7** — `docs/README.md`'s "What already fails the build" gains the sentence: a learn page whose link does not
  resolve, or whose rule id is unknown, fails the suite.

## Tasks

| ID | Task | Spec | Route | Commit |
|---|---|---|---|---|
| T0 | This plan, judged at `J1`; the record of what the judges refuted | S1–S7 | `PAIR` | `0d36c22` |
| T1 | four relations added to `tests/didactic-guide.test.js` | S2, S6 | inline | — |
| T2 | falsify all four by hand, record each red | S4, S5 | inline | — |
| T3 | `docs/validation.md` gains the measured table | S5 | inline | — |
| T4 | `docs/README.md`'s gate list gains its sentence | S7 | inline | — |
| T5 | `J2` on the diff | S1 | `SINGLE` | — |

**Slice**: one. Three files, no new mechanism, under 200 authored lines.

**Route: inline.** The whole value of T2 is watching the exact assertion go red; a worker would report a colour I
could not see, which is the one thing this feature exists to refuse.

## Risks

`Risk: item 6` — the four relations catch four shapes and no others. A page can still assert a falsehood about the
program (the `start` step arithmetic was one), and nothing mechanical sees it. That limit is in the file's header
and in `docs/README.md`, in the terms the repository already uses.

## Log

**L1** — the owner's request, verbatim:

> Ataquemos eso, para no dejar cosas sin soluciona

(the sentence was written that way; it is quoted as sent) — referring to the closing judge's first open
destination, *"a truth gate (fixed-string assertions over the claims this feature got wrong, so the sixth cannot
ship silently)"*, recorded in `odd/tasks/didactic-guide.md` `L9`.

**L2** — `J1`, two blind judges, eight questions each. **Both refuted the plan's core**, and the findings converge:

- **`why this order` is still on the page** (`docs/learn/commands/start.md:18`, `:71`) — the absence gate would have
  been **red on the day it landed**, against a page that is right.
- **"quoted from the record, not paraphrased" was false** — three of the five strings exist only in the `#485` diff;
  the record paraphrases them, which is exactly how the ambiguous fragment got chosen.
- **The 5+2 decomposition was wrong.** `#485`'s two non-absence defects were the unlinked `Next:` and a report
  symbol used before any page introduced it — not "both missing program spellings", which were fixed five commits
  earlier in `2579f27`.
- **The plan never mapped the seven to the assertions.** `F2` (the symbol) was guarded by nothing, and `S1`'s
  headline read as if the set were complete.
- **`06 links ≥3` was the closest to worthless**: the threshold derives from nothing, and deleting both rule links
  leaves three and stays green while the defect returns exactly.
- **"fifteen pages exist" pins a snapshot** — the record's own next two pages would turn it red.
- **A hand-mutation round over documentation proves sensitivity and nothing else**: a literal that was never on the
  page mutates just as red.

**What survived, and it is why this plan is shorter than the one it replaces**: the four defects that mattered were
**relations** — a link to nowhere, a table short a row, a rule id that does not exist, a `Next:` that stopped being
one. Those are recomputable from the repository, they do not ban a true sentence, and they catch the class rather
than the instance.

**L3** — what changed: the absence family is gone (S3 says why); the presence family is replaced by relations
recomputable from the repository (S2); the mutation round moves out of the test and into the measured table the
repository already publishes (S5); and the gate extends the existing file instead of adding a second one (S6).
