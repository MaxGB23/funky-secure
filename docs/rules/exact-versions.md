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
- is an `npm:` redirect whose target is not exact (`npm:pkg@^1.2.3`);
- is a `catalog:` or `catalog:<name>` specifier whose catalogue entry holds a range.

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

**Catalogues.** `catalog:` is the `default` catalogue and `catalog:<name>` is a named one; both are a
map `pnpm-lock.yaml` mirrors from `pnpm-workspace.yaml` as `{ specifier, version }` per dependency.
The specifier is floating exactly when that entry's `specifier` is a range, so a catalogue that pins
`chart.js: 3.3.2` makes every `catalog:app` reference to it exact. A floating catalogue entry is
reported at `pnpm-workspace.yaml` and never at the `package.json` line that refers to it: that line
is `catalog:app`, and rewriting it would detach the dependency from the catalogue instead of pinning
it. The message names the `package.json` that uses the catalogue, the catalogue, and the range it
holds; `line` is omitted, because the range's line is in a file this rule reads as a map, not as
lines. A catalogue entry the lockfile does not record is not reported at all: the file that would
hold the range is unknown, and a remediation this rule cannot justify is worse than a missed finding.

**Lockfile comparison.** Every specifier is compared with what `pnpm-lock.yaml` records for the same
importer **and the same kind**: `importers.<dir>.specifiers.<name>` first (that map is kind-agnostic),
then `importers.<dir>.<section>.<name>` for the section the entry lives in. A disagreement is one
`lockfile-desync` finding.

Two records that look like disagreements are not, and the rule reports neither:

- **A kind the lockfile does not record.** An importer block carries no `peerDependencies` at all —
  pnpm 9 writes a peer set in the snapshot, never in the importer — so a peer specifier has no recorded
  counterpart to disagree with. Comparing it anyway matched the name against the *devDependency*
  record of the same package, which is a different declaration.
- **A name the lockfile records under another section.** pnpm writes one entry per dependency per
  importer, so a package declared in both `dependencies` and `devDependencies` has one record; the
  second entry is not a missing record.

A dependency the lockfile does not record at all — not under any kind — is a desync with
`resolved: null`.

**Overrides.** An `overrides` section rewrites a specifier on purpose, so the lockfile record
disagrees with the manifest by construction. The rule reads the section's selectors (`@types/react`,
`foo@^1`, `parent>child` names its child) and reports no desync for a dependency an override touched.
The comparison still runs for every other dependency: the section used to refuse the whole lockfile,
which left 245 specifiers across 7 importers uncompared on shadcn-ui/ui — where every one of the 8
desyncs the old comparison reported was one of these two records. The fixed comparison compares all
245 and reports none.

The comparison uses `src/lib/lockfile.js`, the bounded indent reader that needs no YAML dependency. It
reads `lockfileVersion` `6.0` (the pnpm 8 shape, whose root importer is recorded in the top-level
`dependencies`/`devDependencies` sections instead of under `importers`) and `9.0`, the `importers`
map, the `catalogs` map, and the `overrides` selectors. A shape outside that subset — another
`lockfileVersion`, `patchedDependencies`, a catalogue entry that is not a `{ specifier, version }`
map, a document that describes the root importer twice — is never compared: the rule reports the
floating findings it did establish and adds one `skip: unsupported-lockfile-shape` for the
comparison. That skip names `pnpm-lock.yaml` and keeps the line the reader stopped at
(`skipped: expected "key: value" at line 3`), because a line number with no file is not something a
reader can open. With no lockfile at all it reports the same floating findings plus one
`skip: no-lockfile`.

**A truncated lockfile is not a supported one.** The reader stops at the subset it needs, so a document
cut inside a block used to parse as the part it managed to read. pnpm writes every flow collection on
one line, so a `{` that outlives its line, and a key with no entry under it where the document ends,
are truncations rather than shapes. Both are refused, in the reader's own words —
`the document ends inside a block: "packages" at line 40 opens a map with no entry` and `the "{" opened at line 42 is never closed` — and the
comparison becomes a `skip: unsupported-lockfile-shape` on `pnpm-lock.yaml` instead of a comparison
against half a file.

**A manifest the rule cannot interpret is named, one file at a time.** An importer whose
`package.json` exists and cannot be parsed is its own `skip: unparseable-package-json`, naming that
file and what is wrong with it — a byte-order mark in its own words, as in
`skipped: packages/api/package.json is not valid JSON (Unexpected end of JSON input), so its specifiers were not compared against pnpm-lock.yaml` —
instead of one global skip that says nothing about which importer is missing from the comparison. That
importer's specifiers are not compared and every other importer's still are; the skip is an
unavailable probe, so `--strict-probes` turns it into an error rather than accepting a slightly
smaller comparison. A repository with no importer at all — no root `package.json` and no workspace
package — reports one `skip: unreadable-package-json` instead of a pass (and `no-lockfile` when there
is no lockfile either), because a clean claim about specifiers it never read would be a false
negative.

