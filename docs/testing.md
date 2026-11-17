# Testing — when a test is required, and what makes one admissible

The suite is the repository's record of what the tool promises, and a test is the only place a promise is
executable. `odd/tasks/next-release-backlog.md:330-349` wrote the row this page answers: *"no page states when a
test is required or when one is inadmissible"*. This is that page.

It is a policy for **new and changed tests**. It does not retroactively condemn the suite: where an existing test
is written another way, this page names the exception and says why it holds — and, where the exception is debt, it
says that too.

## What is the contract

`docs/spec/report.md:240-241` is explicit: *"The JSON document of 10.2 is the contract; the human text above is
presentation. A minor release may change that presentation."* So there are two classes of assertion, and they are
not the same:

- **The JSON document** — a finding's `code`, `status`, `message`, `path`, `line`, `evidence`, `remediation` — is
  the contract. A field that moves is a behaviour change and gets a test that would fail without it.
- **The human text** is presentation. It still gets a test when the change *is* a presentation change, because a
  line that misleads is the defect — but a test asserting presentation is not a proof that the contract holds,
  and a minor release may move it (`docs/README.md:11`).

## When a test is required

When a change alters something a caller can observe:

- an exit code, or which of the four codes a state produces (`docs/spec/report.md` §10.4);
- any field of the JSON document, including its absence;
- any byte the tool prints, when the printed bytes are what the change is about;
- the state of a tree after a command: files written, bytes preserved, files left alone;
- a golden, when the report was meant to change.

One test per rule the change introduces. The assertion is **the effect**, never the implementation: the exit code
*and* the output *and*, for a command that rejects input, that the rejected input left stored files and counters
untouched. A test that asserts the exit code alone passes on a tool that prints nothing — and this suite has one
of those: `tests/open-pr.test.js:971` destructures `{ code }` and nothing else for the `UNKNOWN` verdict, where
its siblings assert the message for the same contract. That is the shape to avoid, not a rule already met.

## When a test is not required

- **A page, a comment, a decision row.** Nothing executable moved. The gates that still apply are the drift and
  documentation-contract tests, which check that the pages agree with the catalog.
- **A spec sentence on its own.** Rewriting `docs/spec/` is not a behaviour change; the code that must follow is.
  When the code follows, the test belongs there.
- **A defect the suite could not have seen.** It gets a test at the moment it becomes a rule — and the field loop
  exists to invent it, not to skip it.

What does not exist here: a **coverage target**. No step enforces one, and a percentage would reward the wrong
file.

## The five admission tests

A new test is admissible when all five hold. Each is written to be true of the suite as it stands, with its
exceptions named.

1. **It pins the interface that owns the promise.** A rule's `detect`, a command's `run`, or a pure function's own
   signature — never internal storage. A unit test of a pure function is admissible and common here (31 test files
   import from `src/lib/`); what is not admissible is asserting a promise the public interface makes by reaching
   into the state behind it.

2. **It can fail for its own reason.** Delete the source line it pins and it goes red. Asserting that something is
   a function, or that two calls in one process agree, satisfies no promise: `tests/report.test.js:552` compares
   `renderHuman(x)` with `renderHuman(x)` under a name that claims determinism on every run, and
   `tests/rules/ci-no-safety-overrides.test.js:121` asserts `typeof rule.detect === 'function'`, which a rule
   returning `[]` for every input still passes. Those are the shape to avoid.

3. **Every observable effect of the change is asserted somewhere, and the rule's own test asserts its verdict and
   its message.** The effects may live in more than one file when the suite shares them deliberately: the exit
   matrix is one test in `tests/invariants.test.js` for all thirteen rules, and a rule's own file asserts what is
   its own. A change that touches a rule is not done until the shared matrix still passes, because that file is
   the test.

4. **It is deterministic**, with three named exceptions and no others: no clock and no network appear anywhere in
   the suite (measured: zero files), and a bare `spawnSync('pnpm')` is banned outright (the three mentions are
   comments saying why; eight files use the project's resolver).
   - An **absolute literal path** that is never dialled is admissible — twelve files use `/repo/...` fixtures to
     test string handling, and no file system is touched.
   - The **documentation-contract tests read the repository by absolute path**. That is the input under test, not
     ambient state.
   - **`t.skip` is admissible only with a reason that names the host** — ten today, each printing why. A skip
     without a reason is a green test that measures nothing.

   Everything else follows: a fixture that touches disk lives in the OS temp directory, and every command runs
   with that directory as its `cwd`.

5. **It is named for the contract.** Six existing names begin `parseArgs`, `renderHelp` or `severityRank`
   (`tests/cli.test.js`, `tests/report.test.js`); they predate this rule and are debt, not precedent.

## The test that duplicates another

Two tests may not own the same contract. When a change makes a second test cover what a first one already pins,
the second is deleted or narrowed. The suite has known duplicates and they are debt:
`tests/render-human.test.js:97` and `tests/report.test.js:517` both assert the tie-break in the `next` block, and
the 96-column bound is asserted three times (`tests/report.test.js:394`, `:615`, `tests/render-human.test.js:118`).
The rule binds new work; the existing pairs are named here rather than silently blessed.

## What was considered and rejected

- **Rejected: a coverage target** — it rewards the wrong file.
- **Rejected: file-length caps (500 or 800 lines)** — length is not a promise, and a cap teaches splitting rather
  than naming.
- **Rejected: a meta-test policing test names** — it fails on a rename and passes on a lie; the review reads the
  name, a machine reads the assertion.
- **Rejected: a blanket "never hardcode copy"** — the JSON contract includes the finding's `message`, so the
  bytes are the product there; what the spec calls presentation is asserted where the presentation is the subject,
  not as a proxy for behaviour.

## Not yet built, and named rather than dropped

`odd/tasks/next-release-backlog.md:341-342` asks for *"a list of tests that cannot fail, found by mutation and
forbidden to grow"*. Two mutation rounds have been run — five of five killed (`docs/validation.md:229-230`) and
eight of eight killed (`odd/tasks/field-loop-every-rule.md`) — but there is no standing list and no gate forbidding
it to grow. That is campaign work, not a page.

There is a second, smaller debt that belongs to this page: `tests/docs-contract.test.js` checks that every path
named in `AGENTS.md`'s map exists, and nothing checks the reverse, so a new page can still be added without a map
row.

## Where this page meets the others

- **The field loop** (`docs/field-loop.md` §3, *"Pine it — or pay for it twice"*) discovers what the suite could
  not see; this page says how a finding, once found, becomes a test. The loop's step 3 is admission test 2 applied
  to a defect.
- **`CONTRIBUTING.md`** carries the checklist a pull request runs; its test line is this page applied to one
  change.
- **`docs/spec/`** stays the normative contract. Where this page and the spec disagree about *what* the tool
  promises, the spec wins; this page only says how the promise is proven.
