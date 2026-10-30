# RFC 0024 — the contract says what it does

| | |
|---|---|
| **Status** | `implemented` — the five amendments below are in [`docs/spec/`](../../docs/spec/README.md), and `tests/docs-contract.test.js` is what keeps them true. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 and §8.3, [`docs/spec/report.md`](../../docs/spec/report.md) §10.4, [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.2, as amended here. |
| **Supersedes** | nothing. |

## What the audit found

A read-only audit of every document against the code produced 60 findings and one that is not a typo.
Fifty-nine describe an earlier code. The sixtieth is a disagreement about a decision: the specification
says a refusal exits `2` in two places, and the code has exited `3` since 0008.

That is the shape of the whole finding set. The suite is green because the code is right; the documents
are the half nobody compares with anything. So this record does two things: it declares the five
amendments the spec needs to say what the code says, and it adds the test that compares the two.

## Amendment 1 — a refusal exits `3`, not `2` (§10.4, §11.1, §11.2, §11.3, §11.8)

**Decision.** The exit-code table is four codes and only four: `0` nothing at or above `--fail-on`,
`1` at least one violation at or above it, `2` the tool could not answer, `3` the command understood
the request and refused to act, writing nothing. `docs/spec/commands.md` said a dirty `init --apply`
and a `migrate --apply` without a lockfile exit `2`; both exit `3`.

**Reason.** 0008 established `3` and `docs/spec/report.md` §10.4 has carried it since. §11 is the
section that drifted, not the code: `RefusalError` is mapped to `3` in `src/cli.js`, and 0013 and 0018
depend on that reading. A refusal is a policy outcome about a situation the tool read correctly — the
branch is the default one, the target is dirty, the foreign lockfile is the only one —
so it cannot share the code reserved for a question the tool could not answer, and it cannot be `1`
either, because no finding crossed the threshold. §11.8's table still said `2` for the no-terminal
`skill --install` case while its own prose said `3`; I-45 settled that as a refusal, and the table now
says so too.

## Amendment 2 — the catalogue is twelve (§8.2, §8.3, §7.1, §12.5)

**Decision.** §8.2 keeps R1…R9 exactly as they are and gains R10, R11 and R12:
`ci-no-safety-overrides`, `pull-request-target` and `workflow-permissions`. The ids are not renumbered,
because `8.2 R5` is a citation in code comments, tests, commits and the decision log, and renumbering
would make every one of them point at a different rule. §8.3 becomes a deferred catalogue of the rules
that still are deferred, with a note that the three it used to defer have shipped. §7.1's `ci` target
row names the five rules that read it, §7.1's glob note and §12.5 say twelve instead of nine.

**Reason.** All three ship. They entered the catalogue through the frozen record's own §8.3 "0.2 scope"
clause — revision 4 of 0001 admitted them, and `odd/tasks/funky-secure-v0.2.md` T4, T5 and T6 built
them before `47e19cf` closed `0.2.0`. No numbered record was opened for them, which is why the count
drifted unnoticed: nothing compared the catalogue to the spec. From now on the specification for each of
the three is the code's own `detection` string plus `docs/rules/<id>.md`, because that is where the
reader already is, and `tests/docs-contract.test.js` fails when the two catalogues disagree.

## Amendment 3 — R6 accepts the template family (§8.2 R6)

**Decision.** A tracked file whose name starts with `.env` and ends with `.example` is a template, not
a credential, and R6 does not report it. The enumerated names (`.env.example`, `.env.test.example`) are
replaced by the family. `.env.sample`, `.env.template` and `.env.dist` stay in the exclusion list.

**Reason.** S1.3, measured on a real repository: `vercel/nextjs-subscription-payments` tracks
`.env.example` and `.env.local.example`, both templates with public values, and its README tells the
reader to copy the second one. The old list admitted two spellings of the same idea, so the tool
reported a leaked credential, `init --apply` could not clear it, and `baseline` could never pass on a
correct repository. A template is a file meant to be copied; whether its name is `.env.example` or
`.env.production.example` changes nothing about what it is. Real credential files — `.env`,
`.env.local`, `.env.production`, `.envrc` — stay findings, because the prefix rule is what makes the
over-matching glob of E4 safe in the first place.

## Amendment 4 — the reader accepts an indentless sequence (§8.2 R8, §8.2 R9)

**Decision.** A YAML sequence may sit at the same indentation as its key — the *indentless* form — and
the structural workflow reader of `src/lib/workflows.js` accepts it. `steps:` followed by `- uses:` at
the key's own column is a steps sequence, and the five CI rules see the steps in it.

**Reason.** S1.1, measured on `yarnpkg/berry`: 35 of 35 workflows are written that way, which is the
shape GitHub's own templates produce. The reader refused every one of them as
`unparseable workflow — sequence item at line 14 where job "debug" expects a key`, so
`actions-pinned-sha`, `no-bot-auto-merge`, `ci-no-safety-overrides`, `pull-request-target` and
`workflow-permissions` produced zero signal across 175 checks — and the verdict still printed `PASS`.
The previous field round's "6 of 6 CI rules detect" was true and useless: those six workflows were
written by the agent, in the deep-indent shape only. An unparseable file is a `skip`, and a skip is
honest; five rules skipping every file of every real repository is not a report, it is a silence with a
verdict on it. The same paragraph corrects §8.2 R8's remediation, which still prescribed
`gh api …/git/refs/tags` after 0021 made it `git ls-remote`.

## Amendment 5 — W2 negates the template family and carries `node_modules/` (§8.2 R7, §11.2)

**Decision.** The managed `.gitignore` block negates `!.env*.example` — the family — instead of
enumerating `.env.example` and `.env.test.example`, and it also carries `node_modules/`. The block is
six entries always (`.env`, `.env.*`, `!.env*.example`, `*.pem`, `*.key`, `node_modules/`) and seven
unless the repository tracks a root `.npmrc` without a token.

**Reason.** S2.9, found while fixing S1.3: the rule began accepting the whole `.env*.example` family
and the block that the same tool writes still covered two spellings of it. `.env.local.example`
matches `.env.*` and matched neither negation, so after `init --apply` an ordinary repository ignored
its own template and could not add a `.env.production.example` at all — measured with
`git check-ignore --no-index`. The rule and the write path disagreeing is a defect in either direction,
and here it made the product's own repair break its own finding. `node_modules/` is 0022's half of the
same block: the step the tool prints creates it, so the path that promises a clean tree has to ignore
it.

## What it costs

Nothing in the code. These are amendments to a specification that lagged it, plus one sentence in a
rule's remediation. The cost is on the other side: `tests/docs-contract.test.js` now fails when a
command, a flag, an exit code, a version string, a rule page or a path in `AGENTS.md` stops matching the
code, which means a release that changes the surface has to change the page in the same pull request.

## Verification

- `node --test`: green, and `tests/docs-contract.test.js` is part of the suite.
- `grep -rn 'pnpm install' docs skills README.md` finds no step that claims to resolve a foreign
  lockfile: the step is `pnpm import` everywhere it is printed.
- `docs/spec/commands.md` contains no sentence that calls a refusal `exit 2`, and
  `docs/spec/report.md` §10.4 still describes the four codes.
- `docs/spec/rules.md` carries 12 `#### R` sections, the catalogue in `src/rules/index.js` exports 12
  rules, and every id has a page under `docs/rules/`.
- The self-scan exits 0 at `--fail-on warn`.

## Alternatives rejected

- **Renumbering R1…R9 so the three new rules sort into place.** Every citation of `8.2 R5` in the code,
  the tests, the decision log and twenty records would silently start meaning a different rule. A
  catalogue is a list of names, not a sorted set, and order is already a contract reported as report
  order.
- **Opening one record per amendment.** Five amendments with one cause and one verification are one
  review unit; five records would be five frozen bodies that say almost the same thing.
- **Fixing the documents without the test.** That is how the 60 findings happened. A release that
  changes a printed step has to grep the step, and a test that reads the sources is the only grep that
  runs itself.
