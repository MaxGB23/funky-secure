# Funky Field Loop 👻

A way to find the defects a test suite cannot find, by handing the tool to an agent that uses it the way
a stranger would, and then turning what it trips over into tests.

It runs **per release, not per rule**. It is a complement to the suite, never a replacement: the suite
custodies what we already know, the loop discovers what we did not know existed.

## The question it answers

A test can only assert what someone already imagined. Every one of these defects reached `main` with a
green suite, and every one was found by a field loop:


| Defect                                                                               | Release it escaped in | Found by                                                    |
| ------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------- |
| `validateIgnoredSection` refused 3 of 7 real lockfiles                               | up to 0.7.0           | a field loop: no fixture had the shape pnpm actually writes |
| `pin` wrote `9.39.5(jiti@2.7.0)`, breaking the plan's own next step                  | 0.7.2                 | a field loop, after publication                             |
| `start` could not be followed: a commit was missing, and `pin` never joined the path | 0.8.0                 | a field loop, three improvised steps                        |
| the writing commit swept an untracked `.atl/` directory with `git add -A`            | 0.8.1                 | a field loop                                                |
| the closing commit left `D package-lock.json` in the index while reporting green     | 0.8.3                 | a field loop                                                |
| **`scan` rewrote the user's `pnpm-lock.yaml`**                                       | up to 0.8.3           | a field loop                                                |


The last one is the reason this document exists. The tool shipped for eight releases promising it "never
writes any file, anywhere", and the test that would have caught it was two lines — hash the repository,
run the command, hash it again. Nobody had written it, because nobody had asked the question.

Notice what the list has in common: **none of them is a wrong rule.** Every one is a wrong *path* — step
order, missing command, exit code, final tree state, a side effect nobody declared. Unit tests are very
good at rules and structurally blind to paths, because a path is what happens between the assertions.

## When to run it

- Before a release that changes a path the user follows: `start`, the step order, a remediation, an exit
code, the closing state of a repository.
- When a shape of repository has never been through the tool: another manager, a monorepo, a CI config, a
refused input.
- When the owner has used the tool himself and hit friction.

## When not to

- For a single rule's detection: that is what its tests are for, and a loop costs an agent.
- As a gate on every pull request. That is the ceremony this loop replaces, not adds to.
- To re-check what a previous loop already covered and turned into a fixture. The fixture is the memory.

## The three steps

### 1. Delegate — one fresh session per scenario

Never continue the previous session. A session that carries the last round's table starts comparing
against its own memory instead of against files, and the evidence muddies. A fresh session re-derives
everything from disk.

One scenario per session, one directory per session, launched in parallel. They are independent: one that
blocks must not stop the others.

The brief must be self-contained, because the agent does not inherit the orchestrator's context:

- the binary by **absolute path**, with its version, and the fact that it is not installed globally;
- every directory the agent may write, named absolutely, and the repository that is **read-only**;
- the fixture spelled out, so a missing directory is built rather than reported as a blocker;
- what to run, verbatim, and that the printed steps are executed **exactly as printed**;
- the expected result, stated before the run, so a surprise is visible as a surprise;
- what counts as the finding of gold, named in advance ("if it rewrites the file instead of refusing,
that is the finding");
- the report contract: a table of `command | exit | expected | observed | surprise`, the literal output,
and an explicit **what I could not verify**;
- the prohibitions: no network, no installs, no `--force`, no fixing the fixture to make the tool pass.

### 2. Triage — verify before believing

A report is a hypothesis. Every claim is checked against the code or re-measured before it becomes work.

- **Re-measure the critical ones yourself.** A claim that the tool writes when it promises not to is not
accepted on someone else's word; reproduce it in a scratch directory and isolate the cause.
- Distinguish **defect** from **mis-specified brief**. In one round a "the guard does not fire" claim
turned out to be a brief that asked for two idempotent runs instead of a pending write over a dirty
file. The tool was right; the brief was wrong. Say so explicitly.
- Distinguish **contract** from **bug**. `scan --scope repo` exiting 0 with unverified rules is a recorded
decision, not a defect. A report that calls it a bug is corrected, not obeyed.
- A finding of gold is one that breaks a promise the product makes about itself, or that leaves the user's
repository in a state the path claims it will not.

### 3. Pine it — or pay for it twice

A defect fixed without a fixture will be found by the field again. The loop closes only when the
finding becomes a test, and the fixture is the memory:

- the failing case becomes a fixture **from the agent's own files**, not retyped by the person who wrote
the parser — a fixture written by the same hand only exercises the shape its author imagined;
- when the finding is an absence rather than a wrong output, the test asserts the absence directly: a hash
before and after, a tree state, a byte-identical file;
- if the defect was in a promise the product makes, the test is named after the promise, not the code.

The loop is also the cheapest source of new test shapes this project has, and the reason is structural:
every scenario is a repository **nobody on the implementation side chose**. Two findings in one round
became tests that no author would have imagined from reading the code — a directory that is not a git
repository at all (0031), and a manifest whose `packageManager` says npm while its
`devEngines.packageManager` names pnpm. None of those shapes existed in any test before an agent met
one, and each now fails loudly if the behaviour regresses.

A later round added a second kind of value that no test can produce: it watched a line the tool had just
been taught to print and found it false. The line was true of the moment it was computed from and wrong
by the time the step it described ran, because the path itself changed the fact in between. A suite
cannot see that; a reader following the printed steps sees nothing else.

So a finding has two outputs and the fix is only the first: the fix, and the case. A round that produces
fixes without cases has left the product exactly as exposed as before, one commit later.

Then the release ships and the record says which shape of repository has now been through the tool, and
which has not. That last part matters: coverage claimed is coverage that will not be tested again.

## What it does not cover

- **Anything needing the network or the real world.** No registry, no GitHub runner: an agent validates a
static workflow file, never what Actions does with it.
- **The platform it is not run on.** A loop on Windows says nothing about Linux, and vice versa.
- **The rules nobody wrote a scenario for.** The loop finds what it looks for, in the shapes it was given.
A green loop is not a green product.