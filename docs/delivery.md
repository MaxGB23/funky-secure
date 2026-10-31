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

### 17.2 Trusted publishing over OIDC, and no long-lived token

- Publication runs through npm Trusted Publishing: the release job presents a GitHub OIDC identity
  and receives a short-lived credential for that run.
- `id-token: write` is granted to the release job and to nothing else. No other workflow declares it.
- No `NPM_TOKEN`, `NODE_AUTH_TOKEN` or npm credential of any kind exists in the repository, its
  `.npmrc`, or its Actions secrets. A long-lived token in a repository is exactly the finding R7
  reports in someone else's, so the product does not carry one.
- Provenance is generated for every published version (`--provenance`). npm attests a public source
  repository only, so a private repository makes provenance impossible: publicity is a delivery
  requirement, not a marketing choice (`odd/tasks/funky-secure-v0.2.md`, L4).
- The account requires 2FA for writes. The OIDC path never uses an interactive session.

**First publication, measured 2026-10-31.** npm has no trusted publisher for a name that does not
 exist yet: the settings page lives on the package, and the package only exists after a first
 publish. There is no pending-publisher mechanism (npm/cli#8544, open). So a version-1 release has one
 step this section cannot perform, and the bootstrap is stated instead of assumed:

1. The owner publishes the **first** version once, from the commit the gate passed, out of band
   (`npm login`, `npm publish`). That artifact carries no provenance — the one release for which that
   is true, and the reason it is spelled out here.
2. The owner then configures the trusted publisher for the package: GitHub Actions, repository
   `MaxGB23/funky-secure`, workflow `release.yml`.
3. Every version after it follows §17.2 unchanged, with `--provenance`, and no credential exists
   anywhere again.

For that first version only, §17.3's order inverts: publish first, then push the tag, because the tag
runs a job that cannot authenticate until step 2 exists. From the second version on the order stands
as written — green gate, tag, publication — and a tag is still never moved.

### 17.3 Tag-driven, immutable releases

- A release is triggered by pushing a `vX.Y.Z` tag. The tag string and `package.json` `version` must
  be identical; a mismatch exits `2` and publishes nothing.
- The release workflow runs on `push: tags: ['v*']` only. It is never reachable from `pull_request`
  or from a branch push, which is why a malicious pull request cannot reach the publish job even
  after it merges (the subject of R9, applied here).
- The ordering is fixed: green gate on the commit, then the tag, then publication. A red gate means
  no tag, and a tag is never moved afterwards — a correction is a new patch version.
- The release body records the tarball `sha256` and the provenance URL, so a later audit can bind
  the published bytes to the commit that produced them without trusting this document.

### 17.4 The prepublish gate is the product running on itself

`prepublishOnly` runs, in this order: the full `node --test` suite, the drift gate, the self-scan at
`--fail-on warn`, and the packed-file check. A package that fails its own audit cannot be published,
by construction rather than by discipline.

The packed-file check compares the `npm pack --dry-run --json` file list with the `files` contract of
section 14: `bin/`, `src/`, `docs/`, `skills/`, `README.md`, `LICENSE` and `package.json`. Any other
entry fails the release. A fixture, a golden, a stray note or a `.env` that reached the tree is a defect the
release must not discover in public.

### 17.5 Version and release notes

- Semantic versioning. `0.x` may break in a minor, and a break is declared with the
  `type:breaking-change` label and a migration note in the release body.
- The release body is the changelog of that version: it names every rule added, changed or removed,
  every severity deviation from 9.1, and every user-visible message that changed.
- `version` and the tag are checked against each other, and the tag is the only source of the
  published version string.

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