**A refused workspace entry is reported.** A `packages:` entry in `pnpm-workspace.yaml` that resolves
outside the repository root is refused before any file under it is read, and the refusal reaches the
report as `skip: workspace-entry-outside-root` on `pnpm-workspace.yaml`, naming the entry and why it
was refused. The importer it would have produced disappears either way; without that line it would
disappear without a word, which is the quieter form of a defect this repository already fixed once
(0022, 0027). A nested glob or a `!` negation is **not** reported as a refusal: the single-level
expansion is a documented limitation, and saying a negation's directories were not read would be false.

A specifier can carry a secret: a private tarball URL such as `https://user:token@host/pkg.tgz`
is echoed as `https://***@host/pkg.tgz`, so a scan never prints a credential.

No floating specifier and no desync is a pass.

## Evidence

- `floating-range`: `{ specifier, dependency, type }`, where `type` is the section the entry lives in.
  A catalogue range carries the range the catalogue holds, and `catalog` names the catalogue.
- `lockfile-desync`: `{ specifier, resolved }`, where `resolved` is the specifier recorded in the
  lockfile, or `null` when the dependency is missing from it.

## Remediation

Manual, one command per finding, and the command names a version the repository already records.

**A floating range.** `pnpm add --save-exact <name>@<range>` is a measured no-op on pnpm 12.3.4: pnpm
keeps the specifier the package already declares and exits 0, so the range survives and the finding
comes back. The command that works is

```sh
pnpm -C <importer dir> pkg set 'devDependencies["<name>"]=<version>' && pnpm -C <importer dir> install
```

with the section of the entry (`dependencies`, `devDependencies`, `optionalDependencies` or
`peerDependencies`), the package name as written — a scoped name keeps its `@scope/` prefix — and the
version `pnpm-lock.yaml` records in that importer's dependency block. `pnpm install` then refreshes
the lockfile and `node_modules` from the new specifier.

The `-C <importer dir>` is not decoration. `pnpm pkg set` acts on the manifest of the directory it
runs in, so a command printed for a finding at `cli/package.json` and run at the repository root
writes into the **root** `package.json` — measured on create-t3-app, where it is 80 of 96 findings.
`<importer dir>` is the directory of the manifest the finding is about, relative to the repository
root. The root importer keeps the bare form (`pnpm pkg set … && pnpm install`), because the root is
the directory the reader is already in.

That version is the only one this rule may print: it is read from the repository, and the tool
resolves nothing (RFC 4.9). When the lockfile records no version for the dependency — no lockfile, an
unsupported shape, or the inline dependency form — the remediation resolves first and re-measures:

```sh
pnpm install --lockfile-only && funky-secure scan --only exact-versions
```

That step writes the lockfile rather than a manifest, so it stays workspace-wide and carries no `-C`.

**A catalogue range** is a `pnpm-workspace.yaml` edit, because the `package.json` that refers to the
catalogue holds `catalog:app` and not a version:

```sh
edit pnpm-workspace.yaml and set catalogs["app"]["<name>"] to <version>
```

with `catalog["<name>"]` for the `default` catalogue, and the version the catalogue entry records.
pnpm 9.6.0 has no command that writes a catalogue entry, so the tool names the file and the property
instead of inventing one.

**A desync** is refreshed with `pnpm install --lockfile-only`.

There is no auto fix. Rewriting a range in `package.json` without re-resolving is how a lockfile
desync is created, so the fix and the resolution must happen in one `pnpm` command.

## Limits

- The rule resolves nothing and dates nothing. It answers about text and records, not about what a
  registry currently serves.
- A specifier shape this rule does not recognize is not reported. A guessed finding is worse than a
  missed one; the named floating forms are the contract. A `catalog:` specifier whose catalogue entry
  the lockfile does not record is in that class.
- A peer dependency is compared only when the lockfile records its kind. An importer block records
  none, so today a peer specifier is not compared at all rather than compared against a record that
  belongs to a different declaration.
- A dependency an override rewrote is never reported as a desync, and a dependency the lockfile
  records under a second section is not reported as missing. Both are records the format made, and a
  finding against them would be a finding against pnpm.
- An unsupported lockfile shape degrades to a skip; it never produces a comparison the reader cannot
  justify, and the skip names `pnpm-lock.yaml` so the line it reports can be opened. A future pnpm
  major that moves the shape therefore degrades instead of lying.
- A truncated lockfile is refused only where the cut leaves a trace: a key with no entry under it, or a
  flow collection that does not close on its line. A cut at a line boundary that leaves every block it
  opened closed is not detectable without inferring which sections a lockfile should have, and that
  inference would refuse a valid lockfile whose section happens to be short, so it is not made: such a
  document is compared as the document the reader read.
- The workspace expander reads one level. An entry that resolves outside the repository root is refused
  and reported; a nested glob or a `!` negation is neither expanded nor reported, so its directories
  are simply not importers of this run.
- The rule does not judge whether an exact version is *good* — only whether it is exact and whether
  the lockfile agrees with it.
