# funky-secure v0.3 — a CI that pins what must not move, and stops promising EOL Node

Specification: `rfcs/funky-secure-rfc.md`, revision 5 (v1.4, written by T1). The RFC is normative;
this document tracks execution and records only decisions and evidence taken during implementation.
Branch: `feat/v0.3`.

## Specs

S1 — The declared floor becomes a runtime that still receives security fixes: `engines.node` is
`>= 22`, and the CI matrix runs the floor and the Active LTS (`[22, 24]`). This is a breaking package
contract change, so it ships as `0.3.0`, and the RFC says so before the code does.

S2 — Actions are pinned to the release that is current when this ships, by full commit SHA with the
version in a trailing comment, and the bump procedure is written where a maintainer will find it
(there is no Dependabot in this repository). Verified at decision time: `actions/checkout v7.0.1`
(`3d3c42e5aac5ba805825da76410c181273ba90b1`), `actions/setup-node v7.1.0`
(`949feb2413d6458794dcd2491c4babbbce0c15c1`), `pnpm/action-setup v6.1.0`
(`ea17c68df8912ef543352723c149a84f56e3d413`).

S3 — Runner labels are exact, not `-latest`: `ubuntu-24.04` and `windows-2025`. Pinning the label does
not opt out of OS patches; it opts out of a major-image migration turning a green suite red on
GitHub's schedule.

S4 — `setup-node` runs with `check-latest: true`, so the newest patch of the line is fetched instead of
the one cached in the runner image, and an upstream security fix lands without editing the workflow.

S5 — `pnpm/action-setup` stays: the self-scan reads the answering pnpm version, and without it
`package-manager-pin` degrades to `skip` in CI, which would soften the gate silently. The
`pnpm install --frozen-lockfile` step goes: with zero dependencies it resolves nothing and costs
about ten seconds per leg.

S6 — `.gitattributes` also marks the binary extensions the project may one day ship, alongside the
`* text=auto eol=lf` line that already keeps the byte-comparing golden gate meaningful.

S7 — Branch protection is declared only after the check names are final, because it matches by exact
name; the same order applies to `funky-forge`.

## Tasks

| ID | Task | Spec | Route | Commit |
|---|---|---|---|---|
| T1 | RFC v1.4: the floor, the matrix and the CI pinning policy as normative | S1, S2, S3, S4, S5, S6 | inline | `ddc1cf6`, PR #20 → `4bb7e99` |
| T2 | Implementation: `engines`, matrix, labels, SHAs, `check-latest`, dropped install step, `.gitattributes`, `0.3.0` | S1-S6 | inline | `92c560f`, PR #22 → `361a68b` |
| T3 | Branch protection on `main` with the final five check names | S7 | blocked: owner's go-ahead | — |
| T4 | `funky-forge`: stabilise its check names, then protection and contribution templates | S7 | blocked: separate repository, needs the owner's authorization | — |

## Log

L1 — 2026-10-24, owner's request, verbatim: "quiero que revises la memoria "ID: 1587 — scope global,
tipo config, topic key ci/github-actions/tests-only-pinning." para que me digas si estas de acuerdo en
usar lo mismo que funky-forge, esto es antes de crear la branch protection, ya que en ese repo no tengo
branch protection y sería bueno añadirlo, creo que tampoco tengo plantillas de contribucion".

L2 — 2026-10-24, owner's decision on the floor, verbatim option chosen: "Piso a >=22 y matriz [22, 24]".
It is a breaking contract change, so it ships as `0.3.0` and the RFC changes first (S1).

L3 — 2026-10-24, review of memory 1587 against this repository, with the API checked rather than the
note trusted: the pins in the note are current (`actions/checkout v7.0.1`, `actions/setup-node v7.1.0`)
and this repository was two majors behind at `# v4`. `pnpm/action-setup` is not in the note; its
current release is `v6.1.0`. Node's own release index at review time lists `24` as Active LTS
(Krypton) and `22` as LTS (Jod), so the declared floor `>= 20.11` promised a runtime without security
fixes — the finding that produced L2.

L4 — 2026-10-24, three points of the memory deliberately not adopted: its "no install step" recipe
drops the pnpm setup, which this repository needs because the self-scan reads the answering pnpm
version (only the `pnpm install` step is dropped, S5); its suggestion to validate a workflow with the
repository's own YAML parser does not apply, because this repository has no YAML parser by decision
and already asserts the workflow shape in `tests/release-workflow.test.js` and
`tests/ci-coverage.test.js`; and its Node matrix is not copied blind — the floor is a contract decision
(L2), not a recipe.

L5 — 2026-10-24, T1 and T2 executed: RFC v1.4 in PR #20 (`ddc1cf6`, merged `4bb7e99`) and the
implementation in PR #22 (`92c560f`, merged `361a68b`). The four legs are green on
`ubuntu-24.04`/`windows-2025` at Node 22 and 24, which is the first time the declared floor has been
executed rather than assumed. 318 tests, drift gate 11/11, self-scan PASS. The six coverage tests failed
on four assertions before the workflows changed (binary markers, exact labels, floor plus Active LTS,
`check-latest`), which is the RED state this task was written against.
