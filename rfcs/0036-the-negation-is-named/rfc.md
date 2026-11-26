# RFC 0036 — the negation is named

| | |
|---|---|
| **Status** | `draft` — a `packages:` entry that is a negation is reported instead of dropped in silence. Issue #298. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R1, the sentence on refused `packages:` entries, as amended here. |
| **Supersedes** | nothing. It closes a silence no record ever argued for. |

## What is true today

`pnpm-workspace.yaml` may carry negations — `!**/test/**`, `!packages/*`, `!test` — and funky-secure
reads none of them. Worse, it does not fail to read them in one place. `expandEntry` never inspects
`!`: it classifies on how many `*` an entry carries and where they sit, so a negation's fate depends
on the shape of the pattern that follows the bang.

| entry | path through `src/lib/targets.js` | what the report says |
|---|---|---|
| `!**/test/**` | more than one `*` → `skipped` with `code: 'unsupported-glob'` (`:156-166`) | nothing: the only consumer keeps one code |
| `!packages/*` | one `*`, no `/` after it → the expansion branch → `readdir('!packages')` throws → `catch` returns `{ dirs: [], skipped: [] }` (`:169-176`) | nothing, and no skip was even recorded |
| `!test` | no `*` → returned as `dirs: ['!test']` (`:155`) | nothing: it is read as a literal directory, so the scan invents an importer named `!test` |

`src/rules/exact-versions.js:493` is the only consumer of the skip list, and it keeps one code:

```js
if (skipped.code !== 'outside-root') continue;
```

The choice is argued in the comment above it, and the argument is sound as far as it goes: a negation's
directories *are* read, so a message saying they were not would be false. `docs/rules/exact-versions.md`
records the same thing twice, at `:122-123` and `:209`: "a nested glob or a `!` negation is neither
expanded nor reported".

A fix that lived only in the consumer would reach the first row and neither of the other two:
`!packages/*` records no skip to filter, and `!test` never becomes a pattern at all. The classification
of a negation therefore belongs in `expandEntry`, before the no-`*` return, where every entry passes —
not in the rule that reads what the expander left behind.

## Why that is a defect

A negation is the one entry a reader writes to keep something **out** of the scan. It does nothing, and
the report says nothing, so the reader's belief about their own repository is wrong in the direction they
cannot see: they think test fixtures, generated clients or vendored trees are excluded, and every
importer under them is being judged. The tool is honest about what it refused (`outside-root`) and silent
about what it ignored.

Silence is the defect, not the missing expansion. Applying the negation is a larger change than this
record decides, and it is not needed to stop the report from lying by omission.

## Decision

`expandEntry` classifies a negation **first**, on its leading `!`, before any glob reasoning, and records
it as `skipped` with `code: 'workspace-entry-not-applied'` and its entry. Every negation therefore
reaches the same place whatever follows the bang, and the reader sees one line per entry instead of
depending on a pattern's shape.

`exact-versions` reports that code as one `skip` finding on `pnpm-workspace.yaml`, naming the entry and
saying the negation is not applied and that it excludes nothing. One finding per entry: four
negations are four findings, because a reader who deletes one needs to see the remaining three.

The message names what is true — not applied, excludes nothing — and never claims a refusal. A nested glob
that is **not** a negation keeps its current silence, because no positive pattern covered the
directories it would have matched; a negation is a statement about directories that a positive entry
does cover, and that is the difference this record turns into output.

## Conformance

One test per shape: a nested-glob negation, a one-glob negation and a bare negation each produce the
finding with its entry in the message; a plain nested glob produces none; and a repository with four
negations produces four findings. The verdict counts the rule once (0008), so the count does not become
four.

## What this does not do

It does not expand, apply or otherwise honour the negation. A repository that excludes `**/test/**` still
has those importers scanned after this record; it now says so. Honouring the pattern, if it is decided
later, is the next record's subject and would supersede the `not-applied` code.
