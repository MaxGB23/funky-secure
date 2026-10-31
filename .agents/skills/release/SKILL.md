---
name: release
description: Ship a funky-secure version through a staged candidate, a human approval and a GitHub Release. Use when the owner says a version ships.
---

# Release

Stage it, review it, approve it, then publish the notes. This file is the order a maintainer runs;
[`docs/delivery.md`](../../../docs/delivery.md) §17 is the contract it owes.

## Activation

Runs when the owner says a version ships. It never decides that a version ships, never approves a
candidate, never moves a tag and never runs `npm publish`.

## Preconditions

- A clean tree on `main`, and a gate that was green for the commit the tag will point at.
- `package.json` `version` equals the tag without its `v`; a mismatch exits `2` and stages nothing.
- `npm --version` is 11.15.0 or higher: `npm stage` does not exist before it.
- The account has 2FA enabled for writes.
- The trusted publisher for the package allows `npm stage publish` only.

## The sequence

1. **Green gate on that commit** — the owner. `node --test`,
   `node bin/funky-secure.js scan --scope repo --fail-on warn`, `node scripts/release-guard.js`,
   `node scripts/pack-smoke.js`. All of it runs again inside `prepublishOnly` at stage time.
2. **Push the tag** — the owner. `git tag vX.Y.Z && git push origin vX.Y.Z`, on the commit from
   step 1. `release-guard` compares the tag with `package.json`; a mismatch exits `2` and stages
   nothing.
3. **Stages the candidate** — the release workflow, on `push: tags: ['v*']` over OIDC with no
   credential. It prints the stage id in its step summary and ends. It does not publish.
4. **Reviews the candidate** — the maintainer. `npm stage list`, `npm stage view <id>`,
   `npm stage download <id>`, then `tar -tzf <tarball>` and read the file set against the packed set
   of §17.4. A file that should not ship is a reject, not a note.
5. **Approves or rejects** — the maintainer, under 2FA. `npm stage approve <id>` publishes; nothing is
   installable before it. `npm stage reject <id>` discards the candidate and leaves the tag in place.
6. **Verifies what users get** — the maintainer. `npm view funky-secure@<version>`,
   `npm view funky-secure@<version> dist.integrity`; the second value is what the body records.
7. **Publishes the Release** — the maintainer, after the approval in step 5 and never before. Write
   `RELEASE_NOTES.md`, run
   `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file RELEASE_NOTES.md`, then delete the file.

A prerelease version is staged with `--tag next` and its Release takes `--prerelease`; both are off by
default.

## Release notes

The body **is** the changelog of that version. npm embeds nothing from the tree, so this repository
keeps no `CHANGELOG.md` and no `[Unreleased]` accumulator: the body is the only place a reader meets
the change of a version.

- Assemble it from `git log <last-tag>..HEAD` and the merged pull requests, in English.
- Group under `Added`, `Changed`, `Fixed`, `Docs`, `Removed`; drop a group that is empty.
- Carry the reason inside the entry, because `git log` keeps the what and loses the why.
- Record the commit the tag points at and the `dist.integrity` value in the body.

## Hard rules

- The Release is created after the approval: with release immutability enabled a release freezes its
  tag, so a premature one turns a rejectable candidate into a permanent record.
- `RELEASE_NOTES.md` is transient: passed with `--notes-file` so backticks survive the shell, never
  committed, deleted after success.
- A tag is never moved; a rejected candidate leaves its tag in place as the record of what was not
  released.
- `npm publish` is never used and no npm token exists anywhere, so a stolen workflow reaches a
  queued candidate and never an installable version.
- The integrity recorded is `dist.integrity`, never a sha256 hash of the tarball, which the registry
  does not publish.
- Enable "release immutability" in the repository settings, so the tag binding is enforced rather
  than promised.

## Output

When it finishes, report the version, the tag, the stage id, the approval, the `dist.integrity` value
and the Release URL. When it stops, report which step, why, and what is left pending — a rejected
candidate names its tag, which stays where it is.
