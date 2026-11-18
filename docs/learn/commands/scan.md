# scan

`scan` is the audit. `start` told you what to type; `scan` tells you what it found, in a report with a verdict and
an exit code you can put in CI.

## What it answers

*Is this repository installing what it says it installs, from where it says, under the rules the preset chose?* It
answers with one report: a verdict, a line per finding, and an honest count of the questions it could not answer.
The files it reads are the subject of page [`00`](../00-the-problem.md); this page is about the command's habits
- what it writes, what it refuses, and what a second run buys you.

## What it does

It is read-only. It resolves what to read, runs the active rules, renders one report, and writes nothing: after
the run below, `git status --porcelain` in that folder still printed nothing. It refuses to answer at all when an
option carries a value outside the list it accepts: that is a usage error, exit `2`, with no report. `--scope`
decides whether it may look at the machine as well as the repository, `--format json` gives the document a script
reads, `--fail-on` decides where the verdict turns red, and `--verbose` restores what the human report leaves out.
Those flags are in [`../../cli.md`](../../cli.md); this page says which habit you need, not which flag exists.

## When you use it

- Before you commit. It is the audit of the bytes you are about to send, and it answers in a second.
- In CI, with a threshold. `--fail-on warn` makes a warning fail the branch, which is the point of a gate: a
  report nobody reads has never stopped a merge.
- After acting on a finding, to watch the answer change. The report is the check that your fix did what the `→`
  line asked for.
- On a repository that is not yours, with `--format json`: the human text is presentation, and the JSON document
  is the contract.

## When it is superfluous

- **Nothing is remembered, so a repeat over unchanged bytes is the same answer.** I ran `scan --scope repo`
  twice in the same folder with no file changed in between, and `diff` between the two outputs printed nothing:
  same exit code, same bytes. If your CI already ran it for this commit on this branch, a local run is the same
  report, not a second opinion.
- **`init` runs this same scan before it writes anything.** The plan it prints is derived from the report, so
  running `scan` and then `init` reads one set of facts twice; `init`'s plan names the findings it can fix, and
  its `next steps` names the commit that records them.
- **When the report says `next  nothing to do`, the next scan says it again.** That is the exit `0` case:
  `verdict PASS` and `next  nothing to do: everything at or above the policy passes`. A pass over an unchanged
  tree is not evidence that grows with repetition.

What each exit code means, and which of them I saw: `0` is a report within the threshold - seen, as that `PASS`;
`1` is at least one finding at or above `--fail-on` - seen, in the capture below; `2` is the tool unable to
answer, a usage error - seen, in the second capture. [`../../cli.md`](../../cli.md) gives the same three meanings
and adds the fourth, `3`, which `scan` never uses. Read `1` as a threshold and not as a judgement on your
project: I re-ran the same failing folder with `--fail-on none`, got the identical report, and exited `0`.

## What you will see

This ran in a scratch repository in the system temp directory with one `package.json` declaring
`left-pad@^1.3.0`, one commit, and no lockfile:

```
funky-secure scan  ·  preset baseline  ·  scope repo
provenance  preset baseline (default)  ·  quarantine not verified (machine excluded)  ·  machine
            excluded
summary  2 errors · 1 warning · 0 info · 4 passing · 7 skipped
verdict  FAIL (threshold: error · 7 rules not verified:
         package-manager-pin, quarantine, exact-versions, ci-no-safety-overrides,
         pull-request-target, workflow-permissions, workflow-run-artifact)
──────────────────────────────────────────────────────────────────────────────────────────

REPO-ROOT
  ✖  Lockfile  ·  pnpm-lock.yaml
     pnpm-lock.yaml is missing from the repository root; installs are not reproducible
     without it
     → pnpm install

  ✖  Sensitive files  ·  .gitignore
     .env, .env.local, .env.production, secrets.pem, server.key, .npmrc are not ignored by
     git
     → funky-secure init --apply

  –  2 rules not verified: Package manager, Quarantine
     → funky-secure scan --verbose, each names what was not verified and how to verify it

IMPORTER  package.json
  ⚠  Dependency ranges  ·  package.json:5
     left-pad@^1.3.0 is a floating range
     → pnpm install --lockfile-only && funky-secure scan --only exact-versions

CI
  –  4 rules not verified: CI install flags, pull_request_target, Workflow permissions, Workflow
                           run artifact
     → funky-secure scan --verbose, each names what was not verified and how to verify it

not verified  1 rule did not answer
              –  Dependency ranges
                 skipped: no pnpm-lock.yaml, so the specifier-versus-lockfile comparison did not
                 run

next     funky-secure init  plan the 1 fix it can make (nothing is written)
         funky-secure explain lockfile-committed   what this rule wants, and why
```

Exit `1`. Two findings, one warning, and seven rules that did not run - the last of those is not a pass, and the
`not verified` block says so in words. [`../../guide.md`](../../guide.md) walks these fields one by one, and
[`03-reading-the-output.md`](../03-reading-the-output.md) explains why the answers come in this order.

A value outside the list refuses before it reads anything:

```
funky-secure: pass --fail-on one of error, warn, info, none
reason: --fail-on must be one of error, warn, info, none (got "nope")
```

Exit `2`, two lines on stderr, and no report at all.

## What you do next

Follow the `next` block before anything else: it is the tool's own ordering of what to do first, and it appears
only when something is left to do. When `next` names `funky-secure init`, the page is [`init.md`](init.md); when
it says `nothing to do`, this run was the last one that tree needs until a byte changes.

**Adds:** the three states in which the audit is a repeat - unchanged bytes give back the same bytes, `init`
derives its plan from the same scan, and `next  nothing to do` is the report saying a second run has nothing to
add - with the exit codes I observed in place of the ones the reference lists.

---

Next: [init](init.md), the one command on this path that writes.
