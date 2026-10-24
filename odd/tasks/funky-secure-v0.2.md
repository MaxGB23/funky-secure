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
| T1 | RFC v1.3: the delivery section, 8.3 admitted into 0.2 with F5 order, and `hook-drift` resolved or excluded | S1, S2, S3 | inline | `9f912db`, PR #4 → `00d8bcb` |
| T2 | `odd/review/README.md`: how a candidate is reproduced and split for review | S5 | inline | `cf1b6c1`, PR #6 → `0b1496e` |
| T3 | Delivery pipeline: trusted publishing, provenance, tag-driven release, `prepublishOnly` gate, packed-file check | S1 | inline, after T1 | `228a832`, PR #8 → `a9a3ac5` |
| T4 | `ci-no-safety-overrides` rule, tests and page | S2 | worker, after T1 | `da98a66`, PR #10 → `a3f132a` |
| T5 | `pull-request-target` rule, tests and page | S2 | worker, after T1 | `21d6f09`, PR #12 → `71835ff` |
| T6 | `workflow-permissions` rule, tests and page | S2 | worker, after T1 | `a1aacca`, PR #14 → `773c877` |
| T7 | `hook-drift` design, only if T1 admits it into 0.2 | S3 | — | dropped: RFC v1.3 keeps it out of 0.2 (8.3, 4.4) |
| T8 | Branch protection on `main` with the two required checks | S6 | blocked: owner's confirmation | — |
| T9 | Close 0.2: `vulnerable` fixture so the golden gate exercises the new fail paths, version `0.2.0`, this document | S1, S2 | inline | this commit |

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

L6 — 2026-10-24, T1 executed: RFC v1.3 in PR #4 (`9f912db`, merged `00d8bcb`), CI green on both
jobs. Section 17 is the delivery contract, 8.3 admits three rules and keeps `hook-drift` out, 16 F5
is rewritten as G1-G4, 19 gains K11-K13, 20 gains decisions 27-31, 21.1 states the `0.2.0`
acceptance, and sections 17-20 are renumbered 18-21 with their three in-text references updated.

L7 — 2026-10-24, T2 executed: `odd/review/README.md` in PR #6 (`cf1b6c1`, merged `0b1496e`). The
candidate is one commit with its four facts (lineage, base, lines, verdict), the split rules for an
oversized unit, the four things never done, and the boundary of what a review decides. S5 is closed
without pushing `review/s1`.

L8 — 2026-10-24, T3 executed: the release pipeline in PR #8 (`228a832`, merged `a9a3ac5`). Two defects
in the new gate were found and fixed before the PR: the guard returned `0` when `npm pack` failed, and
on Windows a `.cmd` shim cannot be spawned without `shell: true` (E7), which made every local run fail.
Recorded as I-11 and I-12. The workflow's shape is asserted by eight tests, and `prepublishOnly` was
run end to end from the suite through the self-scan to the guard.

L9 — 2026-10-24, T4-T6 executed: the three rules in PRs #10, #12 and #14. Each was written test-first
with the RED state observed, then delegated to `gentle-ai-worker` with narrow edit surfaces. Five
parent-side corrections were needed and are part of the record: the catalog-size literal in
`tests/cli.test.js` now derives from `catalog.length`; two defects in the T5 contract test (unescaped
`${{ … }}` inside template literals, and a line-10 assertion for a step on line 9) were fixed by the
parent; a job-level `write-all` now reports the line of that job's `permissions:` key rather than the
job key; and `workflow-permissions-missing` stopped reporting a workflow whose only declarations are
per job, which was a false positive because that job's own block governs it. T5 shared the trigger
parser with R9 (`declaresTrigger`), verified by R9's own suite plus an eleven-spelling differential;
T6 extended the reader with `permissions:`, verified by the ten pre-existing reader tests against both
versions.

L10 — 2026-10-24, T9 closes the feature: `0.2.0` in `package.json`, the `vulnerable` golden fixture so
the three new rules exercise their `fail` paths through the renderer, 312 tests green, drift gate
11/11, self-scan PASS on this repository. Twelve rules. Not done: the tag and the publish (the
owner's decision), branch protection (T8, waiting on him), and the first-publish bootstrap (L11).

L11 — 2026-10-24, open decision found while closing: npm Trusted Publishing binds to a package that
already exists on the registry, so the first publication cannot go through OIDC — `release.yml` would
find nothing to publish to. The first version needs either a one-time granular token, revoked right
after, or a documented first-release path in RFC 17.2. Not decided: it belongs to the owner's
anti-supply-chain process, and inventing the exception without him would be the wrong kind of
thoroughness.
