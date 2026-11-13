# The workflow_run artifact pair

Close #153 by naming the third privileged trigger, so the README stops carrying a known hole.

## Specs

- **S1** The goal, in the owner's words: "quiero cerrar 153 y si es necesario adaptar el issue por si es que miente.
  Esto nos hará evitar mencionar el "One hole in the rule set is known and open" y por fin cerrarlo."
  (#153 must close because the hole is closed, never because the sentence is deleted.)
- **S2** The drawing stays out of this release: "153 entra, pero el diagrama de readme será abordado despues por mi
  cuenta, fuera de la release". The raster keeps `TWELVE` until the owner redraws it; every **text** surface that
  states the count moves in this release, and the divergence is recorded, not hidden.
  The GitHub repository description states the count too ("twelve stateless rules") and moves **last**: "igual la
  descripcion del repo en gh la ponemos para el final, ya que igual menciona 12 reglas".
- **S3** The finding is the pair, as #153 measured it: an unprivileged workflow (`on: pull_request`,
  `permissions: contents: read`) uploads an artifact, and a privileged workflow (`on: workflow_run`, with
  `contents: write`, `actions: read` or `pull-requests: write`) downloads it by `github.event.workflow_run.id`
  with `github.token` and hands its bytes to a write context. The verdict today is `PASS` with every CI rule
  green; after this feature it is a finding.
- **S4** The catalogue is twelve and a thirteenth must argue itself in §8.4, which says: "twelve rules must still
  fit one screen of output on a real repository, one page of documentation, one test file each and one release
  note" and "a thirteenth rule cannot arrive without a section here (0024)". RFC 0035 carries that argument or
  the feature does not proceed.
- **S5** Spec and implementation ship in one pull request: `tests/docs-contract.test.js:281-285` counts
  `#### R` sections against `catalog.length`, so a spec-only PR cannot pass the suite the ritual refuses to
  publish over.
- **S6** The reader must expose what the finding needs, and today it does not: `parseWorkflow` returns
  `{ok, jobs, permissions}`, steps carry no `env`, and nothing models the workflow `name:` or
  `on.workflow_run.workflows` (issue #153's consumer carries `GH_TOKEN` only in `env:` and names its producer
  by workflow name).
- **S7** `README.md:193-196` ("One hole in the rule set is known and open") is removed **in the pull request that
  closes the hole**, gated by a test over issue #153's exact two-file fixture.
- **S8** A new `error` rule turns existing scans red under the default `--fail-on error`: `Risk: item 3`
  (published contract), `type:breaking-change`, and the RFC states the upgrade consequence and the `starter`
  preset position.

## Tasks

| ID | Task | Spec | Route | Commit |
|---|---|---|---|---|
| T1 | Re-measure #153 on `main` with the two-file fixture; record the verdict; amend the issue if it lies | S1, S3 | inline | — |
| T2 | Reader: workflow `name:`, `on.workflow_run.{workflows,types}`, `env:` at job and step | S6 | inline | — |
| T3 | `rfcs/0035-the-third-privileged-trigger/rfc.md` as `draft` + registry row; carries "why thirteen", the §8.4 amendment, the false-positive boundary, the S2 divergence | S4, S8 | inline | — |
| T4 | The rule + tests + goldens + `docs/rules/<id>.md` + preset policy + every count in `docs/spec/`, `docs/cli.md`, `docs/guide.md`, `README.md` prose | S3, S5, S8 | inline | — |
| T5 | Remove `README.md:193-196`, gated by the T1 fixture as a test | S7 | inline | — |
| T6 | Verification, native review, and `node scripts/open-pr.js` | S5 | inline | — |
| T7 | Update the GitHub repository description once every text surface is true (last step of the release) | S2 | inline | — |

## Log

- **L1** "Quiero tu recomendacion. No quiero abordar todo, solo quiero que el repo deje de tener una seccion de
  "Qué no está verificado" para que el repo tenga fiabilidad"
- **L2** "dale, sigamos ese orden, quiero cerrar 153 y si es necesario adaptar el issue por si es que miente.
  Esto nos hará evitar mencionar el "One hole in the rule set is known and open" y por fin cerrarlo. Dame el
  plan para hacerlo con odd y rdd"
- **L3** "delega un subagente a que refute nuestro plan antes, esto nos ayudará a tener una segunda opinion y que
  el plan sea mas pulido" — the refuter found, verified here: the docs-contract count gate (S5), the §8.4 budget
  and the drawn count (S4, S2), the missing `env`/`name` surfaces (S6), and the vacuous 403 probe (moved to the
  other feature).
- **L4** "153 entra, pero el diagrama de readme será abordado despues por mi cuenta, fuera de la release" — the
  raster is out of scope; the divergence between the drawing and the catalogue is recorded in RFC 0035 and in
  `docs/images/README.md`, and the redraw is owned by the maintainer.
- **L5** "igual la descripcion del repo en gh la ponemos para el final, ya que igual menciona 12 reglas" — the
  description is a text surface, so it is not deferred like the raster: it moves at the end of this release (T7).
- **T1 measured** on `main@1b5d344`, `GIT_CEILING_DIRECTORIES` set to this repository so the parent's lockfile
  cannot contaminate the fixture. The scan prints `CI — all 5 rules pass` over issue #153's exact two files, so
  the issue does not lie and needs no rewrite. The same run confirms S6: `parseWorkflow` returns
  `{ok, jobs, permissions}`, `name` is `undefined`, and the step keys are
  `index, line, name, uses, raw, with, run` — no `env`. The measurement was posted as a comment on #153.
