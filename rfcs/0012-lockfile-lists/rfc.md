# RFC 0012 — lists inside ignored lockfile sections

| | |
|---|---|
| **Status** | `implemented` — the ignored-section check stops at the first level; `0.7.1`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R5, "Lockfile reader scope". |
| **Supersedes** | nothing. It narrows a check that 0001 wrote too wide, inside the same subset. |

## The problem

A field agent reported that `exact-versions` returned `skip: unsupported-lockfile-shape` on a
`create-next-app` project's `pnpm-lock.yaml`. The report could have been an exotic file. It was the
common one.

Running the parser over the seven `pnpm-lock.yaml` files on the author's machine refused three:

| Repository | Detail |
|---|---|
| a Next **16.0.10** app | `top-level "packages" section is not a map (line 1350)` |
| a vitest **4.1.10** CLI | `top-level "snapshots" section is not a map (line 1174)` |
| a VS Code theme | `top-level "snapshots" section is not a map (line 1100)` |

Both messages are misleading about their own cause. Line 1350 is `bundledDependencies:` — a key whose
**value** is a YAML sequence — inside the `packages` entry for `@next/swc-wasm-nodejs`. Line 1174 is
`transitivePeerDependencies:` followed by `- msw`, inside a `snapshots` entry that vitest contributes.

`validateIgnoredSection` walked into every block of a section the reader never reads and demanded a map
at each depth. The section is ignored, so the only property worth checking is that it can be skipped at
all; a list two levels down cannot lie about a specifier.

The cost is not a wrong finding — it is a rule that never runs. Every repository with Next (the wasm
swc packages) or with vitest had its dependency comparison degraded to a `skip`, which the verdict
honestly counts as unverified. The honesty was right; the refusal was not.

## The decision

**Check the first level, and stop.** An ignored top-level section must be a map, so the reader can skip
it without guessing at the layout. What it contains is none of the reader's business, because nothing
inside it is read.

**The unsupported list stays exactly as it is.** `catalogs`, `overrides` and `patchedDependencies` are
still refused: they can change what a specifier resolves to, which is the whole reason the comparison
would be unsound. The narrowing removes a check that protected nothing, and keeps every check that
protects something.

**Two fixtures carry the two real causes.** One `packages` entry with `bundledDependencies` as a
sequence, one `snapshots` entry with `transitivePeerDependencies` as a sequence, each asserting the
recorded version is read. The existing test that refuses a section whose own layout is a sequence stays
and still passes: that is the property, and it is now the only one.

## What it costs

One recursive call removed and a comment explaining why. Nothing else in the reader changes, so the
`lockfile-desync` comparison and `pin` inherit the fix without a line of their own — which is the point
of having moved `recordedVersion` into the reader when `pin` was written.

It also means a lockfile can now carry sections the reader never models and still pass. That is
deliberate: the reader's claim is "I can compare importers", never "I understand this file".

## Verification

- A `packages` entry with `bundledDependencies` as a sequence parses, and its dependency's recorded
  version is read.
- A `snapshots` entry with `transitivePeerDependencies` as a sequence parses, likewise.
- A section whose own layout is a sequence is still refused, naming the section and the line.
- `catalogs` is still refused.
- The seven real lockfiles on the author's machine all parse; the Next 16 app goes from `skip` to a
  `floating-range` finding that names `typescript@^5` and the `5.9.3` the lockfile records.

## Alternatives rejected

- **Ignore the check entirely.** A `packages:` that is a sequence would leave the reader scanning a
  layout it does not model. One `fail()` at the first level costs nothing and keeps the boundary
  explicit.
- **Model `bundledDependencies` and `transitivePeerDependencies` properly.** They are read by nobody and
  change no specifier. Understanding them would be work in service of no finding.
- **Ask the reporting agent for its lockfile.** The evidence was already on disk in three repositories.
  A defect that reproduces locally should not wait on a stranger's file.
