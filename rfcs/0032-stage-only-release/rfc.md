# RFC 0032 — stage-only publication and the packed set

| | |
|---|---|
| **Status** | `accepted` — the owner agreed on 2026-10-31; this body is fixed from here. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/layout.md`](../../docs/spec/layout.md) §14.1, [`docs/delivery.md`](../../docs/delivery.md) §17.2 and §17.3 |
| **Supersedes** | nothing |
| **Amends** | [`0001`](../0001-funky-secure-v1/rfc.md) §14 and §17 |
| **Superseded by** | nothing |

> The normative text of both amended sections lives in `docs/spec/` and `docs/delivery.md`. This
> record holds the decision and the reasoning; the contract is what the code owes.

## 1. The problem

Record 0001 decided §17 before npm offered a way to separate *authentication* from *publication*. It
chose direct publication over OIDC from a `v*` tag, accepted an out-of-band `npm publish` for the
first version, and left the package contents to `package.json` alone. Three consequences, measured at
`150b92e` on 2026-10-31:

1. **The tag was the release.** Nothing human stood between a merged commit and the registry. A
   compromised maintainer account, a hostile workflow change or a malicious pull request merged with
   one approval all reached users without anyone looking at the artifact.
2. **The first version needed a credential.** A trusted publisher is configured on a package, and a
   package exists only after a first publish, so the contract had no first step it could perform.
3. **The package shipped its own development record.** 82 files, 404 kB, 934 kB unpacked, of which
   `docs/` was 528 kB. One JPEG was 168.629 B — 41% of what a user downloads — and `spec/`,
   `decisions.md`, `validation.md`, `field-loop.md` and `architecture.md` travelled to every user.

## 2. What changed outside this project

- Staged publishing became generally available on 2026-05-22. `npm stage publish` queues a version;
  `npm stage approve` publishes it under 2FA. Staging needs no 2FA; approving always does.
- Trust relationships became granular. `npm stage publish` is always allowed; `npm publish` and
  dist-tag management are separate, optional permissions. No OIDC token can run `npm stage approve`,
  because npm reserves approval for proof of presence.
- npm's own documentation names stage-only plus "Require two-factor authentication and disallow
  tokens" the maximum available posture.
- Staging a name that does not exist publishes a public placeholder `0.0.0-stage`, which claims it.
- `npm stage publish` is `npm publish` with `static stage = true`, and `publish.js` fires
  `prepublishOnly` in both paths, so the §17.4 gate is not weakened by staging.

## 3. The decision

**§17.2.** Publication runs through a trusted publisher granted `npm stage publish` only, with
`id-token: write` on the release job alone, no npm credential anywhere, 2FA required on the account,
and the package configured to disallow tokens. The release job installs npm 11.15.0 or later
explicitly, because `npm stage` does not exist before it and the npm bundled with Node 24.16 is
11.13.0. Provenance is claimed only when the registry returns one: whether an attestation survives a
staged approval is unmeasured, and a delivery document that overclaims its own guarantees is making
the mistake this product reports in others.

**§17.2, first version.** The bootstrap is a sequence rather than an exception. Stage the first
version once from a local session to claim the name, configure the trusted publisher off the
placeholder, reject the local candidate with 2FA, then push the tag so the version that ships is the
one the pipeline staged over OIDC. A local session cannot produce provenance, which is what makes
re-staging safe. If the trusted-publisher page does not appear for a placeholder-only package, the
local candidate is approved instead, that one version carries no tag, and the tag convention starts at
the next version.

**§17.3.** A `vX.Y.Z` tag stages; it does not publish. The job ends with the stage id in its step
summary because approval happens after it. A maintainer reviews with `npm stage list` and
`npm stage download` and publishes with `npm stage approve <id>` under 2FA; until then the version is
not installable. The ordering is green gate, tag, staged candidate, approval. A tag is never moved,
and a rejected candidate leaves its tag as the record of what was not released.

**§14.** The packed set is stated instead of implied: `bin/`, `src/`, `skills/`, `docs/cli.md`,
`docs/guide.md`, `docs/concept.md`, `docs/rules/`, `docs/images/diagram.jpg`, `README.md`, `LICENSE`.
`docs/rules/` is mandatory because every rule module declares `docs/rules/<id>.md` and `explain`
prints that path in both formats, so a package without those pages names documents that are not
there. The development record stays in the public repository. The README image ships because npm
renders the README, and it is not recompressed to buy bytes.

## 4. The enforcement

A contract that no test reads is a comment, so each obligation has one:

- The workflow's shape: tags only, never `pull_request`, `id-token: write` exactly once, no token
  name, every action pinned to a commit sha, the tag check before the stage.
- `prepublishOnly` still runs the suite, the self-scan, the guard and the pack smoke test.
- Every `docs/rules/<id>.md` the catalog declares must appear in the list npm would pack. This is the
  assertion the old contract lacked: `checkPackList` compares the packed set against `files`, so it
  follows a narrowing of `files` silently and cannot notice a page left behind.

## 5. What this record does not decide

Delivery mechanics remain the owner's: commit, tag, approval and release notes are human decisions,
and the review lifecycle is not a publication gate. The public package name, the first tag and the
moment of publication are not automated by anything in this repository.

## Errata

**2026-10-31.** Two clauses above are corrected here; the body stays as written.

- **§17.3, the Release.** The GitHub Release is a post-approval human step, never a CI step. With
  release immutability enabled a release freezes its tag, so a Release created before the approval
  would turn a candidate that can still be rejected into a permanent record. The repository enables
  release immutability so the tag binding is enforced rather than promised.
- **§17.3, the integrity.** The integrity recorded in the body is `dist.integrity` (SHA-512 SRI),
  because the registry publishes no `sha256` of the tarball. The step-by-step procedure is the
  runbook at `.agents/skills/release/SKILL.md`.
