# Post-release pendings: two couplings, a stash, two lineages, a field loop, a skill

Six items survived `0.13.0`: two internal couplings a native review reported, one parked tree, one governed
by provider authority no agent may clear, one field loop the last campaign deferred to *after* the release,
and one exercise of the rewritten judge skills — which this document's own three rounds perform. A seventh
spec arrived with the owner's second message: how the loop must behave when it runs.

## Specs

**S1** — the owner's request, verbatim:

> continuemos los pendientes que dejamos, crea el plan y usa funky judge. Despues de que el plan esté correcto implementa

**S2** — the carried list. **Provenance, stated plainly:** these six bullets were carried into this session
from the native review lineage `review-c69408adc835ebcb` (findings `R2-001`, `R2-002`) and from the memory
written after the release; **no committed artifact in this repository holds their text**, so they are
reproduced here as received, not quoted from a file. They are `:18-23` of this document.

> 1. **`R2-001`** — `src/commands/start.js:342`. The unnumbered note is attached by comparing the rendered step string to `ADD_STEP` and recomputing the prefix width; if the line is decorated or the formatter changes, the note vanishes silently while 11.7 still requires it. Cure: a structured step identity or a shared formatter.
> 2. **`R2-002`** — `src/lib/workflows.js:331-332`. The indentation indicator is extracted with an inline double-negative ternary over positional captures; a later regex edit silently changes whether an explicit indicator is honoured. Cure: extract the sign validation and name the captures.
> 3. **`stash@{0}`** — `On review/s1: park: f4 tree probe`, 2026-10-23, 85 files / 7 242 insertions, branch `review/s1` gone. Export to a patch **outside** the repo, then drop. Owner's call.
> 4. **The clone sweep (T11)** — measure the missing side of `foreign-lockfile`, `exact-versions`, `actions-pinned-sha`, `workflow-permissions` (their passing side) and of `quarantine` (its failing side), on real repositories.
> 5. **Two inert native lineages** — `review-4bde784c5bbb85fe` (`correction_required`, medium) and `review-d0d20c0eca69eb78` (`escalated`, high). Neither blocks while no review is due; recover/abandon need explicit authorization.
> 6. **Exercise the rewritten funky-judge skills** in a real session; they have never run as written.

