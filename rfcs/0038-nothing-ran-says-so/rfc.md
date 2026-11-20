# RFC 0038 — nothing ran says so

| | |
|---|---|
| **Status** | `accepted` — the owner decided on issue #506 that a verdict over zero checks says it measured nothing, and that the exit code does not change. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/report.md`](../../docs/spec/report.md) §10.3, the `verdict` line, as amended here. |
| **Supersedes** | nothing. It adds a second decoration to the line 0008 taught to count what it did not verify. |
| **Amends** | [`0008`](../0008-refusal-honesty/rfc.md) §10.3: the verdict line gains a second decoration, and the unverified count 0008 put there keeps its place and its condition. |

## What is true today

A run that emitted no finding at all prints a verdict that reads as a pass over a measured
repository. Measured at `1f266a0`, with a `funky-secure.config.json` whose `rules` map sets all
thirteen rules `off`:

```
summary  0 errors · 0 warnings · 0 info · 0 passing · 0 skipped
verdict  PASS (threshold: error)
not run  13 of 13 rules; off by policy: Package manager, Lockfile, Foreign lockfile,
         Quarantine, Dependency ranges, Environment files, Sensitive files, Pinned
         actions, Bot auto-merge, CI install flags, pull_request_target, Workflow
         permissions, Workflow run artifact
         a policy decision, not a skip or a missing rule; --preset strict turns none
         off by itself; your config turns them off, and no preset overrides it
```

The run exits `0`. The `not run` line of 10.3 states the coverage, and it is the only thing in the
report that does: it is the line a human reads after the verdict, and no script greps it.

## Why that is a defect

`PASS` is the word a reader stops at and the word a CI log greps — the argument 0008 made for the
unverified count, and it holds here for the same reason. A verdict compares failures with a
threshold, and this run had no failure to compare, no pass and no skip either: it measured nothing,
and the report's most quoted line says it succeeded. A configuration that turns every rule `off` is
a legal configuration (9.2), so this is a reachable state and not a corrupt one, and the tool that
told the reader to distrust a green report is the same tool printing one.

The `not run` line does carry the fact, correctly and at length. The defect is that a verdict over
zero counters bears the entire weight of saying so on a line below it, in prose, where the reader
who needed the fact has already stopped.

## Decision

The verdict line states when the run measured nothing, and it does so inside the parenthesis, after
the threshold:

```
verdict  PASS (threshold: error · nothing ran)
```

The placement is measured, not stylistic. The field a parser reads is `(threshold: <value>`, and the
suite's own reader is `/^verdict {2}(PASS|FAIL) \(threshold: (\w+)/m`
(`tests/rules/workflow-run-artifact.test.js`): a suffix placed before the parenthesis makes that
parser miss and the ordering test that follows it go red, while a decoration inside the parenthesis
leaves the field unchanged. It is also the grammar 0008 established for its own decoration —
`PASS (threshold: error · 2 rules not verified)` — so a reader who has learned one has learned both.

**The condition is that no finding was emitted.** The decoration prints when, and only when, all
five counters — `error`, `warn`, `info`, `pass`, `skip` — are zero. What enforces it is the renderer
reading those counters and nothing else: `verdictLine` receives `summary` and prints the decoration
when each of the five is zero, so the claim it makes is exactly the claim the document makes. It
does not consult the catalog, it does not count the rules that are `off`, and it does not depend on
every rule emitting one of the five outcomes — that is a property of the thirteen `detect` bodies
today and not of the contract. A future rule that returns an empty list leaves five zeros and the
decoration prints, which is the correct reading: the run emitted no finding, and a verdict beside it
would be a claim the run did not measure.

**The `not run` line keeps stating the coverage, and it remains the only place that does.** The
decoration says a run measured nothing; it never says how much was covered. A run with one counted
outcome — one finding, one pass, one skip — prints the line it always did, so the decoration cannot
stand beside a count it would contradict, and a skip in particular is a finding, which makes the two
decorations mutually exclusive by construction rather than by convention.

**Nothing else moves.** The exit code stays `0`: the four codes are the machine contract (10.4), and
`0` names "a report within the threshold", which this report is. `summary.verdict` stays `pass`,
`schemaVersion` and every key of the JSON document of 10.2 stay, and a consumer reads exactly what it
read before. A run that turns every rule `off` is still a run the tool is asked to perform; this
record makes it legible, not refused.

## Conformance

Four tests, one per side of the condition and one per contract the change could have moved:

- all thirteen rules `off` by config: the decoration prints, the line is byte-identical to the one
  above, and the exit code is `0`;
- one rule `off` and twelve running: no decoration, because the run counted twelve outcomes;
- a run whose only outcome is a skip: no decoration, and the unverified count stands where it did;
- the JSON of the first case: the five zero counters and `verdict: "pass"`, with no key added.

## What this does not do

It does not make a run with zero checks fail, and it does not decide that it should: `#506` asked both
questions and the owner answered the second — the verdict says what it measured, the exit code does
not move. It does not change the `not run` line, its count, or its continuation; that line's lever was
already the config `rules` map (`#514`, `#516`), and this record leaves it as it is. It does not
extend the decoration to a run with any counted outcome, however thin the coverage there: a count in
`summary` is a measurement, and the verdict is not where coverage is argued.
