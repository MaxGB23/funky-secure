# npm release: stage-only publication and the packed set

Feature record for the delivery-contract change that makes `funky-secure` publishable without a
credential and without an unattended publication. Branch `ci/npm-stage-only-release`.

## Specs

- **S1.** The packed set is narrowed to what a user can actually use: `bin/`, `src/`, `skills/`,
  `docs/cli.md`, `docs/guide.md`, `docs/concept.md`, `docs/rules/`, `docs/images/diagram.jpg`,
  `README.md`, `LICENSE`. `docs/rules/` is mandatory because every rule module declares
  `docs/rules/<id>.md` and the JSON report emits that path, so a package without it names files that
  do not exist. The development record (`docs/spec/`, `decisions.md`, `architecture.md`,
  `validation.md`, `field-loop.md`, `delivery.md`, `README.md` indexes) stays in the repository.
  Owner: *"confirmo todo la que incluyes en el tarball, tiene justificacion"*.
- **S2.** `docs/images/diagram.jpg` ships unchanged and is not recompressed. Owner: *"Sobre la
  imagen, dejala como está, ya está optimizada, unos cuantos kb no son problema."*
- **S3.** Publication runs through a trusted publisher whose only allowed action is
  `npm stage publish`. `npm publish` is unreachable from the workflow, and no npm credential exists
  in the repository, in `.npmrc` or in Actions secrets. The human gate is 2FA on
  `npm stage approve`. Owner: *"La idea es anti supply chain, que no se pueda publicar sin
  autenticacion en dos pasos u otras medidas que ofrezcan, tambien no suelo confiar mucho en los
  auto publish porque no me gusta compartir credenciales"*.
- **S4.** A `vX.Y.Z` tag stages the version; it does not publish it. The workflow reports the stage
  id, because approval happens outside it and `npm stage list` is the only other way to find it.
- **S5.** The packed set is enforced, not merely declared: every `docs/rules/<id>.md` the catalog
  declares must appear in the list npm would pack, so narrowing `files` cannot silently drop a page
  the binary promises.

## Tasks

| ID | Specs | Route | What | Commit |
|---|---|---|---|---|
| T1 | S1, S3, S4, S5 | inline | `docs/spec/layout.md` §14 packed set; `docs/spec/delivery.md` §17.2/§17.3 stage-only; dated erratum in the record | |
| T2 | S3, S4 | inline | `release.yml`: npm ≥ 11.15 step, `npm stage publish --json`, stage id into the step summary; `tests/release-workflow.test.js` follows | |
| T3 | S1, S5 | inline | `package.json` `files` + `repository` object; `release-guard.js` catalog assertion; test for it | |
| T4 | S1-S5 | inline | Gate: suite, self-scan, release-guard, pack-smoke; measured packed set | |
| T5 | S3, S4 | owner | Bootstrap, stage, approve, trusted publisher, provenance measurement | — |

## Log

**L1.** `2fa habilitado, npm 11.15.0 instalado, logeado en npm en esta maquina. No he hecho stage
publish ni mas cosas, quiero que tú me ayudes. dime qué procede`

**L2.** `confirmo todo la que incluyes en el tarball, tiene justificacion. SObre la imagen, dejala
como está, ya está optimizada, unos cuantos kb no son problema. Dime qué procede para iniciar con el
release, tengo mi cuenta npm pero no la tengo en esta pc, accedo desde su web en movil`

**L3.** Measured before writing: `npm pack --dry-run --json` at `150b92e` packs 82 files, 404 kB,
934 kB unpacked; `docs/` is 528 kB of that and `docs/images/diagram.jpg` alone is 168.629 B (41% of
the download). `npm root -g`/`lib/commands/stage/publish.js` shows `StagePublish extends Publish`
with `static stage = true`, and `publish.js:101` fires `prepublishOnly` in both paths, so §17.4's
gate is not bypassed by staging. The local npm was 11.13.0 (`Unknown command: "stage"`), and Node
24.16 bundles that version, so the release job needs an explicit npm upgrade.

**L4.** Owner raised GitHub Releases: *"omitimos releases en gh verdad, o lo consideramos meter?"*.
Measured: no workflow creates a Release and the job holds `contents: read`, while §17.3 and §17.5 both
promise a "release body" — an unfulfilled clause in the record, not a missing feature. The stage-only
model forbids creating it inside `release.yml`: the job runs before the human approval, `contents:
write` would widen the blast radius the design just narrowed, and with immutable releases enabled a
premature Release would lock the tag of a candidate that can still be rejected.

**L5.** Measured by the delegated writer on npm 11.15.0: a bare `README.md` entry in `files` is a
basename glob and packs `docs/README.md` and `docs/images/README.md` with it (67 files instead of 65),
so the gate could not pass. The root entry is `./README.md` and `checkPackList` normalizes a
root-anchored entry; §14.1 and §17.4 now say so. The packed set is 10 entries, not 13 — T1 said 13 and
was wrong; the enumerated list was always 10. Measured after the change: 65 files, 335.570 B tarball.
