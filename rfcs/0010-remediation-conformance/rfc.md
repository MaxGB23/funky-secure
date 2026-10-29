# RFC 0010 — Remediation conformance

| | |
|---|---|
| **Status** | `implemented` — three remediations that could not run now run, and `start` names the commit its first step needs. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R2 and R8, [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.7. |
| **Supersedes** | nothing. It is the first sweep with conformance as the question, rather than detection. |

## The problem

The field report that produced records 0007, 0008 and 0009 was ad-hoc: an agent hit one remediation that
failed and told us. The useful invariant behind that accident is testable — **every remediation the tool
prints must run, in the state the finding describes, and clear the finding.** So the sweep was run as a
table: for each of the twelve rules, a fixture that fails it, the remediation read from the JSON report,
then that command executed verbatim and the repository re-scanned.

Three of the twelve failed, all three in the same direction: the printed route could not be taken.

**`lockfile-committed` told the reader to stage an ignored file.** For a lockfile that is untracked *and*
matched by an ignore rule — the state of a repository that just added `pnpm-lock.yaml` to its ignore
file, which is the reason this rule fires hardest — the remediation was `git add pnpm-lock.yaml`, and git
refuses:

```
$ git add pnpm-lock.yaml
The following paths are ignored by one of your .gitignore files:
pnpm-lock.yaml
$ echo $?
1
```

The rule reported `lockfile-untracked` and said nothing about the ignore rule it had already detected,
and its `lockfile-ignored` branch only fires when the file is *tracked*, so the two conditions together
had no route at all.

**`actions-pinned-sha` printed a template that discarded its own evidence.** The remediation was
`uses: owner/repo@<sha> # vX.Y.Z` while the finding carried `actions/checkout@v4.1.7`. A reader had to
retype the action and the ref for every finding, and `<sha>` alone does not say what precedes the `@`.
The tool cannot resolve a tag to a SHA offline (4.9), but it can be concrete about the two facts it has.

**`start` promised a first step that refuses.** Step 1 was `funky-secure init --apply`, and `init --apply`
refuses to write over uncommitted changes — which is the state of every freshly generated project, where
nothing has been committed yet:

```
$ funky-secure init --apply
funky-secure: commit package.json or pass --allow-dirty, then re-run
reason: refusing to write over uncommitted changes: package.json
```

The canonical first-run path, printed by the command whose whole purpose is to be the first thing you
run, could not be completed by running its own steps. A generated project has no reason to be committed
before it is hardened, so no other command could have told the reader either.

## The decision

**A remediation is printed for the state it describes, not for a cleaner one.** When the rule already
knows a second condition holds — the ignore rule — the command and the message carry it:
`git add -f pnpm-lock.yaml`, and a message that names the ignore rule. The generic form stays for the
simple case, because forcing an add is not a habit worth teaching where it is not needed.

**A remediation uses the facts the finding carries.** The action and the ref are in the finding; the
template now prints `uses: actions/checkout@<sha> # v4.1.7`, and `uses: docker://node@sha256:<64 hex> #
24-alpine` for a container tag. What the tool cannot know — the SHA itself — stays a placeholder, and
the rule doc keeps the command that resolves it.

**`start` prints the commit its first step needs.** The dirty-tree refusal is a safety property, not a
friction to remove: a security tool does not write over work whose state is not recorded. So the step is
added instead, placed before `init --apply` and only when one of the plan's own target paths is
uncommitted. The message is deliberately dull — `chore: baseline before funky-secure` — because it
belongs to the reader's repository.

## What it costs

`start` runs one more read-only probe (`git status --porcelain` over the plan's target paths, the same
call `apply-plan` makes) and can print one more step. A repository with a clean tree renders exactly as
it did.

The two rule messages grow by one clause each, and the `dirty` and `vulnerable` goldens move one line
each: the same findings with the corrected commands.

## Verification

The sweep, re-run after the change:

| Rule | Printed route | Result |
|---|---|---|
| `package-manager-pin` | `funky-secure init --apply` | clears it, after the commit step |
| `lockfile-committed` | `git add -f pnpm-lock.yaml` | clears it (exit 0); a matching ignore rule is then reported on its own |
| `foreign-lockfile` | `funky-secure migrate --from npm --apply` | works on a feature branch, refuses with an action on the default one |
| `quarantine` | `funky-secure init --apply` | clears it (record 0007 for the manual clause) |
| `exact-versions` | `pnpm pkg set '<section>["<name>"]=<version>'` | clears it (record 0007) |
| `env-not-tracked` | `git rm --cached .env` | clears it |
| `sensitive-ignored` | `funky-secure init --apply` | clears it, after the commit step |
| `actions-pinned-sha` | `uses: <action>@<sha> # <ref>` | a manual edit, now concrete |
| `no-bot-auto-merge` | `edit <file>:<line> and delete the automatic merge step` | names the file and the line |
| `pull-request-target` | remove the trigger or the head checkout | names the file and the line |
| `workflow-permissions` | add `permissions:` with `contents: read` | names the file and the line |
| `ci-no-safety-overrides` | delete the `ignore-scripts` key from `.npmrc` | names the key and the file |

The three fixes are pinned by tests that fail without them, and `start`'s new step by a test whose
fixture reports the real working-tree state instead of a hard-coded clean one — the earlier double said
"clean" always, which is why the path could break without a red test.

## Alternatives rejected

- **Make `init --apply` accept an uncommitted tree.** It would trade a safety property for one step, in a
  tool whose selling point is that it refuses.
- **Print both the `git add` and the `git add -f`.** Two commands for one state, and the reader has to
  pick.
- **Keep `owner/repo` and document it.** The rule doc already documents the resolution; the message is
  what people run.
