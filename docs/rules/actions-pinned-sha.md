# Actions are pinned to a commit SHA
Rule id: `actions-pinned-sha`

## Question

Can a CI workflow change under you without a commit?

## Detection

Every workflow under `.github/workflows` is read by the structural reader
(`src/lib/workflows.js`), never by a line scan. A `uses:`-anchored scan finds none of the real steps
and a loose one takes false positives from block scalars, folded values and `with:` map keys (E6),
so a `uses:` inside a `with:` map or inside a `run: |` body is never a step here. The reader
attributes each step to its job, and the rule decides per step with a `uses` value:

- `owner/repo@<40 hex>` passes. Lowercase and uppercase hex are both accepted.
- `owner/repo@v1`, `owner/repo@main` and `owner/repo@abc1234` fail as `unpinned-action` with
  `form` `tag`, `branch` or `short-sha`.
- `docker://image:tag` fails as `mutable-docker-tag`; `docker://image@sha256:<64 hex>` passes.
- `./path` is a local action and passes.

The form is a lexical classification, not a git lookup: a `v`-prefixed or dotted numeric ref is a
tag, an all-hex ref shorter than 40 characters is a short SHA, and everything else is a branch. No
probe, no network, no `git ls-remote`. Zero unpinned references is a pass.

A workflow the reader cannot parse yields one `skip: unparseable-workflow` for that file, and the
rule never adds a pass on top of it: a malformed input is not a verified clean workflow.

## Evidence

`file:line`, the raw reference exactly as written — quotes and trailing comment included — and the
offending form. A trailing `# vX.Y.Z` comment is preserved as evidence and never trusted as the
version; the reference, not the comment, is what runs.

## Remediation

Manual, with the exact shape printed:

```yaml
uses: actions/checkout@<sha> # v4.1.7
```

The tool does not resolve the SHA. Resolving it is `gh api repos/owner/repo/git/refs/tags/vX.Y.Z`,
a network call, and v0.1 makes none (RFC 4.9). That one command is documented here instead of being
run for you.

## Limits

- The rule proves a reference is a full commit SHA. It does not prove the SHA is the release the
  comment claims, and it does not check what the action does.
- Container references are checked for a digest, not for the image's provenance.
- A ref that is neither version-shaped nor all-hex is labelled a branch. The label is lexical; the
  finding is the same whichever branch or tag it is. A remote `uses` with no ref at all is reported
  the same way, because it names no commit.
- A workflow the reader cannot attribute is skipped per file: the rule never guesses from a line
  scan, and `--strict-probes` does not promote this skip, because the workflow was read and refused
  rather than unavailable.
