# Delivery and release

> Normative. Extracted verbatim from RFC 0001 section 17 (revision 7). The record is at
> [`../rfcs/0001-funky-secure-v1/rfc.md`](../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the pipeline owes. Change this file, not the record.

## 17. Delivery and release

Added in revision 4; normative from `0.2.0` on. Section 4.5 says the product never mutates the
machine it inspects. This section is the other half of that posture: the product must not become the
weak link in the chain it asks others to fix. Every property below is one a hardened repository
would demand of a dependency, applied to itself.

### 17.1 The publication path is a supply-chain surface

Three things can go wrong between a green suite and a tarball on a registry: the credential that
publishes is stolen, the tag that identifies the release moves, and the artifact that ships is not
what was tested. Each has a structural answer, and none of them is a policy document.

### 17.2 Trusted publishing over OIDC, stage-only, and no long-lived token

- Publication runs through npm Trusted Publishing: the release job presents a GitHub OIDC identity
  and receives a short-lived credential for that run.
- `id-token: write` is granted to the release job and to nothing else. No other workflow declares it.
- No `NPM_TOKEN`, `NODE_AUTH_TOKEN` or npm credential of any kind exists in the repository, its
  `.npmrc`, or its Actions secrets. A long-lived token in a repository is exactly the finding R7
  reports in someone else's, so the product does not carry one.
- The trusted publisher is granted **`npm stage publish` only**. `npm publish` is not among its
  allowed actions, so a compromised workflow can queue a release and cannot make one installable. No
  OIDC token can run `npm stage approve` either; npm reserves approval for a human with 2FA.
- Provenance is generated when the registry supports it. npm attests a public source repository only,
  so a private repository makes provenance impossible: publicity is a delivery requirement, not a
  marketing choice (`odd/tasks/funky-secure-v0.2.md`, L4). Whether an attestation survives a staged
  approval is **unmeasured**, so no release note promises a provenance badge until
  `npm view <name>@<version> dist.attestations` returns one.
- The account requires 2FA for writes, and the package is set to "Require two-factor authentication
  and disallow tokens". The OIDC path never uses an interactive session.
- The release job installs npm 11.15.0 or later explicitly: `npm stage` does not exist before it, and
  the npm bundled with Node 24.16 is 11.13.0.

**First publication, measured 2026-10-31.** A trusted publisher is configured on a package, and a
 package only exists after a first publish, so the first version cannot be staged by a trusted
 publisher (npm/cli#8544, open). Staged publishing narrows that gap without closing it: staging a name
 that does not exist publishes a public placeholder `0.0.0-stage`, which claims the name. The
 bootstrap is therefore stated as a sequence instead of assumed:

1. The owner stages the **first** version once from a local session: `npm login`, then
   `npm stage publish --access public`. This claims the name and queues the version. A local session
   cannot produce provenance, which is what makes step 3 safe.
2. The owner configures the trusted publisher for the package: GitHub Actions, repository
   `MaxGB23/funky-secure`, workflow `release.yml`, `npm stage publish` only. The local session is ended
   afterwards, and no credential survives it.
3. The owner rejects the locally staged candidate with 2FA (`npm stage reject <id>`) and pushes the
   tag. The release job stages the same version over OIDC, so the version that ships is the one the
   pipeline produced, and §17.3's order holds from the first release.
4. If the trusted-publisher page does not appear for a package whose only published version is the
   placeholder, step 3 is skipped: the local candidate from step 1 is approved with 2FA instead. That
   version is then the one release in this project's history published without OIDC, it carries no
   tag, and the tag convention starts at the next version.

Re-staging a rejected version is not guaranteed when the rejected candidate carried a provenance
attestation: the number can be burned. Step 1 carries none, which is why the sequence is safe, and the
fallback in step 4 costs at most the number nobody could download yet.

### 17.3 Tag-driven, immutable releases, approved by a human

- A release is triggered by pushing a `vX.Y.Z` tag. The tag string and `package.json` `version` must
  be identical; a mismatch exits `2` and publishes nothing.
- The release workflow runs on `push: tags: ['v*']` only. It is never reachable from `pull_request`
  or from a branch push, which is why a malicious pull request cannot reach the publish job even
  after it merges (the subject of R9, applied here).
- The workflow stages; it does not publish. `npm stage publish` queues the tarball and the job ends
  with the stage id in its step summary, because approval happens after the job. A maintainer reviews
  it with `npm stage list` and `npm stage download`, and publishes it with `npm stage approve <id>`
  under 2FA. Until that approval the version is not installable.
- The ordering is fixed: green gate on the commit, then the tag, then the staged candidate, then the
  approval. A red gate means no tag, and a tag is never moved afterwards — a correction is a new patch
  version. A rejected candidate leaves its tag in place as the record of what was not released.
- The release body records the tarball `sha256` and, when the registry returns one, the provenance
  URL, so a later audit can bind the published bytes to the commit that produced them without trusting
  this document.

### 17.4 The prepublish gate is the product running on itself

`prepublishOnly` runs, in this order: the full `node --test` suite, the drift gate, the self-scan at
`--fail-on warn`, and the packed-file check. A package that fails its own audit cannot be published,
by construction rather than by discipline.

The packed-file check compares the `npm pack --dry-run --json` file list with the `files` contract of
section 14: `bin/`, `src/`, `skills/`, `docs/cli.md`, `docs/guide.md`, `docs/concept.md`,
`docs/rules/`, `docs/images/diagram.jpg`, `./README.md`, `LICENSE` and `package.json`. Any other entry
fails the release. The `./` anchor is not cosmetic: npm reads a bare `README.md` as a basename glob
and packs `docs/README.md` with it. A fixture, a golden, a stray note or a `.env` that reached the tree
is a defect the release must not discover in public.

Staging does not weaken this gate: `npm stage publish` is `npm publish` with `static stage = true`, so
`prepublishOnly` runs exactly as it does for a direct publish. The suite, the self-scan, the guard and
the smoke test all run before anything is queued.

### 17.5 Version and release notes

- Semantic versioning. `0.x` may break in a minor, and a break is declared with the
  `type:breaking-change` label and a migration note in the release body.
- The release body is the changelog of that version: it names every rule added, changed or removed,
  every severity deviation from 9.1, and every user-visible message that changed.
- `version` and the tag are checked against each other, and the tag is the only source of the
  published version string.
- **A version is defined by the commit its tag points at.** Before that tag exists, the number in
  `package.json` is a name for work in progress and may move under it; after the tag, it names one
  byte sequence and never moves again. Two consequences that a field session met and no flow test can
  see: a source change landing after a version's number was set is part of that version only if the
  tag comes after it, and a tarball built before the tag is **not** that version — rebuild it from the
  tagged commit, and reinstall any local copy from that tarball, before checking what a user will get.

### 17.6 What automation does not decide

Publication is a human decision with a mechanical precondition. The owner decides that a version
ships and pushes the tag; the pipeline decides whether that tag may produce a tarball. Provenance
proves who built what from which commit, never that the code is safe — and this document says so
explicitly, because a supply-chain auditor that overclaims its own guarantees is making the mistake it
reports.

### 17.7 The release path is tested

A test asserts the workflow's shape (15.4): it triggers on tags only, it never runs on
`pull_request`, `id-token: write` appears in the release job and nowhere else, and no token name
appears in the file. A delivery contract that no test reads is a comment.

---
