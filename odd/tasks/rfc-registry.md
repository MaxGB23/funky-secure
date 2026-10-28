# RFC registry and living spec

Separate what happened from what is true now: RFCs become immutable records under `rfcs/<number>-<slug>/`, the present contract moves to `docs/spec/`, and `AGENTS.md` names both. Tracked as T1-T3 on branch `docs/rfc-registry`.

## Specs

S1. An RFC is a draft record. Once it is implemented or closed it is history and its body is not edited again: "rfc son drafts de ideas, si un rfc se cierra se debe quedar como historico". Each one lives at `rfcs/<4-digit-number>-<slug>/rfc.md` with a leading status block naming `status`, `supersedes` and `superseded-by`.

S2. The order that stops a record from growing is the split itself, not a rewrite: "para cada feature puede haber un rfc y diagramas o mas cosas que lo complementen, y que tenga un status de implementado, cerrado o algo así".

S3. The record of the process is immutable too: "fue el proceso de implementacion que acompaño al odd que tampoco debe modificarse". `odd/tasks/<feature>.md` stays append-only; the working policy is a living document and is not this file.

S4. The present contract is `docs/spec/`, extracted from the record verbatim — moved, never reworded — and `docs/spec/README.md` maps every section number of the record to the file that now carries it, so a citation such as `10.3` still resolves.

S5. No live document points at a path that no longer exists: `README.md`, `CONTRIBUTING.md`, `docs/*.md` and `.github/ISSUE_TEMPLATE/config.yml` name the record's new path, and the drift gate fails if `docs/decisions.md` stops naming it.

S6. `AGENTS.md` exists at the repository root, minimal, and names the new paths and the two axes, "para que siempre se sepa".

## Tasks

| ID | Spec | Work | Commit |
|---|---|---|---|
| T1 | S1, S2, S5 | Freeze 0001 (rename + status block), `rfcs/README.md` index, every live reference updated, drift-gate literal updated | `2f5f88e` |
| T2 | S3, S4 | `docs/spec/` extracted verbatim, index mapping section to file, drift gate asserting the index covers the record | `c310269` |
| T3 | S5, S6 | `AGENTS.md`, decision-log entries, `CONTRIBUTING.md` RFC-first rule restated in the new model | `c310269` |

## Log

L1 (verbatim): "hay que cambiar cosas, rfc son drafts de ideas, si un rfc se cierra se debe quedar como historico, fue el proceso de implementacion que acompaño al odd que tampoco debe modificarse. Esto es lo que ha hecho que un rfc haya crecido tanto, por no tener un orden. He pensado que para cada feature puede haber un rfc y diagramas o mas cosas que lo complementen, y que tenga un status de implementado, cerrado o algo así. Dime qué opinas."

L2 (verbatim): "arranca, tambien recuerda crear un agents.md en root minimo con las nuevas rutas, para que siempre se sepa. Conciso"

L3 (decision, parent): the record is not rewritten, so extraction is a copy of the normative sections into `docs/spec/`, not a cut: the frozen body keeps its prose and the spec becomes the authority for the present. Duplication between `docs/spec/rules.md` and `docs/rules/<id>.md` is resolved by role — the spec is normative text, the rule page is the reader's page and names the spec as the normative source.

L4 (decision, parent): the record keeps Context, Problems, Goals, Principles, Testing, Implementation plan, Delivery history, Risks, Resolved questions, Acceptance and Appendices A-E; the spec carries Identity, Scope, Rules, Policy, Report, Commands, Machine, Documentation and Layout. Delivery (17) is extracted to `docs/delivery.md` because it describes a posture, not a version.
L5 (evidence): 358/358 tests, self-scan `--scope repo --fail-on warn` exit 0. The record body was
verified byte-identical after the freeze, and each of the ten extracted files was verified to still
appear verbatim in the record. The slice counter reports one large commit in `c310269`; it is a move,
not authored work — 1,352 added lines of copied text against 40 lines of new prose and gates.

L6 (open): the release path is still undecided (manual vs OIDC), so nothing here touches publication.
