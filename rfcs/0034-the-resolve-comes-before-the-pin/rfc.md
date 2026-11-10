# RFC 0034 — the resolve comes before the pin

| | |
|---|---|
| **Status** | `implemented` |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.7 |
| **Supersedes** | none |
| **Superseded by** | none |

## 1. The problem

Rows 7 and 8 of the step table fire on two conditions and neither of them mentions a lockfile's
contents: row 7 prints when the report carries a `floating-range` finding, and row 8 prints because
row 7 printed. Row 8's stated rationale describes a different world from the one it runs in — "`pin`
writes exact specifiers over a lockfile that recorded a range" — and 0015 turned the assumption behind
it into prose: in a repository that already has a `pnpm-lock.yaml`, the step moves up and "the order
stays causal", because an existing lockfile is taken to supply the versions `pin` reads.

A current `create-next-app` breaks that. Its `pnpm-lock.yaml` is 78 lines and records no dependency
version at all: `packageManagerDependencies` for the pnpm the project manages, and the
`@pnpm/exe` packages for each platform. `pin` reads the lockfile, so it has nothing to copy, and it
says so correctly, dependency by dependency — "floats and the lockfile records no version, so it is not
pinned". It then pins nothing, on a path whose step says:

```
4  funky-secure pin --apply  pin the 5 ranges this repository already has
```

The tool is honest about each range and wrong about the plan, which is the failure this repository
treats as the expensive one: a reader who follows a step and watches it do nothing has been told
something false by the command they were told to trust.

The order is the cause, and it was measured as one. Running `pnpm install --lockfile-only` first and
then `pin --apply` on the same repository pins all five (`20.19.43`, `19.3.0`, `19.3.0`, `9.39.5`,
`5.9.3`); the closing scan then ends with no warning, where the unmodified path ends with five. The npm
path is unaffected and stays as it is: `pnpm import` produces the lockfile there, with the versions the
foreign one recorded.

## 2. The decision

**When a `pin` step prints and no `pnpm import` produced the lockfile, the path prints
`pnpm install --lockfile-only` immediately before it.** The resolve that follows the pin stays where it
is. The block reads:

```
  n    pnpm install --lockfile-only
  n+1  funky-secure pin --apply    pin the N ranges package.json declares
  n+2  pnpm install --lockfile-only
  n+3  git add package.json pnpm-lock.yaml && git commit -m "<message>"
```

Two resolves, and not one of them is redundant: the first makes a version available for `pin` to read,
which is what the pin needs; the second re-syncs the lockfile the pin desynced on purpose, which is
what the tree needs. They answer two different questions, and the step between them is the only thing
that turns a range into a version.

The condition is the pin's presence plus the absence of a foreign lockfile, and both are facts the
derivation already holds — `pins > 0`, `foreign.length === 0`. No probe is added and the path is still
a function of the repository.

## 3. Why the new resolve is not conditioned on the lockfile's contents

The precise trigger is "the lockfile records no version for at least one range `pin` would rewrite",
and this tool knows it: `collectPins` fills `unrecorded`, and it is the reason each per-dependency line
can say what it says. Conditioning on it would be more exact and it is rejected, for two reasons.

1. **It would cost a change to the machine contract.** That fact never leaves `pin`: `start` counts
   `floating-range` findings and does not import the pins module. Putting it on the finding would add a
   field to the JSON report to decide the position of a step, and the JSON report is the contract this
   product sells. An order bug does not get to redraw it.
2. **A conditional position is invisible.** The reader would see a plan of five steps or of six, and
   the reason for the difference would be printed nowhere. This path has one predicate that works that
   way already — whether a lockfile will exist at the end — and it earns its secrecy by changing the
   last step only. The middle of the path is where a reader looks for cause, and a resolve that appears
   and disappears is a step whose necessity cannot be checked.

The price is stated plainly rather than hidden: in a repository whose lockfile already records every
version, an extra `pnpm install --lockfile-only` prints and writes the same bytes it read. It costs a
second and it changes no state. That is the trade this record chooses over a cheaper plan whose
difference the reader cannot see.

## 4. The wording of the step

**The label names the manifest, not the outcome:**

```
funky-secure pin --apply    pin the N ranges package.json declares
```

`N` keeps its current value — the `floating-range` count — because the number of ranges to fix is a
fact about the manifest and not a promise about the lockfile. What changes is the verb's object: the
old sentence said the ranges were there *and* that the step would pin them, which is two claims and
only one of them is knowable when the plan is printed.

Even with the order fixed, a pin can rewrite fewer ranges than the plan announced: a machine without a
network cannot resolve, and a dependency the registry no longer serves cannot be resolved at all. The
step must therefore be true in the state where nothing resolves, and the only sentence that is, is the
one that says what the manifest carries.

## 5. What this does not change

**0011 is not superseded.** Its decision was that the plan prints the pin and its resolve, in that
order, and both still print in that order. What this record adds is a resolve *before* the pin, for a
state 0011 did not consider — the lockfile that exists and records nothing. The order between the pin
and the resolve of the same write is untouched, and so is 0028: the commit still follows the resolve
that requires it, now by two steps instead of one.

**The migration path is untouched.** There `pnpm import` produces the lockfile from the versions the
foreign one recorded, so a resolve before the pin would be a second resolve where the first is the
import. The condition excludes it by construction.

**The verdict is untouched.** A path where the ranges still float ends `PASS (threshold: error)` with
one warning per range. That is the honest signal and it is what the reader acts on; this record fixes
the plan that promised otherwise, not the threshold that reported it.

**Specifier-level honesty is untouched.** A range whose lockfile records no version is still listed as
not pinned, with its reason, and never guessed (11.9). This record does not make `pin` guess; it makes
the path produce the lockfile `pin` reads.

## 6. The enforcement

A contract that no test reads is a comment. Four directions:

1. **The order is pinned where the field failed.** A pnpm path over a manifest with floating ranges and
   a lockfile that records none renders the resolve before the pin. The fixture already exists —
   `tests/start.test.js` writes an empty lockfile — and it has been asserting the defect as the expected
   output, which is why nothing failed.
2. **The second resolve stays.** The step after the pin is still the resolve, asserted by position and
   not by presence: a test that only counts steps would pass with both resolves collapsed into one.
3. **The migration path gains no leading resolve.** A repository with a foreign lockfile prints
   `pnpm import`, the pin, and the resolve after it, and nothing before `pin`.
4. **The wording is pinned exactly**, in the same tests that pin the order, because the sentence and
   the step are one promise.

The npm path's eleven steps are asserted unchanged: the whole point of the distinction is that the
resolve the import already performs is not printed twice.
