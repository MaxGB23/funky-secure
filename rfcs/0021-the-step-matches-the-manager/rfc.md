# RFC 0021 — the printed step matches the manager

| | |
|---|---|
| **Status** | `implemented` — `pnpm import` for any foreign lockfile, `--from` validated, and a SHA remediation that says how it is obtained. `0.8.6`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/commands.md`](../../docs/spec/commands.md) §11.2.2, §11.3, §11.7; [`docs/rules/actions-pinned-sha.md`](../../docs/rules/actions-pinned-sha.md). |
| **Supersedes** | nothing. It corrects three printed steps and one flag, not the flow. |

## What the field round found

Three findings, one sentence each, from the same report:

> lo imprime `pin` en sus next steps, pero `start` no lo lista. Sin él el lockfile queda
> desincronizado del manifest.

> `migrate` … dice que un `yarn.lock` necesita `pnpm import`, "not `pnpm install`". Correr el paso
> impreso por `start` es lo que produce el drift de versiones … y, con `yarn.lock` borrado después, la
> pérdida del pin original es irreversible.

> `--from npm` sobre un repo con `yarn.lock`: exit 0, cambia **solo la cabecera** … O sea `--from` es
> cosmético.

And from the CI round:

> `uses: actions/checkout@<sha> # v4` es una plantilla, no una corrección. Pegada literal, el scan la
> vuelve a marcar y además **pierde el comentario de versión**.

## The three defects

**1. The path resolved a foreign lockfile the wrong way.** `start` printed `pnpm install` for any
foreign lockfile, while §11.2.2 and `migrate` both say a foreign lockfile needs `pnpm import`. The
difference is not stylistic: `pnpm install` never reads `yarn.lock` or `package-lock.json`, so it
resolves from the manifest and `pin` then records the *new* versions. Since `migrate` deletes the
foreign lockfile afterwards, the versions the user migrated from are gone with no way back.

Measured: `pnpm import` with a hand-written `package-lock` v3, offline, completes in 39 ms and writes
`pnpm-lock.yaml` with the recorded `7.0.0` — while `pnpm install` in the same directory would have
resolved the range again.

**2. `--from` named an intention, not evidence.** `resolvedOrigin` returned the flag's value
untouched, so `--from npm` over a repository holding `yarn.lock` exited 0, changed the plan header, and
then recommended `pnpm import` for the manager it had detected. A flag that reports success for a state
that does not exist.

**3. The SHA remediation was a mute template.** `uses: owner/repo@<sha> # v4` is the right *shape* and a
useless *instruction*: pasted literally the scan flags it again as a branch, and the finding it then
prints is `# <sha>`, so the version comment is lost. Nothing in the output said how to obtain the value,
and the tool never resolves it (4.9).

## The decision

- **`pnpm import` for any foreign lockfile.** One rule for both managers, because the defect is the
  same: pnpm does not read another manager's lockfile on `install`, and `import` exists precisely to.
  The step stays a human step: the tool never runs it.
- **`--from` is validated against the lockfiles present.** Naming a manager the repository does not hold
  is a usage error (exit 2), and the refusal names what the repository actually has. The detected
  manager is the default and needs no flag.
- **The SHA message says how the SHA is obtained** — `git ls-remote` against the action's host, keeping
  the tag as the comment — and says why the tool will not do it. The printed YAML keeps its shape; the
  explanation moves to the message, which is where a reader looks for the reason.

## What it costs

One printed step changes text for every migration, and a repository that used `--from` to assert an
intention it did not hold now gets an error instead of a plan. Both are the point: the previous
behaviour was a command that lost data and a flag that lied.

## Verification

- A generated npm project prints `pnpm import` where it printed `pnpm install`, and the step still
  precedes the migration, which still needs the lockfile it writes.
- `migrate --from npm` over a repository holding only `yarn.lock` exits 2 and the refusal names
  `yarn.lock`.
- `migrate --from yarn` on a repository that does hold it is unchanged.
- The `actions-pinned-sha` message contains the resolution instruction; the remediation keeps the tag
  as the comment.
- 448 tests, 447 pass, 0 fail. Self-scan exit 0.

## Alternatives rejected

- **`pnpm install` for npm and `pnpm import` for yarn**, as §11.3 had it. The asymmetry had no measured
  reason, and both managers fail the same way under `install`.
- **Warn on a mismatched `--from` instead of refusing.** A warning leaves the plan looking valid while
  describing a repository that does not exist.
- **Print the `git ls-remote` output into the YAML.** The tool does not resolve versions, and a URL
  baked into a remediation would encode a host it does not know.
