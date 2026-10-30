# RFC 0022 — the output tells the truth

| | |
|---|---|
| **Status** | `implemented` — the verdict names the rules it could not verify, the managed `.gitignore` covers the artifact the path creates, and 11.2 stops contradicting 0017. `0.8.7`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/report.md`](../../docs/spec/report.md) §10.3; [`docs/spec/scope.md`](../../docs/spec/scope.md) §8.2 R7; [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.2. |
| **Supersedes** | nothing. Three corrections to what the output says, not to what the tool does. |

## The three defects

**1. The verdict counted without naming.** A repository whose lockfile declares `catalogs` gets
`exact-versions` skipped, and the human report said:

```
verdict  PASS (threshold: warn · 1 rule not verified)
```

Nothing named the rule, nothing named the reason. The skip block that should have carried both never
reached the body: the renderer groups findings by `path`, and the branch that builds those groups
hardcodes `skipped: []` on both of its returns, while the refusal is a finding with a `target` and no
`path`. This breaks 0008's promise in its own words — *the verdict names what it did not verify* —
because a count is not a name.

**2. The managed `.gitignore` did not ignore what the path creates.** The block carries `.env`,
`*.pem`, `*.key`; the printed `pnpm install` step creates `node_modules`. In a repository generated from
nothing, `git status` after the canonical path showed `?? node_modules/`, so a path that ends in a scan
of a tracked tree could not end with a clean one. Found by the yarn round, on both of its repositories.

**3. Two normative pages disagreed.** `commands.md` 11.2 said the age is written only under
`--preset strict`; 0017 made the block write it always. A reader following the spec would have expected
one line and got two.

## The decision

- **The verdict names them.** `1 rule not verified: exact-versions`. The ids ride the line a reader and
  a CI log both look at, and the body keeps whatever detail it has. The count stays, because a reader
  scanning the header wants the size before the list.
- **The ignore block covers `node_modules/`.** The criterion is narrow and written into the file: the
  block ignores what this tool's own printed step creates. Nothing framework-specific is added — no
  `.next`, no `dist` — because those belong to the project's stack, not to this tool's promises.
- **11.2 states what 0017 does:** the age is written always, `1440` under `baseline` and `4320` under
  `--preset strict`.

## What it is not

The skip **reason** still does not reach the body of the human report in that case. The verdict now
names the rule, which is the promise 0008 makes, and the message with the section and its line exists
in the JSON. Making the body print it needs the grouping branch repaired, and that is a change to the
report layout rather than to a sentence; it is recorded as follow-up rather than smuggled into this
release.

## Verification

- A lockfile declaring `catalogs`, scanned with `--only exact-versions`, prints
  `1 rule not verified: exact-versions` and still exits 0, because an unverified rule is not a violation.
- `init --apply` on a repository with no `.gitignore` writes the block including `node_modules/`, and a
  directory created there afterwards is ignored.
- The 11.2 row matches the block 0.8.2 writes.
- 449 tests, 448 pass, 0 fail. Self-scan exit 0.

## Alternatives rejected

- **Fail the run when a rule could not be verified.** That is the `--require-verified` question, still
  an owner decision, and 0008 deliberately draws exit 1 as a threshold violation.
- **Repair the grouping branch in the same change.** It would move the report layout while the release
  is about sentences, and the naming fix already satisfies the promise the user reads.
- **Add `.next`, `dist` and `coverage` beside `node_modules`.** Each is a decision about someone else's
  stack, and a security block that grows into a framework opinion stops being one.
