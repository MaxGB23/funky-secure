# explain

`explain` is the catalog. It reads no repository, runs no probe and changes nothing: it prints what the rules say
they ask, either one rule in depth or all thirteen in a list. It is the only command on this path whose answer is
identical in every folder.

## What it answers

*What does this rule ask, and what does the whole catalog hold?* With a rule id it prints that rule's question, how
it detects an answer, the evidence a finding carries, the remediation, its limits, and the page that holds the same
thing. With no id it prints one line per rule - the id, the `baseline/strict` severity pair, and the one-sentence
title - which is the list of every question the tool can ask you. It never answers anything about your repository:
there is no finding in it, and no part of the output depends on where you run it.

## What it does

It reads the catalog compiled into the package and nothing else, which is why it works outside a repository, with
no lockfile, on a machine with no network. I ran it in this repository and in an empty folder in the temp directory
and `diff` between the two outputs printed nothing: same bytes, same exit `0`. It writes neither file nor cache.
`explain` with no id is byte-for-byte the same output as `explain --list`, so neither form is the "real" one; an
unknown id is a usage error, exit `2`, with the action on the first line. Every flag, and the JSON shape, are in
[`../../cli.md`](../../cli.md).

## When you use it

- When a finding's sentence is not enough. The report gives one line of evidence and a `→`; `explain <id>` gives
  the question behind the rule, what it deliberately does not check, and the command that clears it.
- When you cannot remember an id. `explain` alone is the thirteen, one line each, and the severity pair tells you
  whether a preset will fail on it.
- When a writer refuses and `start`'s last line tells you where to look: `if a writer refuses, funky-secure explain
  <rule> names the reason`. That is the plan handing you the command for the part of a refusal a plan cannot
  explain.
- Offline, or before you have a repository at all: it is the only command that answers in an empty folder.

## When it is superfluous

The reason to say so is duplication, and it is measurable. Three artifacts already hold the same text.

- **`--help` prints the same catalog.** I compared `explain`'s thirteen lines with the `rules` block of
  `funky-secure --help`: the ids, the `baseline/strict` pairs and the titles are the same thirteen lines, and
  `diff` between them, whitespace aside, printed nothing. The only difference is the column the severity is padded
  to. If you are going to type `--help` anyway, the catalog is already in it.
- **The reference quotes it too.** [`../../cli.md`](../../cli.md) prints the first six of those same lines inside its
  `explain` section, and the rule-list JSON document above them is the catalog again, for a script. `explain` adds
  no rule that `../../cli.md` does not already list.
- **The rule pages hold the fields, and `explain` says which one.** The last line of the block below is
  `docs  docs/rules/lockfile-committed.md`, and that page holds the same question, detection, evidence,
  remediation and limits - in more depth, with the examples the terminal rendering has no room for.
  [`../../guide.md`](../../guide.md) says the same in its own words - `funky-secure explain <id>` *"prints the same
  content in the terminal"* - and its *If you see this, do this* table already answers twelve of the thirteen ids
  before you have to ask.
- **It cannot be consulted about your repository.** It reads none, so its answer cannot change when yours does: the
  same bytes inside a repository and in an empty folder. If your question is "why is this finding
  mine", the answer is `scan`'s report plus the rule's page; `explain` is the terminal copy of that page, and the
  cheapest moment to skip it is when you already have the page open.

So the honest use is one line long: a rule id you do not know, or a field you want without leaving the terminal. For
everything else the catalog is in `--help`, the same lines are quoted in the reference, and the page the command
itself names is the fuller answer.

## What you will see

One run in this repository's own folder. The folder is a label and not a variable: the same command in an empty
folder in the temp directory printed the same bytes, and `diff` between the two printed nothing. The catalog, which
is what the command answers with no id:

```
package-manager-pin     error/error  package.json declares the pnpm that answers
lockfile-committed      error/error  pnpm-lock.yaml is present, tracked and not ignored
foreign-lockfile        warn/warn  No other package manager shapes this repository
quarantine              warn/error  Quarantine is a gate, not an approval list
exact-versions          warn/error  Dependency specifiers are exact
env-not-tracked         error/error  No environment file is committed
sensitive-ignored       error/error  Sensitive files are ignored and untracked
actions-pinned-sha      error/error  Actions are pinned to a commit SHA
no-bot-auto-merge       error/error  No dependency update is merged automatically
ci-no-safety-overrides  warn/error  CI does not disable the frozen lockfile or re-enable lifecycle scripts
pull-request-target     error/error  A pull_request_target workflow does not check the pull request head out
workflow-permissions    warn/error  Every workflow declares least-privilege permissions
workflow-run-artifact   error/error  A privileged workflow does not read an artifact an unprivileged run produced
```

Exit `0`. Thirteen lines, and the columns are the thing to read: the id you pass back in, the severity in each of
the two presets, and the sentence the report shows when the rule fires. One rule in depth, the same command with an
id:

```
lockfile-committed — pnpm-lock.yaml is present, tracked and not ignored

friction 0 · severity error / error (baseline / strict)

question    Is the lockfile present, tracked, and not ignored?
detection   pnpm-lock.yaml at the repository root. Outside git only existence is checked and the finding states that the tracked and ignored parts were not evaluated. Inside git a present lockfile must appear in the tracked set and must not match a git ignore rule; an absent file fails with lockfile-missing, an untracked one with lockfile-untracked, an ignored one with lockfile-ignored.
evidence    { path, present, tracked, ignored } with null where git did not answer
remediation manual — git add pnpm-lock.yaml (untracked), git check-ignore -v --no-index pnpm-lock.yaml to find the ignore source (ignored), pnpm install (missing).
limits      Does not compare lockfileVersion with the installed pnpm: pnpm performs that check on install and a second copy would go stale (RFC 4.1). It does not parse the lockfile, does not read .gitignore and cannot see an ignore rule git did not report through the collected facts.
docs        docs/rules/lockfile-committed.md
```

Exit `0`. The last line is the one to use: it names the file that holds all of this with the examples and the state
table, and it is the page to read when the terminal rendering is not enough.

An id that is not in the catalog:

```
funky-secure: run funky-secure explain --list to see the rule ids
reason: unknown rule id "nope"
```

Exit `2`, two lines on stderr, and no catalog: the tool could not answer the question it was asked.

## What you do next

Take the id from the line you were reading, run it, and then open the page its `docs` line names - that page is the
answer with the examples, and this command is the quoting of it. If you only wanted the list, `--help` prints the
same thirteen lines in the same run as the flags.

**Adds:** the comparison that decides whether the lookup is worth it - the thirteen lines `--help` already prints,
the six of them the reference quotes, and the `docs` line that names the page holding more - so a reader knows when
`explain` is the answer and when it is a second copy of one they already have.

---

Next: [skill](skill.md), the last command on this path, and the only one written for a reader who is not the human.
