# The coverage line: say what the number counts, and why it is small

The header's coverage line reads `not run  6 of 13 rules; off by policy: …` and then names **seven** rules.
`6 + 7 = 13`, so the number counts the rules that **ran** under a label that says they did not. `docs/spec/report.md`
§10.3 defines the number as "how many catalog rules still run", so the renderer matches the spec and the **label** is
the surface that lies.

A real round found it (`docs/validation.md`, "The round at `0.13.0`"): the owner's agent ran `start` on an
npm-leaving and a pnpm-leaving project, every step exit `0`, both scans PASS — and the line it read in the repository
with no CI is the one that says how much was not looked at. It suggests a smaller hole than there is.

## Specs

- **S1** — the label names what the number is. `not run` → **`coverage`**: the line states the coverage the verdict
  actually has, in §10.3's own words, and six is that number.
- **S2** — the line gains **one continuation saying why the rest are off and what turns them on**: the preset is the
  lever, and `--preset strict` runs all thirteen. Today a reader must connect `off by policy` to the preset named two
  lines above in `provenance`; a reader who does not know what a preset is never makes that connection.
- **S3** — nothing else in the header moves. The block keeps its gutter, its wrap width and its position; the golden
  reports are regenerated and diffed, and any change beyond these two sentences is a defect.
- **S4** — every surface that quotes the line moves in the same change: `docs/cli.md`, `docs/guide.md`, the seven
  learn pages that paste a report, `skills/funky-secure/SKILL.md` where it tells an agent to report the line
  verbatim, and `docs/spec/report.md`'s own example.
- **S5** — the round's record is **adapted, not rewritten**: the section keeps the two paths and their numbers, and
  says plainly what the round was for — the flow, which was impeccable — with the coverage line recorded as a
  cosmetic finding now fixed. A round that was clean must not read as a round that found a problem with the flow.
- **S6** — a repository with no workflows is the case this line is read in most, so the new sentence is checked
  against that case first: `scan --preset starter` in a repository with no `.github/workflows/`.

## Tasks

| ID | Task | Spec | Route |
|---|---|---|---|
| T0 | This plan, judged at `J1` | S1–S6 | `PAIR` |
| T1 | `docs/spec/report.md` §10.3: the label, the continuation, the example | S1, S2 | inline |
| T2 | `src/lib/render-human.js`: label and continuation; goldens regenerated | S1–S3 | inline |
| T3 | the surfaces that quote the line | S4 | inline |
| T4 | `docs/validation.md`: the round reads as what it was | S5 | inline |
| T5 | `J2` on the diff | S6 | `SINGLE` |

**Slices**: two pull requests. The spec (T1) alone, then the code with its surfaces (T2–T4). A format change that
starts in the spec is the repository's rule, and it is the rule this feature's own `#480`/`#482` pair followed.

## Risks

`Risk: item 3` — the header is a consumed surface: the JSON document does not carry this line, but the human text is
what every capture in `docs/` and every golden report restates, and a reader who scripts against the human text is
outside the contract. Mitigation: the change is a label and one sentence, the goldens are regenerated and diffed, and
`docs/spec/report.md` already states that the human text is presentation while the JSON is the contract.

## Log

**L1** — the owner's request, verbatim:

> soluciona todo. Usa jueces para lo que se requiera. Cuando esté solucionado, adapta los docs de validation.md de mi
> testeo real, para que reflejen la realidad del off policy, ya que lo importante era el flujo de npm y pnpm y todo
> fue PASS perfecto, flujo impecable

and, from the round itself: *"Dice 6 y lista 7 nombres … El número correcto es 7 de 13"*, with the owner's own
reading that `off by policy` is "honestidad, no pereza" — the line is right to exist, the label is what misleads.
