# Hardening 0.9 — the fixes the field round found

| | |
|---|---|
| **Started** | `0.8.8`, `main` `ed80a03` |
| **Evidence** | [`field-round-4.md`](field-round-4.md) (defects, measured) and [`docs-drift-audit.md`](docs-drift-audit.md) (60 documentation findings) |
| **Releases** | `0.8.9` (what is fixed + the contract), `0.9.0` (the lockfile reader), `0.9.1` (the sentences) |

## Specs

Each spec is a statement the shipped tool must satisfy, with the evidence that produced it. `S#` is
referenced by tasks and by the verification of each release.

| # | Spec |
|---|---|
S1 | A workflow whose `steps:` is followed by `- uses:` at the **same indentation** (the YAML indentless sequence) is parsed, and the five CI rules report findings for it instead of a skip. Evidence: `odd/tasks/field-round-4.md` S1.1 — `yarnpkg/berry`, 35 of 35 workflows, 175 checks silent, verdict `PASS`. |
S2 | A tracked file whose name starts with `.env` and ends with `.example` is a template, not a credential: no finding. A tracked `.env`, `.env.local`, `.envrc`, `.env.examples`, `.env.example.bak` or `.env.local.example.txt` stays a finding with the same message. Evidence: S1.3, the Vercel starter. |
S3 | The managed `.gitignore` block negates the template family (`!.env*.example`), so a new `.env.production.example` is addable after `init --apply`. Evidence: S2.9, `git check-ignore --no-index`. |
S4 | A command that decided not to act exits **3**; a command that could not answer exits **2**; a violation exits **1**; nothing to report exits **0**. The spec states all four. Evidence: the exit-code drift, six documents said 2 for a refusal the code exits with 3. |
S5 | Every fact a document states about the CLI is checked by a test: the command and flag surface per command, the four exit codes, the version strings, and the number of rules in the catalogue. Evidence: the 60 findings, none reachable by a behavioural test. |
S6 | `pnpm-lock.yaml` with `lockfileVersion: '6.0'` (the pnpm 8 shape: top-level `dependencies` with `specifier`/`version`, no `importers`) is read, and `pin` can pin from it. Evidence: S1.2, `vercel/nextjs-subscription-payments`, 26 ranges wrongly reported as "the lockfile records no version". |
S7 | A lockfile with top-level `catalogs` is read: the importer comparison runs, and a `catalog:` specifier is resolved through the catalogue map (default and named) before it is called floating. Evidence: S1.4, `primefaces/primevue`, 13 false positives out of 34 and a refusal that was not needed. |
S8 | The desync comparison never reports a peer dependency as a desync merely because pnpm 9 does not record peers in importer blocks, and never compares a specifier an override rewrote. Evidence: S1.6, 7 false positives out of 8 on a promoted copy of `shadcn-ui/ui`. |
S9 | When the repository declares `packageManager`, the repository is the authority: the rule does not compare the declaration against the pnpm answering the auditor's machine, and never prints a remediation that rewrites the declaration. Evidence: S1.5/S2.8, `shadcn-ui/ui` `pnpm@10.33.4`, `create-t3-app` `pnpm@10.8.0`, `primevue` `pnpm@9.6.0`. |
S10 | A remediation that edits a manifest names the directory that owns it (`pnpm -C <dir>` or an equivalent), so following it never writes into the root manifest. Evidence: S2.1, `create-t3-app`, 80 of 96 findings. |
S11 | `.github/actions/**/action.yml` is read: an unpinned `uses:` inside a composite action is a finding. Evidence: S2.2, `create-t3-app`, six workflows consume the action. |
S12 | Every skip names its rule and its reason in the human report, without `--verbose`. Evidence: S2.7, the `exact-versions` skip counted in the verdict and absent from the body. |

## Tasks

| # | Specs | Route | Commit |
|---|---|---|---|
T1 | S2 | inline (done by worker) | `0.8.9` |
T2 | S1 | inline (done by worker) | `0.8.9` |
T3 | S3 | inline | `0.8.9` |
T4 | S4 | inline, needs a declared spec amendment | `0.8.9` |
T5 | S5 | worker, `tests/docs-contract.test.js` | `0.8.9` |
T6 | S6 | worker, `src/lib/lockfile.js` | `0.9.0` |
T7 | S7 | worker, `src/lib/lockfile.js` + `src/rules/exact-versions.js` | `0.9.0` |
T8 | S8 | worker, `src/rules/exact-versions.js` | `0.9.0` |
T9 | S9 | inline, touches a rule's verdict | `0.9.1` |
T10 | S10, S11 | worker | `0.9.1` |
T12 | S12 | inline | `0.9.1` |

## Log

**L1** (owner, verbatim): "sigo tu recomendacion, arranca todo hasta finalizar, usa odd si es necesario,
npm solo cuando ya todo esté perfecto, todo pase, todas las reglas tengan validaciones en repos reales,
etc, por ahora no lo mencionemos"

**L2** (owner, verbatim): "el whoami no lo tocamos, recuerda que npm será para despues, aun no publicamos,
es lo final."

**L3** (owner, verbatim): "esperemos al resto de subagentes para encontrar mas fallas y armar bien un plan"

**L4** — evidence, round 4 closed: five clones (berry, create-t3-app, vercel subscriptions, primevue,
shadcn-ui/ui), read-only held everywhere, `init --apply` idempotent on a real workspace, 0.38 s and 79 MB
on 6 411 files.

**L5** — decision, exit codes: the spec moves to 3, not the code, because `3` ("decided not to act") and
`2` ("could not answer") are different answers and 0008 established that split.
