# start: the resolve comes before the pin

A field report from an outside agent: in the pnpm path, `start` prints `pin --apply` before
`pnpm install --lockfile-only`, and the lockfile a current `create-next-app` writes records no
dependency versions, so `pin` copies nothing and the step's own sentence promises five ranges and
pins zero. The npm path is clean. Contract first: the order is prescribed by `docs/spec/commands.md`
rows 7 and 8, and the record never reasoned about a lockfile with no recorded versions.

## Specs

### S1 — the resolve precedes the pin in the pnpm path

> En el flujo pnpm, pnpm install --lockfile-only tiene que ir antes de pin --apply (y repetirse después, como ya hace el flujo npm). Son dos líneas de start:
> ```
> 3  pnpm install --lockfile-only
> 4  funky-secure pin --apply
> 5  pnpm install --lockfile-only
> 6  git add package.json pnpm-lock.yaml && git commit …
> ```

### S2 — the step says what is true of the manifest, not what `pin` will achieve

> y una mejora de honestidad: si pin fija menos de las que anunció, start no debería seguir diciendo "the 5 ranges this repository already has". Hoy el tool es correcto por specifier ("the lockfile records no version"), pero el resumen del plan promete de más.

### S3 — the npm path does not move

> npm — 11 pasos, todo verde
>
> npm confirmado.

### S4 — the fixed pnpm path ends with no floating range left

> Y tras otro pnpm install --lockfile-only + commit del lockfile:
> summary  0 errors · 0 warnings · 0 info · 6 passing · 0 skipped
> verdict  PASS (threshold: error)
> Cero warnings. Confirmado: el orden es el defecto.

## Tasks

| ID | Spec | Route | Commit |
|---|---|---|---|
| T1 | S1-S4 | inline: RFC 0034 opened as `draft` | — |
| T2 | S1, S2 | inline: spec table rows 7-9, `docs/cli.md`, `skills/funky-secure/SKILL.md` | — |
| T3 | S1, S2, S4 | inline: RED test first, then `src/commands/start.js` and the nine order assertions | — |
| T4 | S3, S4 | inline: full suite, self-scan, RFC flipped to `implemented` | — |

## Log

### L1 — the field report, verbatim

> "Corrí los dos flujos completos. npm: limpio. pnpm: encontré un defecto real.
> (Nota: mi primer intento falló por un error mío de sintaxis en PowerShell, no del tool. Se hizo el commit de baseline y nada más; re-ejecuté todo desde ese punto.)
> npm — 11 pasos, todo verde
> 2 init --apply      EXIT=0  (4 writes)
> 3 commit            EXIT=0
> 4 pnpm import       EXIT=0
> 5 pin --apply       EXIT=0
> 6 install           EXIT=0
> 7 commit pin        EXIT=0
> 8 branch            EXIT=0
> 9 migrate           EXIT=0  removed package-lock.json
> 10 commit lockfile  EXIT=0
> 11 scan             EXIT=0
>
> summary  0 errors · 0 warnings · 0 info · 6 passing · 0 skipped
> verdict  PASS (threshold: error)
> git status → vacío
> log: 29a4489 track the lockfile · 0a60776 pin the ranges · 7c8f8a3 apply · 16642ff baseline
> pnpm — 8 pasos: el paso 4 no hace nada
> 4 pin --apply  →  "typescript (devDependencies) floats and the lockfile records no version, so it is not pinned"
>                  0 pins aplicados
> 6 commit pin   →  EXIT=1  "no changes added to commit"
> 7 commit lock  →  EXIT=0  (4116 insertions)
> 8 scan         →  PASS … pero con 5 warnings
> summary  0 errors · 5 warnings · 0 info · 5 passing · 0 skipped
>
> IMPORTER  package.json
>   ⚠ Dependency ranges · package.json:18  @types/node@^20
>   ⚠ Dependency ranges · package.json:19  @types/react@^19
>   ⚠ Dependency ranges · package.json:20  @types/react-dom@^19
>   ⚠ Dependency ranges · package.json:21  eslint@^9
>   ⚠ Dependency ranges · package.json:24  typescript@^5
> La frase de start resultó falsa: "pin the 5 ranges this repository already has" — fijó cero.
> Causa
> El pnpm-lock.yaml que deja el create-next-app actual tiene 78 líneas: sólo packageManagerDependencies (el pnpm 12.3.4 autogestionado) y los paquetes @pnpm/exe por plataforma. No registra ni una versión de las dependencias del proyecto.
> pin lee el lockfile. Si el lockfile no tiene versiones, no tiene de qué copiar. Y en el flujo pnpm, pin va antes del install.
> Prueba de que el orden es el problema
> Después del paso 5 (pnpm install --lockfile-only), volví a correr pin:
> pin --apply → 5 pins aplicados (20.19.43, 19.3.0, 19.3.0, 9.39.5, 5.9.3)   EXIT=0
> Y tras otro pnpm install --lockfile-only + commit del lockfile:
> summary  0 errors · 0 warnings · 0 info · 6 passing · 0 skipped
> verdict  PASS (threshold: error)
> Cero warnings. Confirmado: el orden es el defecto.
> Arreglo
> En el flujo pnpm, pnpm install --lockfile-only tiene que ir antes de pin --apply (y repetirse después, como ya hace el flujo npm). Son dos líneas de start:
> 3  pnpm install --lockfile-only
> 4  funky-secure pin --apply
> 5  pnpm install --lockfile-only
> 6  git add package.json pnpm-lock.yaml && git commit …
> Y una mejora de honestidad: si pin fija menos de las que anunció, start no debería seguir diciendo "the 5 ranges this repository already has". Hoy el tool es correcto por specifier ("the lockfile records no version"), pero el resumen del plan promete de más.
> Estado
>      resultado    árbol    warnings
> npm    PASS 6·0·0    limpio    0
> pnpm (flujo tal cual)    PASS con 5 warnings    limpio    5
> pnpm (con install antes de pin)    PASS 6·0·0    limpio    0
> npm confirmado. pnpm no está listo así: termina en verde por umbral pero deja 5 rangos flotantes, que es exactamente lo que el tool promete eliminar."

