# No environment file is committed
Rule id: `env-not-tracked`

## Question

Is any environment file committed to this repository?

## Detection

From the complete tracked set the collector already resolved, the rule keeps every path whose
basename starts with `.env`, at any depth, then excludes the template names, exactly:
`.env.example`, `.env.sample`, `.env.template`, `.env.dist`, `.env.test.example`. Each remaining
path is one `env-tracked` finding. No tracked environment file is a pass. Outside git the tracked
set is unknown and the rule skips with `no-git`.

The RFC states this rule as `git ls-files -z -- ':(glob)**/.env*'`. The `:(glob)` magic exists
because a pathspec without it misses a root `.env` (E4). This implementation runs no pathspec at
all: the collector resolves the complete tracked list once, and a complete list needs no pathspec.
That is the equivalence decision. The RFC's matching and this one are the same set — a root `.env`,
a nested `packages/api/.env`, and `.env.local` — and so is the over-match the RFC records:
`**/.env*` also matches `.env.example`. The template exclusion list is therefore mandatory here
too, and not a convenience. Because the rule adds no second git probe, it cannot disagree with the
tracked set that `lockfile-committed` and `sensitive-ignored` also read.

The match is prefix-based, exactly like the RFC glob: `.envrc` is included, and only the five
template names are excluded.

## Evidence

The tracked path, as `{ path }`, and the same path in the message. File contents are never read and
no value is ever printed (N5). The rule reports that a file is committed, never what is inside it.

## Remediation

`manual`, one command per tracked file: `git rm --cached <path>` removes the file from the index and
leaves the working copy alone, so nothing is deleted by accident. The tool prints it and never runs
it: deleting a credential from a working tree is a decision, not a generated edit.

Rotation stays in the message, because it is the part no command can do:

> removing the file from the index (`git rm --cached <path>`) does not remove it from history, so
> the credentials it contains must be rotated.

Rotation is the remediation; the printed command only stops the leak from growing. Deleting the file
while keeping the secret live is the accident this rule exists to catch.

## Limits

- Only tracked state is judged. Ignore coverage is R7, and history is not inspected at all.
- A path is classified by its basename prefix, not by content: what the file contains and whether
  its values are still live are outside the rule.
- Outside git the rule returns `skip: no-git`. An unknown tracked set is not a clean one, and
  `--strict-probes` turns that skip into an error rather than a green run that measured nothing.
