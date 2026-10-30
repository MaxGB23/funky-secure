# RFC 0026 — a catalogue is not a version

| | |
|---|---|
| **Status** | `implemented` — `pin` leaves a `catalog:` reference alone and counts it apart, `migrate` cites composite actions, and the actions page documents its two skip codes. `0.9.1`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.3 and §11.9, and [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R5, as amended here. |
| **Supersedes** | nothing. It closes a read that 0025 opened and a path 0021 changed. |

## What the measurement found

Three questions had been carried as *not verified* through four releases, and one defect was hiding
behind one of them. All four were measured in scratch directories with real pnpm, never in a clone.

**`pnpm import` reads a berry `yarn.lock`.** A `__metadata: version: 8` lockfile with one exact
dependency produced a `pnpm-lock.yaml` recording `lodash@4.17.21`, offline, in 23 ms. The step `start`
prints for a berry repository was right, and nothing had to change — but the page said it had never
been checked, which is the difference between an untested claim and a false one.

**A `pnpm-workspace.yaml` without `packages:` does not break a workspace pnpm never had.** Four trees
were compared: `workspaces` in `package.json` alone, the same with an empty block, the block carrying
only the managed keys, and the block with `packages:`. The first three produce one importer each; only
`packages:` produces the three importers and the `workspace:^` link. pnpm does not read
`package.json`'s `workspaces` at all — that field belongs to npm and yarn — so creating the managed
block can never degrade a workspace that already worked, and it does not transfer an npm or yarn one
either. `init` continues to write the block only, and this is why that is safe.

**pnpm 10 reads the block.** pnpm 10.16.1 and 12.3.4 both answer `1440`, `4320` and `~` from
`pnpm-workspace.yaml`, and `undefined` outside it. The gate and `savePrefix: ''` are not a block that
only a future major honours.

**`pin` would have written a catalogue version into the manifest.** `catalog:` and `catalog:default`
were classified as floating by `isFloating`, which is shared with `exact-versions`. That rule resolves
a catalogue reference through the map before deciding (0025), so the report was right — but `pin` reads
the predicate directly, so on a root manifest it would have resolved the catalogue's version from the
lockfile and written `"1.3.0"` over `"catalog:"`. That deletes the reference, freezes one dependency
out of a shared catalogue and leaves its siblings reading it: a write that silently changes the shape
of a repository the tool was asked not to reshape.

Two smaller ones came from the same review. `migrate` built its step-5 suggestions from
`repo.workflows` only, so since 0.9.0 read `.github/actions/**` the audit could cite a composite action
that the migration plan never mentioned. And the two skip codes that read produces —
`not-an-action` and `unparseable-action` — appeared in the rule's own `detection` text and in no page.

## The decision

- **A catalogue reference is neither floating nor exact.** `isFloating` answers `false` for it, and
  `pin` counts it in its own list, not among the exact ones: "already exact" would be a different claim
  about the same line. The plan says how many it left alone and why, so a reference that survives is
  visible rather than omitted.
- **`migrate` cites composite actions.** A `uses:` or a `run:` inside `.github/actions/**/action.yml`
  is as followable as one in a workflow. A file with no `runs:` block is not an action and contributes
  no suggestion.
- **The two skip codes are documented** on the rule's page, in the same shape as
  `unparseable-workflow`: a file the tool could not read is not a file it verified.
- **The three measurements move from *not verified* to *measured*** in `docs/validation.md`, and no
  behaviour changes because of them. A measurement that confirms a choice is still the thing that lets
  a user rely on it.

## Why not a wider change

The measurement also showed that a repository migrating from npm or yarn with `workspaces` in its
manifest will need a `pnpm-workspace.yaml` carrying `packages:` for pnpm to treat it as a monorepo.
That is a gap in what `migrate` tells a user, and it is deliberate that this record does not close it
here: transferring patterns from one manager's field into another manager's block is a policy decision
about a repository's shape, and it belongs in its own record with its own measurements on real
migrations. It is recorded as a follow-up instead of smuggled into a bug fix.
