# Rule coverage sweep

Field rounds one to three exercised 6 of 12 rules, because no project they generated had workflows. This
sweep covers the other six with real projects and delegated reports, plus the three shapes the tool
declares but no round has run: a monorepo, a yarn migration, and the refused lockfile sections.

## Specs

- S1. The owner's words: "un uso real cubre cosas que los tests no". A rule counts as exercised only when a
  real project produced its finding, its remediation and its exit code — not a unit fixture.
- S2. Delegated to `funky-lakra`, one session per scenario, in parallel, each in its own directory under
  `M:/pruebas/rule-sweep/`. Agents are read-only over `M:/funky-secure-v2`.
- S3. Every scenario is offline: workflows are YAML, lockfiles are written by hand, and the monorepo uses
  `workspace:*` with no registry dependency. No scenario may need `pnpm install` to reach the network.
- S4. Every scenario reports: the table (command, exit, expected, observed, surprise), the literal finding
  output, and an explicit list of what it could not verify.
- S5. A rule whose remediation is printed must be executed by the agent as printed. A remediation that does
  not work as printed is the highest-value finding, above any missing detection.
- S6. Each scenario also runs the same project under `--preset strict`, so the severity promotion of every
  rule is observed at least once, not asserted from the spec.

## Tasks

| ID | Specs | Scenario | Route | Commit |
|---|---|---|---|---|
| T1 | S1 S2 S4 S5 S6 | The six CI rules: `env-not-tracked`, `actions-pinned-sha`, `no-bot-auto-merge`, `ci-no-safety-overrides`, `pull-request-target`, `workflow-permissions`. Two projects: one violating each rule, one with all six correct | delegated writer-reader (`funky-lakra`) | report only |
| T2 | S1 S2 S3 S4 S6 | Monorepo: root plus two workspace packages, existing `packages:` key, one floating range per package. Asserts root-importer-only `pin`, and that `init` does not synthesize or reorder `packages:` | delegated reader | report only |
| T3 | S1 S2 S3 S4 S5 | `migrate --from yarn`, twice: a classic `yarn.lock` and a berry `.yarn/` with `yarn.lock`. No yarn binary needed — the tool reads the files | delegated reader | report only |
| T4 | S1 S2 S3 S4 | The refused lockfile sections: `catalogs`, `overrides`, `patchedDependencies` in `pnpm-workspace.yaml`. Asserts the honest refusal, its exit code, and that nothing is rewritten | delegated reader | report only |
| T5 | S5 | Triage and fix whatever T1-T4 report. Each surviving defect becomes its own record, spec change and release | inline | one per defect |

## Briefs

### T1 — CI rules

```text
Trabajá en M:/pruebas/rule-sweep/ci/ y M:/pruebas/rule-sweep/ci-fixed/. No toques M:/funky-secure-v2.
Binario: node M:/funky-secure-v2/bin/funky-secure.js (0.8.3, no está instalado globalmente).

Proyecto 1 (violaciones). Un repo git con package.json, pnpm-lock.yaml escrito a mano
(lockfileVersion '9.0', un importer, una dep) y .github/workflows/ con seis archivos, uno por regla:
  env-not-tracked        un .env versionado con secretos dentro
  actions-pinned-sha     uses: actions/checkout@v4  (tag, no SHA)
  no-bot-auto-merge      un step que hace gh pr merge --auto con GITHUB_TOKEN en un [bot]
  ci-no-safety-overrides el step de install con --no-frozen-lockfile y --ignore-scripts
  pull-request-target    un workflow disparado con pull_request_target que hace checkout del PR
  workflow-permissions   un workflow sin bloque permissions y con contents: write
Corré: scan --scope all, y después scan --scope all --preset strict. Registrá para cada regla el
finding literal, el exit code y la severidad en cada preset. Ejecutá tal cual la remediación de cada
una; si no funciona como está impresa, ese es el hallazgo principal.

Proyecto 2 (correcto): los seis workflows con SHA fijado por 40 hex, permissions declarado, secretos
por secrets.*, install con --frozen-lockfile. Debe dar PASS en los dos presets. Si alguna regla
sigue fallando con un workflow correcto, ese es un falso positivo: el hallazgo más importante.

Reglas: no uses red, no instales nada, no pases --force. Reportá la tabla con una fila por comando,
el texto literal de cada finding y qué NO pudiste verificar.
```

