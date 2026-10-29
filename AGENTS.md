# AGENTS.md

Where things live in this repository. Two axes, and each document belongs to exactly one.

| Axis | Answers | Where | Mutability |
|---|---|---|---|
| **Record** | what we decided and why | `rfcs/NNNN-<slug>/rfc.md`, `odd/tasks/<feature>.md` | frozen once `implemented` or `closed` |
| **Present** | what is true now | `docs/spec/`, `docs/decisions.md`, the rest of `docs/` | edited freely, in its own pull request |

## Paths

| Path | What it is |
|---|---|
| `docs/spec/` | **The normative contract.** Extracted verbatim from RFC 0001 sections 6-14 and 17. Where the spec and the record disagree, the spec wins. |
| `docs/README.md` | The map from a change to the page that must move with it. Start here when you touched code. |
| `docs/spec/README.md` | The map from every section number (`10.3`, `11.2.1`) to the file that carries it. |
| `docs/delivery.md` | Contract for CI, pinning, release and provenance (record §17). |
| `docs/rules/<id>.md` | The page a user reads about one rule; names the spec as normative. |
| `docs/decisions.md` | Decision log, `D-n` product decisions and `I-n` implementation decisions. |
| `rfcs/README.md` | RFC registry: number, title, status, `supersedes` / `superseded-by`. |
| `rfcs/0001-funky-secure-v1/rfc.md` | Frozen record, revision 7. **Not edited.** Corrections are a dated `## Errata` append or the next record. |
| `odd/tasks/<feature>.md` | Feature record: specs, tasks, and an append-only Log. |
| `src/`, `tests/`, `scripts/` | Code, suite and the golden generator. |

## Working rules

- **A recommendation is not authorization.** "What do you recommend", a review, a comparison or a
  problem statement is read-only: answer, then wait. Implement only when the change itself was asked
  for.
- A behaviour change starts in `docs/spec/`, in its own pull request. Behaviour the record never
  decided starts with the next numbered RFC under `rfcs/`, opened as `draft`.
- The append-only Log of an `odd/tasks/` document is evidence: append, never rewrite.
- Zero runtime and zero dev dependencies, no network, no machine writes as a side effect; every write
  inside the repository goes through `validateWriteTarget`, and the one write outside it is
  `skill --install` (11.5 point 7). See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full hard rules.
- CLI output carries symbols (`✖ ⚠ ℹ ✓ –`), never emoji: double-width glyphs break alignment and
  determinism. Color only on a TTY.
- The JSON report is the machine contract; the human text is presentation and may change.

## Commands

```sh
node --test                    # the suite: rules, commands, drift gate, goldens, self-scan
node scripts/gen-golden.js     # regenerate goldens after an intended report change
node bin/funky-secure.js scan --scope repo --fail-on warn   # self-scan, what CI runs
```
