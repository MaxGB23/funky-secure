# funky-secure v0.2 — delivery contract and the next three rules

Specification: `rfcs/funky-secure-rfc.md`, revision 4 (v1.3, written by T1). The RFC is normative;
this document tracks execution and records only decisions and evidence taken during implementation.
Branch: `feat/v0.2`.

## Specs

S1 — v0.2 begins with the release contract, because the owner cannot publish until his own
anti-supply-chain process exists: "npm se retrasara por proceso de seguridad que debo implementar,
anti supply chain". The RFC states it as normative delivery behavior:
publication uses npm Trusted Publishing over OIDC with provenance and no long-lived npm token
anywhere; the release workflow runs on an immutable `vX.Y.Z` tag and never on `pull_request`;
`prepublishOnly` runs the full suite, the drift gate and the self-scan, so a package that cannot
audit itself is not published; the packed file set is verified against `files` before the tag is
used, and the release records the tarball `sha256`; `publishConfig.access` is `public` and 2FA is
required on the account, with `id-token: write` scoped to the release job alone.

S2 — The nine deferred rules of RFC 8.3 enter the 0.2 catalog in F5 order, and implementation starts
with the three that need neither state nor a new reader: `ci-no-safety-overrides`,
`pull-request-target`, `workflow-permissions`. Each keeps the v0.1 rule contract: a pure
`detect(ctx, { policy, severity })`, declared severity per preset, `skip` with a named code when a
fact is missing, its own `docs/rules/<id>.md` page, and the drift gate.

S3 — `hook-drift` is the only deferred rule whose blocker is design, not implementation: it needs a
baseline and RFC 4.4 forbids local state in v0.1. v1.3 either resolves a baseline that works on a
fresh clone or states explicitly that the rule is out of 0.2. No half-useful version ships.

S4 — Every implementation task in this document runs through ODD: this file, its Engram mirror and
the visible task list before the first write; the RFC (the spec) changes before the code; test-first
where a deterministic check exists; work-unit commits on a feature branch; a task is checked off only
after its outcome and checks were observed. Owner's directive, verbatim: "para imolementar siempre
odd".

S5 — The review record is documentation, not a dangling branch: `odd/review/README.md` states how a
candidate is reproduced (the work unit, its commit, and the lineage when one exists). An oversized
candidate is split for review and the split is recorded there; `review/s1` is not pushed. Rationale:
its content already exists on `main`, and a reconstruction branch on a public repository invites work
against the wrong tree.

S6 — Main is protected now that the repository is public: required checks `test` and `pr-policy`, no
force push, no branch deletion. Until then `CONTRIBUTING.md` is enforced by convention in one place
and by the platform in none. Requires the owner's confirmation, because it changes his own push
rights.

## Tasks

| ID | Task | Spec | Route | Commit |
|---|---|---|---|---|
| T1 | RFC v1.3: the delivery section, 8.3 admitted into 0.2 with F5 order, and `hook-drift` resolved or excluded | S1, S2, S3 | inline | — |
| T2 | `odd/review/README.md`: how a candidate is reproduced and split for review | S5 | inline | — |
| T3 | Delivery pipeline: trusted publishing, provenance, tag-driven release, `prepublishOnly` gate, packed-file check | S1 | inline, after T1 | — |
| T4 | `ci-no-safety-overrides` rule, tests and page | S2 | inline, after T1 | — |
| T5 | `pull-request-target` rule, tests and page | S2 | inline, after T1 | — |
| T6 | `workflow-permissions` rule, tests and page | S2 | inline, after T1 | — |
| T7 | `hook-drift` design, only if T1 admits it into 0.2 | S3 | — | — |
| T8 | Branch protection on `main` with the two required checks | S6 | blocked: owner's confirmation | — |

## Log

L1 — 2026-10-24, owner's request, verbatim: "repo público ya. npm se retrasara por proceso de
seguridad que debo implementar, anti supply chain. Qué recomiendas, empujamos review s1? o ya
empezamos con 0.2?"

L2 — 2026-10-24, owner's decision on the sequencing, verbatim: "RFC v1.3 (release + 9 reglas), luego
implementar".

L3 — 2026-10-24, owner's directive on the workflow, verbatim: "para imolementar siempre odd".

L4 — 2026-10-24, fact checked in this session: the repository was still private when L1 was written
(`gh api repos/MaxGB23/funky-secure` returned `private: true`, an anonymous GET returned `404`, and
branch protection answered "make this repository public to enable this feature"). It was made public
at 04:41 with `gh repo edit --visibility public --accept-visibility-change-consequences` and
confirmed `private: false`. npm provenance requires a public source repository, so S1 depends on it.

L5 — 2026-10-24, recommendation recorded for the review branch: do not push `review/s1` (S5). The two
commits are a reconstruction of content already on `main`; the durable record is the lineage in
`odd/tasks/funky-secure-v0.1.md` L13-L14.