**S2-note — a homonym, named so no reader conflates them.** `odd/tasks/next-release-backlog.md:80-82`
carries its own `R2-001` (its S13), about a *probe fixture* built from a constant, and it landed as
`62fa2cb` (#291). Its cure is about a fixture, not about `start`'s renderer. Bullet 1 above is a different
finding on a different file.

**S3** — the sweep is in scope **because** the release shipped, not in spite of it. The owner's words when
they moved it: *"para dejar para post release los pendientes que quedaron como clones, etc"*. Post-release
is this document. An earlier note of mine called it "deferred to another release"; that reading is corrected
here and in the Log (L3).

**S4** — no behaviour moves. T1 and T2 are internal restructurings: every printed `start` byte and every
parsed workflow must be identical, and the suite must pass with **no expectation edited**. One qualifier,
because a gate that cannot be run must not be certified: most of the twelve header spellings M4 measured
never occur in the suite, so for those "identical" is **read**, not run. T2 therefore writes the expected
value of each into its own table, and from then on the test carries them.

**S5** — the two lineages are recorded, never mutated, and every fact is attributed to the record that holds
it:
- **In `review-state.json`**, and re-checkable by any reader: the states and tiers —
  `correction_required`/`medium` and `escalated`/`high` — and lineage 1's `base_tree` `c11f014`.
- **Not in the record:** lineage 2's `review-state.json` carries `base_tree` `345ff6faa334…`. The value the
  status answer printed for that lineage, `3ddd6913`, is **`main`'s own tree** (`3b737f3^{tree}`) and appears
  nowhere under `.git/gentle-ai`. Recording it as the lineage's base would be false; the discrepancy is
  recorded instead, because a projection anchored on the current tree no longer distinguishes its candidate.
- **Only in the status answer this session received:** `action: recover`, `manual_action_required` and a
  six-input native command. Neither `.git/gentle-ai` nor `C:/Users/cb147/.agents` carries them, so their
  effect is not verifiable from the record, and T4 records those three **as received**, never as verified.
  L9 measured the half that matters: they are **not inert**, because the escalated one absorbs every
  delivery candidate in this repository.

**S6** — delivery: one work-unit commit per task, `--merge` and never squash, merge only on
`gh pr checks <n> --json state` with no state outside `SUCCESS`/`SKIPPED`/`NEUTRAL`.

**S7** — how the field loop must run, in the owner's words:

> cuando iniciemos el field loop de los clones, debemos ser muy criticos, encontrar mas defectos, refutar, tratar de encontrar errores, no fiarnos de todo, entre mas tratamos de romper algo, mas detectamos las fragilidades de nuestro codigo. Eso fue nuestro error en el field loop de la primera release. Hoy somos mejores que antes, la proxima release deja todo mas pulido, con evidencia en validation.md e incluso si crece de mas podemos separarlo mejor

Three obligations follow, and each is checkable: **state the expected result before the run**, so a surprise
is visible as a surprise; **report the defects it finds as issues with their own pull requests**, never as a
silent fix inside this batch; and **leave evidence in `docs/validation.md`**, a moved row or a measured
claim, because coverage claimed is coverage nobody tests again (`docs/field-loop.md`, last section). The
growth clause is a mechanism, not permission: if the loop outgrows one work unit it is split by the boundary
T5 names in advance, never trimmed.

## Measured before planning

Runs, not readings. Each one either survives the plan or corrects it.

| # | What was run | Result |
|---|---|---|
| M1 | Deleted `src/commands/start.js:342`, ran `node --test tests/start.test.js`, restored the file | **Red.** `tests/start.test.js:381` (`#139`) asserts the note as `lines[at + 1]` at `:394`. The note is *not* untested, and R2-001's "vanishes silently" is refuted **for the state that test builds**. The coupling is real; the silence is not |
| M2 | `git log -1 --format='%H %p' stash@{0}`; `git merge-base --is-ancestor` on both commits; `git ls-tree -r` on each parent | The stash **is** `1d7abf9`, a commit with three parents — `1e08692 264179e ce8f200`. Its first parent `1e08692` **is** an ancestor of `main`; the stash commit itself **is not**. The third parent, where a stash keeps untracked files, is the empty tree `4b825dc` with zero entries, so the tracked diff is the whole of it. An earlier draft of this row said the opposite and is corrected in L6 |
| M3 | `grep -rn "  [0-9][0-9]  " tests/start.test.js` | Three two-digit expectations, all `SCAN_STEP` (`:544`, `:614`, `:797`), and all three fixtures carry a foreign lockfile, which is the branch that suppresses the add. No state this plan or the suite exhibits prints the note's step at a two-digit index. **No bound is claimed**: the two judges disagreed about one and neither ran it; what the task needs is that the width is computed once, not that it is exercised |
| M4 | Twelve header values pushed through `src/lib/workflows.js:331-332` | `\|`, `>-`, `\|0`, `\|10`, `\|12` → no header, indicator `null`; `\|2`, `>2-`, `\|-2`, `\|2-`, `\|+2`, `\|2+` → the **string** `"2"`, which `:335` turns into a number with `Number()`. **`\|+2-` → `null`**. All twelve pass the looser `BLOCK_SCALAR` gate at `:52`, so a rejected header falls back to inference instead of leaving the reader |
| M5 | `grep -n "funky-judge"` in `.atl/skill-registry.md` and `C:/Users/cb147/.atl/skill-registry.md` | **Both already carry the rewritten descriptions** (`.atl/skill-registry.md:25-26`, `C:/Users/cb147/.atl/skill-registry.md:23-24`). The "stale registry" debt recorded after the skill rewrite is refuted; `references/` files carry no frontmatter and are correctly absent from an index of skills (L4) |
| M6 | `node bin/funky-secure.js scan --scope repo --only actions-pinned-sha,foreign-lockfile --format json` | exit `0`, `summary {"pass":2,"skip":0,"verdict":"pass"}`. Both rules' missing side is observable **in this repository**, so T5 needs no clone for them. A full SHA is necessary but not sufficient — the step must also parse, and a `docker://` reference needs its digest — which is why the evidence is the run and not a line scan |

## Tasks

**T1 — `start`: the step carries its note** (`S2.1`, `S4`). `pendingSteps` (`src/commands/start.js:215`) and
`pendingBootSteps` (`:70`) return `{ text, note }` entries instead of bare strings; `renderStart` (`:329`)
prints `entry.text` and appends `entry.note` when present, so the renderer never compares a step against a
constant. The note stops being reachable only by string equality with `ADD_STEP` (`:117`, pushed at `:261`,
matched at `:342`). **Every read that must change**: `:337` builds `printed` as `[...pending, SCAN_STEP]`,
leaving a bare string among the entries; `:339` prints the loop variable; `:342` is the equality this task
removes; and `:347`, `:355`, `:356`, `:360`, `:380` are the `.some(...)` predicates. The entry carries the
note **text**; the indentation stays in the renderer, where `index` is in hand. The spec puts the line on the
step — *"one line follows that step"*, `docs/spec/commands.md:384-389`, naming step 14 and saying the line
*"changes neither the numbered list nor the count"* — so what this removes is the coupling between a
contractual line and a string constant. Row 1 cannot precede it: a directory outside git diverts at `:410` to
`pendingBootSteps`. `tests/start.test.js:381` must pass unedited. Route: small, inline. Commit: this PR.

**T2 — `workflows`: the block header parsed once** (`S2.2`, `S4`). Extract `parseBlockHeader(value)` from
`readBlockScalar` (`src/lib/workflows.js:331-332`), with the one-sign rule named. **Four hazards, named so
the cure does not introduce them**: (a) the extraction is **not** the `BLOCK_SCALAR` gate at `:52` —
`|+2-`, `|0` and `|10` pass the gate and must still enter the reader, falling back to inference, which is
what M4 measured; (b) `:335` compares with `=== null` and then calls `Number(...)`, so the extraction either
returns `null` **and** a numeric indicator, or returns `null` **and** its string — the plan chooses the number
and the test states `2`, never `"2"`; `undefined` yields `NaN` either way; (c) the `indent` argument differs
by site — `:295` passes its own parameter, `:539` and `:906` pass `entry.indent`, `:750` passes
`child.indent`; (d) `fold` is derived from the same `value` at `:325` and must not be left behind. Unit-test
the table with the expected value of all twelve M4 spellings, which covers the shapes the suite never
reached; keep `tests/workflows.test.js:267`, `:294`, `:317`, `:338` unedited; cite the rule at
`docs/spec/rules.md:274-275`, and say that the one-sign rule lives only in the code's own comment
(`:329-330`), not in the spec. Route: small, inline. Commit: this PR.

**T3 — the stash exported, then dropped** (`S2.3`). `git stash show -p stash@{0}` into
`C:/Users/cb147/.agents/backup/stash/park-f4-tree-probe.patch` — outside the repository, as the item says.
The parents make the export faithful to what it is: it is the first-parent diff (M2), it carries the **tree**
and not the staging split, and the third parent is the empty tree, so no untracked file is lost. Then
`git apply --check` against the extracted tree of **`1e08692`** — the tree the patch was taken against, not
`1d7abf9`, which already contains it — and then `git stash drop`. If the patch cannot apply, it is kept and
the failure recorded; a patch that cannot apply is still the only copy of those 7 242 insertions. Route: no
code. Commit: none of its own; the record lands with T6.

**T4 — the two lineages recorded** (`S2.5`, `S5`). The Log carries what `S5` attributes: the states, the
tiers and lineage 1's `base_tree` as the record holds them; lineage 2's recorded `345ff6fa` beside the
`3ddd6913` the status printed and the fact that it is `main`'s tree; the disposition each one answers with;
and which of them the provider can still move. **The opaque values are deliberately not reproduced** — a
revision hash and a six-input recovery command pasted into a published record invite a replay nobody
authorized, so the Log names the options and not their values. It also carries L9's measurement that the
escalated lineage absorbs every delivery candidate here. Nothing is executed. Route: no code. Commit: none
of its own; the record lands with T6.

**T5 — the field loop** (`S2.4`, `S3`, `S7`). Two outputs, neither optional:
- **The five rows of `docs/validation.md:66-70`.** `actions-pinned-sha` and `foreign-lockfile` are measured
  in this repository and their rows move out (M6). `workflow-permissions` needs a clone of a repository whose
  workflows all declare permissions. `exact-versions` needs one whose specifiers are all exact, and a clone
  is attempted. `quarantine`'s failing side is measured in a scratch repository with a failing declaration —
  the page accepts that kind of evidence (`docs/validation.md:80`) — and a row that does not gain its other
  side **stays exactly as written**, because the page asks for no sentence of excuse (`:60-62`, `:72`).
- **The loop itself** (`S7`): repositories nobody on the implementation side chose, the expected result
  stated before each run, the tool pushed until it breaks, and `docs/field-loop.md`'s triage applied to what
  comes back — a report is a hypothesis, a defect is distinguished from a mis-specified brief, a contract
  from a bug. **Every defect becomes an issue and its own pull request**, and **every finding becomes a
  case**: the fixture taken from the agent's own files, an absence asserted as a hash or a tree state, a
  broken promise named after the promise.

The split is decided now, not if it hurts: **T5a** is the five rows and the evidence page; **T5b** is the
defects the loop finds, each with its issue and its pull request. T5a lands; T5b lives as long as its
findings do. **The clones**: `M:/pruebas/real` holds sixteen entries — genuine clones, copies of them and
scratch output from earlier rounds — and the owner offered that directory both for this loop and for
deletion. T5 enumerates it before it picks a scenario, reuses a genuine clone as a baseline, and does not
count a copy of a shape an earlier round already covered as a new scenario (`docs/field-loop.md`, "When not
to"). Acceptance: no defect fixed without a case, no row moved without a named repository, the command and
the observed output, and the number of scenarios reported rather than promised. Route: measurement plus
docs; needs no network for a clone that already exists. Commit: this PR for T5a.

**T6 — this document lands naming its commits** (`S1`). Each task gets the commit that produced it; T3 and
T4 record this one. A commit cannot contain its own hash, so the document names none for itself: the pull
request body names it, and the document says so. A record that ships inside the change it describes is read
later as current, so it lands last. Commit: this PR.

**T7 — the record's stale rows, discovered while planning** (`S1`'s "nothing left unattacked" clause; not
one of the six). `odd/tasks/next-release-backlog.md` still shows `Commit: —` for T2, T5, T6, T8 and T15a,
and every one of them landed: T2 `745881b` (#284), T5 `6be24e7` (#290), T6 `62fa2cb` (#291), T8's row split
into T15a `3befd3f` (#296) and T15b, which names its own two. The document is append-only, so the cure is a
dated `## Errata` naming each commit — never an edit. Route: docs only. Commit: this PR. Drop it if the owner
prefers the record to stand as written.

## Not in this document

- **Any mutation of review authority.** `recover`, `abandon` and `reset` need a fresh human authorization and
  the provider's exact inputs; T4 records them and stops (`S5`).
- **Pushing, merging or publishing.** Merge and push follow `S6`; this plan authors nothing remote.
- **A task for `S2.6`.** Exercising the rewritten skills is what this document's own rounds do; the outcome
  is recorded in the Log (L5) instead of becoming work about work.

## Log

**L1** — the owner's request, verbatim: *"continuemos los pendientes que dejamos, crea el plan y usa funky
judge. Despues de que el plan esté correcto implementa"*.

**L2** — M1 refuted this plan's own first premise. Drafting T1, the plan said *"the note has no test; delete
`:342` and the suite stays green"*. That sentence came from a `grep` for the constant's name, and the test
spells the note's text instead of importing it. The deletion was then **run**, and the suite went red. The
premise was false; the task survives only on the narrower fact that the renderer identifies a step by its
text.

**L3** — the sweep's deferral is corrected. `odd/tasks/next-release-backlog.md` and the memory written after
the release both say "deferred by the owner to another release". The owner's own words deferred it to
*post-release*. It is in scope here (`S3`); the earlier phrasing is recorded rather than edited, because the
campaign document is append-only.

**L4** — the registry debt is refuted, not done. Both `.atl/skill-registry.md` rows already carry the
rewritten descriptions, so there was nothing stale to refresh (`M5`).

**L5** — `S2.6` is exercised by this document's own judging. Two observations worth keeping: the router's
step 0 was followed literally — protocol and flow contract read before either judge was dispatched — and both
judges attacked the artifact's *citations* rather than its prose, which is the behaviour the flow contract
predicts. The cost is operational: a round needs a frozen hash and a word cap to stay useful, and a dispatch
of two foreground judges died at the harness with no findings, while the background ones completed.

**L6** — round one's adjudication, with the fact that decided each line:
- **Won, and verified here**: the stash's base is `1e08692`, not `1d7abf9` (`M2`); "five items" against six
  bullets; "verbatim as recorded" has no artifact (`S2`); `S5` claimed commands the document did not carry;
  T1 missed `:337` and `:347`; `S2.2`'s range `:332-333` for a regex at `:331` (repaired in this revision).
- **Won, from one judge and adopted**: that `actions-pinned-sha`'s other side is in this repository.
- **Lost**: that the artifact says `renderStart` is called at `:416` and `:441`. It does not — those numbers
  were in the judges' own question set, not in the artifact. The calls are `:413` and `:461`.
- **Partial, and narrowed by round two**: that T4 cannot close. It can — the strings arrived in this
  session's provider answer — but only the states, the tiers and lineage 1's base are re-checkable from the
  record; the recover command is not.
- **Refused as a requirement**: that T5 must add a sentence for each row it cannot move. The page asks for no
  such sentence; it asks that a row not gain a side it does not have.
- **Disagreement, decided by removing the claim**: the two judges bounded the note's index differently (≤5
  and ≤7) and neither ran it, so `M3` states the observation and no bound.

**L7** — round two's adjudication. It corrected the corrections, which is the round's whole purpose:
- **Won**: `S5`'s `3ddd6913` is `main`'s tree and lineage 2 records `345ff6fa` — the one entry that would have
  written a false value as received; T5's refusal to measure `quarantine` in a scratch repository
  contradicted `docs/validation.md:80`; `:750` passes `child.indent`, not `entry.indent`; the extraction must
  say whether the indicator is a string or a number (`M4`); `fold` at `:325` was a hazard nobody had named;
  T6 cannot name its own commit; T7 can name five commits instead of one; "three spellings the suite never
  exercises" was wrong, so no count is claimed and the table carries all twelve.
- **Refused**: that `M6`'s conclusion rests on a line scan. The line scan was replaced by the run (`M6`), and
  the caveat that a full SHA is necessary but not sufficient now sits beside it.
- **Adopted from the owner, not from a judge**: `S7`. The field loop's stance is now a spec with three
  checkable obligations, and T5 is split in advance rather than after it hurts.

**L8** — the owner's field-loop message, verbatim, is `S7`. It arrived after round one, was held until both
round-two reports were in, and changed one task (T5) and one spec, not the artifact's facts. The clones it
refers to are `M:/pruebas/real`, sixteen entries of clones, copies and scratch output from earlier rounds.

**L9** — the two lineages are **not inert**, and a note I wrote after `0.13.0` said they were. Measured
while trying to push T1: `gentle-ai review status --contract=gentle-ai.review-integration/v2 --cwd .
--base-ref main --committed-only` resolves the current candidate onto `review-d0d20c0eca69eb78` — the
*escalated* lineage, `action: recover`, `manual_action_required` — and its projection names the two
documents this batch touches. Every delivery command in this repository is then refused with "Native
preflight is unavailable", which is gentle-pi's catch-all: the preflight's ten-second bound is not the
cause, because a native assess over the same range answers in 0.7 s with `review due: no`. T4 therefore
stops being a record-only task: the authority has to be released before a pull request can open, and only
the owner can authorize it (`S5`).

**L10** — T4, the two lineages as the record and the provider answer hold them. Both are non-terminal
compact entries; `review-4bde784c5bbb85fe` is `correction_required` at tier `medium` with `base_tree`
`c11f014`, and answers `action: recover` with disposition `scope_changed` and a six-option native command;
`review-d0d20c0eca69eb78` is `escalated` at tier `high`, its `review-state.json` records `base_tree`
`345ff6fa`, and the status prints `3ddd6913` — which is `main`'s own tree, not a base. The second answers
`action: recover` with disposition `escalated` and emits **no** transition, and `abandon` refuses it as
ineligible; `repair --preflight` reports `unsupported` and `inspect-authority` reports the store complete
and valid. The opaque revisions and option values are not reproduced here, on purpose (T4). Nothing was
executed, and *inert* is not a word this record uses any more.

**L11** — T3 closed. `git stash show -p stash@{0}` went to
`C:/Users/cb147/.agents/backup/stash/park-f4-tree-probe.patch` — 314 562 bytes, 8 198 lines, `sha256
59cd3cd3…` — outside the repository. `git apply --check` against the extracted tree of `1e08692` (57
files) exited `0`, and only then was the stash dropped: `1d7abf9` is gone and the stash list is empty. The
patch carries the tree and not the staging split, and the third parent was the empty tree, so nothing
untracked is lost (M2).

**L12** — the delivery gate, diagnosed rather than worked around. The refusal is gentle-pi's `catch` at
`lib/review-delivery-preflight.ts:81`, and what throws is `cli.assess` at `:68`: the delivery base this
session retains is the branch tip, so the committed range is empty and `gentle-ai review assess
--base-ref <HEAD>` exits `1` with *"the review assess candidate has no pending changes"* in stderr while
printing a success-shaped body on stdout. The client reads a non-zero exit whose body is not a *failure*
envelope as `NON_ZERO`, and `:81` erases the code into "Native preflight is unavailable". Reproduced by
hand: exit `1`, that stderr line, that body. Three consequences worth keeping: the escalated lineage is
**incidental** — with a real base, `targetStatus` answers `applicability: unrelated` and the due-review
branch at `:71` is never entered; nothing in the store needs clearing, because the `LOCK` is zero bytes and
blocks no read-only call (`inspect-authority` reads through it); and the ten-second bound is only reachable
for a wide base — `assess --base-ref 3508f17` alone took 5.4 s. Two routes remain, neither of which turns
the switch off: re-seat the retained base, which the registry keeps per session and which a workspace
assessment does not erase, or open a session whose registry is empty, where the preflight asks for the base
in its own words and the next assessment sets it.
