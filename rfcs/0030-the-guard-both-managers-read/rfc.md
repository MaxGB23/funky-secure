# RFC 0030 — the guard both managers read

| | |
|---|---|
| **Status** | `implemented` — `init --apply` writes the field beside the pin, without `onFail`, and the rule reads its three states. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.2 (writer `W3b`) and [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R1, as amended here and in the two errata below. |
| **Supersedes** | nothing. It adds a field to a write that exists, and narrows a skip 0020 introduced. |

## What a reader meets today

`init --apply` writes `packageManager: "pnpm@<version>"`. `packageManager` is a **Corepack** pin: pnpm
reads it and switches to the declared version, npm ignores it entirely. So in the repository the tool was
built to protect — the one migrating from npm — nothing stops an accidental `npm install`:

> init escribe sólo packageManager: "pnpm@12.3.4". Y npm ignora ese campo — es un pin de Corepack, no un
> guard.

`devEngines.packageManager` is the field npm **does** enforce, and it is read before the install, the CI
and the run. The owner's agent measured it on the repository's own case, npm 11.13.0 over a manifest with
`packageManager: pnpm@12.3.4`: `EBADDEVENGINES`, exit 1, and no `package-lock.json` written.

This tool already knows the field exists. It reads it, in `src/rules/package-manager-pin.js`, to decide
that a project managing its own pnpm version is a `skip` and not a conflict (0020, decision I-51). It
reads that sentence out of `package.json` and then never writes one.

## What the measurement changed

The owner's proposal was to write the field **with `onFail: "error"`**. Five measurements, in
[`evidence/onfail-and-autoswitch.md`](evidence/onfail-and-autoswitch.md), say the field is right and the
value is wrong:

- **`onFail: "error"` breaks pnpm's own version switch.** pnpm 11.28.10 against a repository pinned to
  12.3.4: with `onFail: "error"` it exits 1 — *"This project is configured to use 12.3.4 of pnpm. Your
  current pnpm is v11.28.10"* — and with no `onFail` at all (and with no `devEngines`) it exits 0 having
  re-executed as 12.3.4. The value that guards the repository also removes the mechanism that makes the
  pin work on a machine with another pnpm installed, which is most machines.
- **npm's own default is already `error`.** With `devEngines.packageManager` and **no `onFail`**,
  `npm install` exits 1 `EBADDEVENGINES` and writes no lockfile. With `onFail: "warn"` it exits 0 and
  writes `package-lock.json`. The default is the strict value; writing anything is a downgrade for one
  of the two managers and never an upgrade for both.
- **`onFail: "ignore"` is accepted by pnpm, and pnpm's documented default is `download`** — the value
  `pnpm init` writes, and the one npm does not accept. Omitting the key leaves each manager on its own
  documented default, which happens to be the one each needs.

## The decision

**`init --apply` writes `devEngines.packageManager` as `{ "name": "pnpm", "version": "<the pin>" }`,
under the same condition that already writes `packageManager`, and never writes `onFail`.**

- **Its own plan item (W4), not a line inside W3.** A writer that reports one path and changes two is the
  defect 0019 and 0027 both name from different directions, and the plan is the only place a human sees
  what will be written before it is. W4 shares W3's condition — the manifest exists, the key is absent or
  ambiguous — and produces a `conflict`, never an overwrite, when the manifest already declares a
  `devEngines.packageManager` the writer cannot match exactly. 0027's rule stands: a value the tool
  cannot interpret is never treated as absent.
- **Never `onFail`.** Stated as a decision and not a default left unexpressed, because the next reader
  will want to "be explicit": the explicit value is a regression for whichever manager it is written for.
- **The rule learns a third state.** `package-manager-pin` today answers two questions — "the project
  declares `devEngines`, so its pin is unverifiable and this is a `skip`" (0020) and "the pin matches /
  does not match the running pnpm". After this record the tool writes the field itself, so the honest
  split is three: declared and **equal to the pin** (a fact this tool owns, so it is verified, not
  skipped), declared and **different** (still 0020's `skip` — the project manages its own pnpm), and
  absent (unchanged). Collapsing the first into the second would leave the tool blind exactly where it
  just gained certainty.
- **The pages say what the guard cannot do.** `--force` downgrades npm's check to a warning and writes
  the lockfile; a machine-level `pmOnFail` / `--pm-on-fail` overrides the check on the pnpm side; the
  field is only enforced by npm from the line that enforces it, and this record measured 11.13.0 and no
  other; yarn and bun were not measured at all. A guard sold as a wall is worse than none (S5, S6).

## What this record does not change

- **`foreign-lockfile`.** It is the last line, not this one, and RFC 0029 makes it fail in exactly the
  state this guard exists to prevent. The two are complements: W4 prevents the accident locally,
  coexistence fails the pull request.
- **`packageManager`, the pin, and `corepack use` as a remediation.** Unchanged, including 0020's skip.
- **The managed block and `pnpm-workspace.yaml`.** Nothing moves into the block; this field lives in
  `package.json`, where npm reads it.
- **Installs, probes and the network.** Writing a field reads nothing and resolves nothing.

## Cost, stated

On pnpm 11 the first resolve after the field appears records a `packageManagerDependencies` block in
`pnpm-lock.yaml`, and `--frozen-lockfile` fails until that resolve has run once. The printed path of
`start` already contains it; a repository that runs `init --apply` alone and commits needs one install
before CI is green. It is one row in `docs/validation.md` and one sentence in `docs/rules/package-manager-pin.md`,
and hiding it would be the sort of omission this catalog exists to report.

## Errata

**2026-10-30 — the writer identifier.** This record called the new plan item `W4`. `W4` was already
taken: it is the `funky-secure.config.json` strict-preset writer of §11.2. The writer this record
introduces is **`W3b`**, following the file-sibling convention the table already uses — `W1a`, `W1b`
and `W1c` are three plan items over one file — so it stays a sibling of `W3`: same file, different
key, and its own plan item so the plan reports it separately. The collision was found while writing
the spec, before any code existed; nothing else in the record changes.

**2026-10-30 — the guard's condition.** This record said `W3b` shares `W3`'s condition. Read
literally, that writes the guard only into a repository that has no pin at all — and the repository
this record was argued from already carries one, written by an earlier release: `packageManager:
pnpm@12.3.4` and no `devEngines`, which is exactly the case the field report named. Measured on the
implementation: `init --format json` over that manifest plans the workspace block and the ignore block
and nothing else, so `init --apply` would never have added the guard where the risk is real.

The condition is the manifest declaring no `devEngines.packageManager` **and** a versioned pnpm pin
being established — whether this plan writes it or the manifest already declares it. A plan that
cannot establish a version (the pin is a conflict, which is the state where the tool will not rewrite
a declaration it did not make) plans no guard, so the two declarations are never written disagreeing.
Found by the independent verification of the implementation, before it merged.