### L2 — the defect is in the spec, and it needs a record, not an errata

`docs/spec/commands.md:271-272` prescribes row 7 `pin --apply` then row 8
`pnpm install --lockfile-only`. Row 8's stated rationale is "`pin` writes exact specifiers over a
lockfile that recorded a range"; row 7's only trigger is a `floating-range` finding; neither
trigger mentions recorded versions. RFC 0015 `:37-41` carries the premise in prose — "in a
repository that already has one, the step moves up and the order stays causal" — and RFC 0011 `:75`
admits the case that breaks it: a floating range with no recorded resolution is listed as not pinned
and left untouched.

So the code implements the table row for row and the table was never reasoned about for this state.
0011 decided the order deliberately ("the plan prints both, in that order"), which makes this a
changed decision, not a correction of a mistaken body: the next numbered record, opened as `draft`.

### L3 — the leading resolve is unconditional within the pnpm path

Conditioning it on "the lockfile records no version for at least one floating range" would need that
fact on the `floating-range` finding: `start` counts findings (`src/commands/start.js:415`) and never
imports `src/lib/pins.js`, where `collectPins` fills `unrecorded`. A new field on a finding changes
the JSON report, which is the machine contract, and an order bug must not cost a contract change.

The step therefore prints when a pin follows and no `pnpm import` produced the lockfile —
`pins > 0 && foreign.length === 0` — and the cost is one `--lockfile-only` of a second in a
repository whose lockfile is already synced.

### L4 — the wording names the manifest, not the outcome

`pin the ${N} ranges package.json declares`. With the order fixed the old sentence is true in the
common case and still promises an outcome in the state without a network, which is exactly the state
the field found. `N` stays the `floating-range` count: it is the number of ranges to fix, and that
number is a fact about the manifest.

### L5 — why no test caught this, and what changes

`tests/start.test.js:198` writes an **empty** lockfile, and the three pnpm-path tests (`:647`, `:786`,
`:847`) already run the field shape: lockfile present, no versions. The defect was encoded as the
expected output, because the expectation was read from the code and not from the world.

Nine tests assert the step order with a full `deepEqual` and the same nine assert the old wording:
`tests/start.test.js:409, 504, 574, 603, 647, 717, 758, 786, 847`.