### T2 — monorepo

```text
Trabajá en M:/pruebas/rule-sweep/mono/. No toques M:/funky-secure-v2.
Binario: node M:/funky-secure-v2/bin/funky-secure.js (0.8.3).

Un workspace pnpm: pnpm-workspace.yaml con un bloque packages: ya existente (apps/*, packages/*), root
package.json privado con tres deps de rango caret, y dos paquetes que dependen del otro con
"workspace:*" más una dep externa con caret cada uno. Escribí pnpm-lock.yaml a mano con los tres
importers (., apps/web, packages/ui) y versiones grabadas, sin instalar nada.
Corré start y ejecutá los pasos. Verificá específicamente:
  1. pin --apply toca sólo el importador raíz, no los paquetes (11.9) — mostrá el diff completo.
  2. init --apply no crea un segundo packages: ni reordena el que existe.
  3. El scan cuenta los tres importers del lockfile y no declara un desync falso.
Corré también scan --preset strict y reportá diferencias de severidad.
Reportá tabla, diff literal y qué NO pudiste verificar.
```

### T3 — yarn

```text
Trabajá en M:/pruebas/rule-sweep/yarn-classic/ y M:/pruebas/rule-sweep/yarn-berry/. No toques
M:/funky-secure-v2. Binario: node M:/funky-secure-v2/bin/funky-secure.js (0.8.3). NO instales yarn.

En cada directorio: git init, package.json con dos deps de rango, un yarn.lock escrito a mano (clásico:
bloques con version "x.y.z"; berry: __metadata: version: 8 y resolutions), sin pnpm-lock.yaml.
Corré start y ejecutá los pasos como están impresos, hasta el scan final.
Verificá: que el paso de install y el de migrate aparezcan en el orden impreso; que migrate nombre la
rama y que el git switch -c impreso baste para que migrate acepte; que al final yarn.lock no exista y
pnpm-lock.yaml sí; y que el commit final deje el árbol limpio (git status --short vacío).
Después probá migrate --from yarn explícito y sin --from. Reportá diferencias y qué NO pudiste verificar.
```

### T4 — refused sections

```text
Trabajá en M:/pruebas/rule-sweep/refused/. No toques M:/funky-secure-v2.
Binario: node M:/funky-secure-v2/bin/funky-secure.js (0.8.3).

Tres repos git hermanos, cada uno con pnpm-workspace.yaml que declara una sección que el tool debe
rechazar: catalogs:, overrides:, patchedDependencies: — con contenido legal de YAML en cada una — y un
package.json con un rango y un pnpm-lock.yaml escrito a mano.
Para cada uno: scan --scope all, y después init --apply. Registrá el exit code, el texto literal y
confirmá con git diff que el archivo no fue tocado (salvo el bloque gestionado, si lo escribe).
Si el tool RECHAZA la sección, la evidencia es el mensaje y el exit. Si en cambio reescribe el archivo
o lo acepta en silencio, ese es el hallazgo. Reportá tabla y qué NO pudiste verificar.
```

## Log

- L1. Owner, verbatim: "me gusta este flujo que estamos haciendo de crear proyectos y probarlo con
  veredictos de subagentes, esto me toma tiempo, por lo que para el resto de reglas podemos crear un plan
  y delegar subagentes funky lakra a probar todo, un uso real cubre cosas que los tests no. Ahora mi
  pregunta, al mismo agente le lanzo otro prompt, o ya hacemos el plan para probar todas las reglas, con
  escenarios reales como ci y mas casos"
- L2. Decision: one fresh session per scenario, launched in parallel, not a continuation of the round-3
  session. A report that carries the previous round's context mixes evidence; a fresh session re-derives
  the state from files. Four disjoint directories, no writes to this repository.
- L3. Decision: all four scenarios are offline by construction. The six CI rules read YAML, the lockfiles
  are hand-written, and the monorepo resolves `workspace:*` with no registry dependency, so no scenario
  can be blocked by the network and no run needs `pnpm install` to reach it.
