# open-pr: the candidate set

`scripts/open-pr.js` answers whether a pull request may merge, so a green it cannot justify is worse than a red it can. Today it can report a green from a draft run, because the first run of the commit that was not in a snapshot taken moments earlier is not necessarily the run of the deciding event.

Issue: #230. Branch: `fix/open-pr-candidate-set`.

## Specs

S1. The floor is the greatest `databaseId` among the runs of the head SHA, read **before** the creation. A floor read that cannot answer refuses `2` **before anything is created**.

S2. Candidates are the runs of the head SHA whose id is **past** the floor. A run at or below it belongs to an event fired before the floor was taken and can never decide this pull request.

S3. The set decides only when two consecutive reads agree on its ids. A single candidate is not yet a decision: a run that existed but was not visible when the floor was read can surface afterwards.

S4. **Any red candidate makes the answer red.** A real failure is never averaged away by a green sibling.

S5. Every candidate green is green, and **every id is printed**, because more than one run decided it.

S6. No red and not all green is `2`.

S7. A set still growing when the budget ends is `2`, naming the ids seen.

S8. The creation carries the label and is **not** a draft: `gh pr create` without `--draft`, and `gh pr ready` is never issued. The label in the creation is what makes the `opened` run read `PR_LABELS` filled.

Decision recorded verbatim by the owner: «candidatos pasados el piso → esperar a que el conjunto deje de crecer → si todos coinciden en verde, verde; si alguno es rojo, rojo; desacuerdo sin rojo → 2».

## Tasks

| Id | Specs | Route | Commit |
|---|---|---|---|
| T1 | S2, S3, S4, S5, S6, S7 | inline | the candidate set: `floorOf`, `runsPastFloor`, stability, and a verdict from the set |
| T2 | S1, S8 | inline | the floor before the creation; no draft, no `pr ready` |
| T3 | S1-S7 | inline | `pack-guard.js` as `pack:check`, run by `open-pr` |
| T4 | S3, S6 | inline | `resume`: adopt an existing pull request instead of failing |

## Log

L1. The owner: «tú solo quiero que trabajes en secure, yo trabajo en forge. Guarda en memoria el plan para forge y dame el ID de la memoria, despues tú guarda en otra memoria el plan de secure, ya que compactaré contexto.»

L2. The owner chose, among three designs, the rule that a stable set which agrees is accepted: «B · Aceptar un conjunto estable que coincida». Measured reason: `--label` in the creation makes `ci.yml` fire `opened` and `labeled`, so a strict "more than one candidate refuses" would refuse every pull request.

L3. The cross-session channel does not resolve, and the failure is about the peer, not the tool. `orchestrator_send_message` to the forge session answered `session message was not accepted`; the same call addressed to this session answered `cannot send a message to the active session`, so the routing layer does resolve a known id and refuses an unknown one. `orchestrator_consult` to the forge id answered `unavailable` with `unknowns: ["discovery-unavailable"]`. Fallback adopted: the owner relays, one line per `X-<n>`, which the protocol was already sized for.

L4. Second attempt, after the forge session confirmed the same `Active session ID` and the same tool list: `session message was not accepted` again. A live peer with the same tools and the same id that still does not resolve means the catalogue is not shared between the two sessions — consistent with `orchestrator_list` failing with `io_error`, since the live process answers for its own id while a peer has to come from the catalogue that cannot be read. The channel is closed for this pair; the relay is the transport. Nothing in the delivery work depends on it.

L5. `FORGE-X1` received from the forge half (Engram `1760`) and **accepted**: the plan's claim that the floor stays valid under adoption is false, because a re-run reads the floor after the adopted pull request's runs exist, leaving the past-floor set empty. Adopted: option A — on adoption the identification changes from a floor to the pull request itself, and the verdict is read over every run of that commit with the same set rule; an empty set is `2` naming the adopted pull request, and the output says it was adopted. The flaw does not touch this unit: the creation path's floor is provably older than the runs it hides, so U1 stands as delivered.

L6. U1 landed as one commit, `f9adde6`, 619 authored changed lines — past the ~400-line slice. Not split, on purpose: 219 of those lines are the tests that pin the behaviour and ~90 are this document, and the behaviour is one unit, so any split puts a commit in the history whose tests fail for lack of the code they test. That intermediate state is worse for a reviewer than the size. The production change is ~290 lines in one file, which is what a reviewer actually reads.
