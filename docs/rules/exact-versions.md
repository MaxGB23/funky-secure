# Dependency specifiers are exact

Rule id: `exact-versions`

## Question

Are dependency specifiers exact, and does the lockfile agree?

A range is a standing permission: `^2.9.0` lets every future published version into the tree under a
lockfile refresh. An exact specifier is a reviewable decision, and a lockfile that records a
different specifier than `package.json` is a resolution the next `pnpm install` will silently
change.

## Detection

For every importer with a parsable `package.json` — the root and each workspace package resolved from
`pnpm-workspace.yaml` — walk `dependencies`, `devDependencies`, `optionalDependencies` and
`peerDependencies`.

A specifier is **floating** when it:

- starts with `^`, `~`, `>`, `<` or `*`;
- equals `latest` or another dist-tag;
- contains an `x`/`X` version token (`1.x`, `1.2.x`);
- is a partial version (`1`, `1.2`) — npm resolves it as a range;
- is a union or hyphen range (`1 || 2`, `1.2.3 - 1.5.0`);
- is a git, tarball or URL specifier: `git+…`, `git:`, `github:`, `gitlab:`, `bitbucket:`, `http…`,
  `file:…`;
- is an `npm:` redirect whose target is not exact (`npm:pkg@^1.2.3`).

A specifier is **exact** when it is a literal version (`1.2.3`, `2.0.0-rc.1+build`), an
`npm:<pkg>@<version>` redirect, `workspace:*`, or `link:…`.

**Decision on `workspace:` and `link:`.** `workspace:*` is a pinned internal link and counts as
exact, and `workspace:1.2.3` is a literal pin like any other literal version. `workspace:^` and
`workspace:~` are ranges — they follow the workspace package across versions — and count as floating.
`link:` is a live local link, the same internal class as `workspace:*`, so it counts as exact and is
not reported. `file:` is different: it pins a path, not
a version, and its contents move with the working tree, so it counts as floating along with the
git/tarball/URL specifiers the RFC names.

Each floating specifier is one `floating-range` finding. `path` is the importer's repo-relative
`package.json` (`.` becomes `package.json`), and `line` is computed from the parsed file text as the
1-based line of that key inside its section — never guessed, and omitted when it cannot be
attributed.

**Lockfile comparison.** Every specifier is compared with what `pnpm-lock.yaml` records for the same
importer: `importers.<dir>.specifiers.<name>` first, then the importer's dependency block when the
`specifiers` map does not carry the name. A disagreement is one `lockfile-desync` finding, and a
dependency the lockfile does not record at all is a desync with `resolved: null`.

The comparison uses `src/lib/lockfile.js`, the bounded indent reader that needs no YAML dependency
and understands only `lockfileVersion: '9.0'`, importer specifiers and importer dependency blocks.
A shape outside that subset — another `lockfileVersion`, `catalogs`, `overrides`,
`patchedDependencies` — is never compared: the rule reports the floating findings it did establish
and adds one `skip: unsupported-lockfile-shape` for the comparison. With no lockfile at all it
reports the same floating findings plus one `skip: no-lockfile`.

No floating specifier and no desync is a pass.

## Evidence

- `floating-range`: `{ specifier, dependency, type }`, where `type` is the section the entry lives in.
- `lockfile-desync`: `{ specifier, resolved }`, where `resolved` is the specifier recorded in the
  lockfile, or `null` when the dependency is missing from it.

## Remediation

Manual, one command per finding: `pnpm add --save-exact <name>@<specifier>` re-resolves the offender
and pins the exact version. The command names the current specifier rather than a version this tool
would have to invent: resolving a version is a network call, and the tool makes none (RFC 4.9).

A desync is refreshed with `pnpm install --lockfile-only`.

There is no auto fix in v0.1. Rewriting a range in `package.json` without re-resolving is how a
lockfile desync is created, so the fix and the resolution must happen in one `pnpm` command.

## Limits

- The rule resolves nothing and dates nothing. It answers about text and records, not about what a
  registry currently serves.
- A specifier shape this rule does not recognize is not reported. A guessed finding is worse than a
  missed one; the named floating forms are the contract.
- `peerDependencies` are compared like any other section. A lockfile that does not record a peer
  dependency reports a desync rather than an assumed agreement.
- An unsupported lockfile shape degrades to a skip; it never produces a comparison the reader cannot
  justify. A future pnpm major that moves the shape therefore degrades instead of lying.
- The rule does not judge whether an exact version is *good* — only whether it is exact and whether
  the lockfile agrees with it.
