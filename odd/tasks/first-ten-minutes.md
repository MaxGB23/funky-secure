# The first ten minutes

A new command that orients a brand-new repository, and a preset that checks only what a project needs on day zero. Tracked as T1-T4 on branch `feat/start` (stacked on `feat/human-output-v2`, because the flow gate and the label renderer live there).

## Specs

S1. The entry point for a new project is a **command**, not a flag: "sería un comando nuevo el start? ya que no me gusta init --starter, creo que confundiría." `init` answers *what do I write*; the starter answers *how much do I check*. They stay apart.

S2. `start` is **read-only**. It never writes, never installs, never touches the machine. It exits `0` whether or not the repository is at policy — it is guidance, not a gate — and `2` only for a usage error. There is exactly one writer in the product, and it is `init --apply`.

S3. `start` derives everything from the same collection and the same write plan that `scan` and `init` use. A second engine that computed its own view could contradict the report about the same repository.

S4. The path is ordered by cause, and only the steps that still apply are printed: `git init` when there is no repository, `pnpm init` when there is no manifest, `funky-secure init --apply` while the plan has writes, `pnpm add <first dependency>` while there is no lockfile, `funky-secure scan --preset starter` last. When every step is done it says so instead of printing a stale checklist.

S5. A new preset, `starter`, runs exactly five rules at their `baseline` severities — `package-manager-pin`, `lockfile-committed`, `exact-versions`, `quarantine`, `sensitive-ignored` — and turns the other seven `off`. It is selectable through `--preset starter` and through the config file, and it does not change `baseline` or `strict`.

S6. **The honesty line.** When the effective policy disables rules, the human report states how many run and names the ones that do not, before the findings. `off` means the rule does not run, is not counted and prints nothing, so a `PASS` under a reduced preset would otherwise claim a coverage it does not have. The JSON document does not change: a machine reader sees `policy.preset` and the counts it already had.

S7. `baseline` and `strict` stay exactly as they are, including every severity and every declared deviation of section 9.1.

S8. The contract is recorded before the code ships: section 9.1 gains the `starter` row, 10.3 gains the honesty line, 11.7 is the new command, and `docs/spec/README.md` lists sections 9, 10 and 11 as amended by record 0003. `docs/cli.md`, `docs/guide.md`, `docs/architecture.md` (a fifth flow diagram) and the README entry point follow.

S9. No rule changes behaviour, no probe is added, no dependency appears. `start` reads facts the product already collects.

## Tasks

| ID | Spec | Work | Commit |
|---|---|---|---|
| T1 | S5, S6, S7 | `starter` in the policy, the honesty line in the human renderer, tests for both | pending |
| T2 | S2, S3, S4 | `src/commands/start.js`, the `COMMANDS` entry, help, tests for every state of the path | pending |
| T3 | S8 | Spec 9.1, 10.3, 11.7, amendment rows, cli/guide/architecture/README, RFC 0003, decision rows | pending |
| T4 | all | Suite, self-scan, goldens zero diff, review | pending |

## Log

L1 (verbatim): "me gusta, sería un comando nuevo el start? ya que no me gusta init --starter, creo que confundiría."

L2 (verbatim, the requirement): "cuando inicializo un proyecto por lo general quiero que tengamos lock de pnpm, no usar carets, un minimum release age, y poco mas, un comando muy basico y tal vez que lo configure, es lo minimo que un proyecto requiere para inicializarse a mi parecer, pero escucho tu opinion"

L3 (measured, parent): on an empty git repository today, `init` writes the workspace block and the ignore block but cannot pin (there is no manifest), and its next steps say `pnpm install`, which fails in a directory with no `package.json`. `scan` then reports the missing lockfile as an error. The zero state has no correct path, and the order is wrong: `savePrefix: ''` and `minimumReleaseAge` only act on an install that happens after the block exists.

L4 (decision, parent): `start` does not write, even though "que lo configure" invites it. Every writer is a security surface — `validateWriteTarget`, digest checks, the dirty-tree refusal — and a second one doubles the review load to add no capability. `start` names `funky-secure init --apply` instead.

L5 (decision, parent): the starter set is the five rules the owner named plus the pin, which is what makes "use pnpm" enforceable. `env-not-tracked` is deliberately left `off` and named in the honesty line: it reports an environment file already tracked, which is a day-two repair; `sensitive-ignored` is the day-zero half, and both are visible in the same line.

L6 (decision, parent): the honesty line is human output only. The JSON document of 10.2 is frozen in this record, and a machine reader already has `policy.preset`; a coverage field would be a separate record with its own consumers.
