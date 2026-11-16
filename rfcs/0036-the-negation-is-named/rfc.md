# RFC 0036 — the negation is named

| | |
|---|---|
| **Status** | `draft` — a `packages:` entry that is a negation is reported instead of dropped in silence. Issue #298. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.1 R1, the sentence on refused `packages:` entries, as amended here. |
| **Supersedes** | nothing. It closes a silence no record ever argued for. |

## What is true today

`pnpm-workspace.yaml` may carry negations — `!**/test/**` — and funky-secure reads none of them.
`src/lib/targets.js:157-166` files any entry with more than one `*`, or a `*` followed by `/`, under
`unsupported-glob`; `!**/test/**` matches both. `src/rules/exact-versions.js:493` is the only consumer,
and it keeps one code:

```js
if (skipped.code !== 'outside-root') continue;
```

The choice is argued in the comment above it, and the argument is sound as far as it goes: a negation's
directories *are* read, so a message saying they were not would be false. `docs/rules/exact-versions.md`
records the same thing twice, at `:122-123` and `:209`: "a nested glob or a `!` negation is neither
expanded nor reported".

## Why that is a defect

A negation is the one entry a reader writes to keep something **out** of the scan. It does nothing, and
the report says nothing, so the reader's belief about their own repository is wrong in the direction they
cannot see: they think test fixtures, generated clients or vendored trees are excluded, and every
importer under them is being judged. The tool is honest about what it refused (`outside-root`) and silent
about what it ignored.

Silence is the defect, not the missing expansion. Applying the negation is a larger change than this
record decides, and it is not needed to stop the report from lying by omission.

## Decision

A `packages:` entry that is a negation is reported as one `skip` finding on `pnpm-workspace.yaml`, with
code `workspace-entry-not-applied`, naming the entry and saying the negation is not applied and its
directories are still read. One finding per entry: four negations are four findings, because a reader
who deletes one needs to see the remaining three.

The message names what is true — not applied, still read — and never claims a refusal. A nested glob
that is **not** a negation keeps its current silence, because there the limitation is the single-level
expansion and the entry's directories are matched by nothing it would have covered; a negation is a
statement about directories that *are* covered, and that is the difference this record turns into output.

## Conformance

One test per shape: a negation produces the finding with its entry in the message, a plain nested glob
produces none, and a repository with four negations produces four findings. The verdict counts the rule
once (0008), so the count does not become four.

## What this does not do

It does not expand, apply or otherwise honour the negation. A repository that excludes `**/test/**` still
has those importers scanned after this record; it now says so. Honouring the pattern, if it is decided
later, is the next record's subject and would supersede the `not-applied` code.
