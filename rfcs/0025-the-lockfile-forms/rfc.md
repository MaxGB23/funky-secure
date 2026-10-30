# RFC 0025 — the lockfile forms real repositories have

| | |
|---|---|
| **Status** | `implemented` — the reader understands the pnpm 8 root shape and the `catalogs` map, and the comparator stops inventing desyncs. `0.9.0`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R5, as amended here. |
| **Supersedes** | nothing. It widens a reader that was written against one shape. |

## What the field round found

Two of the five cloned repositories could not be checked at all, and one was checked wrongly.

**The pnpm 8 shape was invisible.** `vercel/nextjs-subscription-payments` carries
`lockfileVersion: '6.0'`: top-level `dependencies`/`devDependencies` with `specifier` and `version` per
entry, no `importers:`. The reader supported only the 9.0 importer layout, so every one of its 26
floating ranges came back as *"the lockfile records no version, so it is not pinned"* — a false
statement about a file that records all of them — and `pin` wrote nothing, which meant the canonical
path could not clear a single range on any pnpm-8 repository.

**`catalogs` refused a comparison it could make.** `primefaces/primevue` declares `catalog:` and
`catalogs:` in `pnpm-workspace.yaml`. The lockfile's top-level `catalogs:` blocked the whole reader, so
the importer comparison never ran on 245 specifiers, while 34 `catalog:` specifiers were reported as
floating — 13 of them false, because the catalogue pins them exactly.

**The comparator invented desyncs.** On a copy of `shadcn-ui/ui` with the `overrides` refusal lifted,
it produced 8 desyncs of which 7 were false: pnpm 9 never records `peerDependencies` in importer
blocks, so a peer specifier was compared against the *devDependency* record of the same name, and a
specifier an override rewrote disagrees with the manifest by construction. The refusal was, until now,
the only reason those false positives stayed invisible.

## The decision

- **Read the 6.0 root shape**, normalising its top-level dependency sections into importer `.`. A
  document that describes the root importer twice is refused, because two answers for one importer is
  worse than no answer.
- **Read `catalogs` and resolve through it.** `catalog:` and `catalog:<name>` stop being floating when
  the catalogue entry records an exact version; a catalogue *range* is reported at
  `pnpm-workspace.yaml` — the file that holds it — instead of a manifest line that cannot be made
  exact. The importer comparison no longer depends on the section at all.
- **Compare like with like.** A desync is reported only for the same dependency kind in the same
  importer, never for a peer absence, never for a name recorded under another section, and never for a
  specifier an override rewrote. A prefix range selector in `overrides` (`pkg@>=1`) counts as touching
  the name.
- **Lift the `overrides` refusal**, but only after the comparator was fixed and measured clean: 245
  specifiers across 7 importers, 0 desyncs on the real clone. Order matters — the refusal was
  protecting the tool from its own comparator.
- **`patchedDependencies` stays refused**, and it stays the shape the skip fixture is built on.

## What it costs

A reader that understands more shapes has more ways to be wrong about them, so each supported shape
carries a fixture cut from a real lockfile rather than written by hand — the lesson of the peer suffix
(0014) and of `bundledDependencies` (0012), both of which came from inventing the fixture.

## Verification

- `pin` on the pnpm-8 clone: `0 writes` before, `1 write · pins 26 specifiers to the version
  pnpm-lock.yaml records` after, with peer suffixes cut.
- `--only exact-versions` on the `catalogs` clone: 81 findings + 1 skip before, 68 findings and 0 skips
  after, 21 of them at `pnpm-workspace.yaml`, and none for the 13 exact catalogue entries.
- `--only exact-versions` on the `overrides` clone: 0 skips, 0 desyncs over 245 specifiers; the same
  clone with the refusal lifted by hand produced 7 false positives before the fix.
- The remediation for a workspace importer names the directory (`pnpm -C cli pkg set …`): 80 of 96
  findings on `create-t3-app`, where the bare form wrote into the root manifest.
- 501 tests, 500 pass, 0 fail; differential against the base commit byte-identical for every preserved
  shape, including the legitimate refusal of `lockfileVersion 8.0`.

## Alternatives rejected

- **Keep refusing `catalogs`.** It hid the very comparison that needed no catalogue data, and the
  alternative — a skip that names no rule — was the defect 0024 closed.
- **Lift `overrides` first and fix the comparator later.** Measured: 7 false positives in 8.
- **Write the catalogue version into the manifest.** `catalog:` is a reference; rewriting it destroys
  the reason the project has a catalogue.
