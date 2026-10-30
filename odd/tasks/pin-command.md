# Feature: `funky-secure pin`

The owner approved a separate verb for the carets an old repository already carries. `exact-versions`
reports them and always will; what was missing is a route that does the work without a human retyping
`pnpm pkg set` once per finding.

## Specs

S1. `funky-secure pin` prints a plan and writes nothing. `funky-secure pin --apply` performs exactly
that plan. Running the command is the approval; the `--apply` split is the family convention (`init`,
`migrate`), so no verb in this tool writes on its first invocation.

S2. The version comes from `pnpm-lock.yaml` or the pin is not written. A floating range with no recorded
resolution is reported as skipped, with the reason, and the plan still lists it: the tool never invents
a version (RFC 4.9).

S3. `pin` writes only dependency specifiers in the repository-root `package.json`. Workspace importers
are reported as not written, with the reason, because reading their manifests is outside the file set the
scan collects. Nothing else is touched: `packageManager`, the managed block and the ignore file belong to
`init`.

S4. The write is dirty-guarded like every other writer: uncommitted changes to `package.json` refuse with
exit `3` and the action that lifts it.

S5. The write is idempotent. A second `pin --apply` over the same tree performs zero writes and says so.

S6. `--format json` prints the plan document on stdout and nothing else; the ledger of writes goes to
stderr, as `init --apply` does.

S7. Named `pin`, with the synopsis saying what it pins, because the catalog already has a `packageManager`
pin and two things called "pin" cannot share a help line.

S8. Per-package carets stay the human's decision: `pin` never adds an allowlist, and a specifier edited
back to a range is reported by the next scan like any other.

## Tasks

- T1 — S1-S6: the command, the writer, the plan items. Route: inline. Commit: PR A.
- T2 — S7, S8: spec 11.9, `docs/cli.md`, the guide, the README table, the skill judgement line, record
  0011, decision I-43. Route: inline. Commit: PR A.

## Log

L1 (verbatim) — "Ahora sobre lo que no rescribimos packages con dependencias viejas, creo que tener un comando que los limpie manualmente es interesante, pero siempre con aprobacion, por eso se ejecuta, la skill o el help ya deben dejarlo claro. Hay casos en los que se quiera usar carets en un paquete especifico, pero eso ya el usuario debe poder modificarlo a gusto."

L2 — "ambas decisiones apruebo": the verb is built now, and the three `M:/pruebas/` scenarios are built after it. The name `pin` is my recommendation, taken as approved; a rename to `exact` is cheap before the merge.

L3 — Design decisions taken while exploring, all in the direction of the existing family:
- The plan is not `exact-versions`' `plan()` hook, because `derivePlan` walks every rule and `init --apply`
  would start pinning ranges in bulk — the exact thing the owner asked to keep out of `init`.
- One plan item per file, not per dependency: `applyPlan` writes each item's whole content, so two items
  for one `package.json` would leave only the last one's change.
- Root importer only for v1, stated in the plan when a workspace importer has pins, because the scan
  collects a fixed file set and reading another manifest would mean a new probe.

L4 — T1 and T2 done, PR A. RED first: nine tests, then two more after the first `--apply` run showed the plan promised a clean scan and left a lockfile desync — the plan now ends with `pnpm install --lockfile-only`, because writing an exact specifier rewrites `package.json` and not the `specifier` field the lockfile keeps. The predicate `isFloating` and `recordedVersion` moved to `src/lib/specifiers.js` and `src/lib/lockfile.js`, so the command that fixes a specifier and the rule that reports it cannot disagree; extracting it also cost a careless cut that took `redactedSpecifier` and `escapeRegExp` with it, caught by the rule suite before the commit. Two gates earned their keep: the drift test demanded a `pin` section in `docs/cli.md` and a mermaid flow in `docs/architecture.md`. The skill was stale in a way no gate sees — it still claimed `init --apply` was the only writer, and it carried the pre-0009 step order — so it now names both writers, the new order, exit `3`, the `pin` route, and the judgement line the owner asked for: a writer runs because the human asked, never because a plan printed it. 437 tests, 436 pass, 1 skipped; self-scan exit 0. 0.7.0: a new command is a minor.

L5 — Slice boundary: one commit, 927 authored lines, past the ~400 guide. The split was considered and rejected in this order of reasons: the code and its tests are ~400 lines, and the rest is the record, the spec section, the command reference and the skill — which cannot land before the command exists without documenting something that is not there, and cannot land after it without leaving `pin` shipped and undocumented behind a drift gate that already failed. So the review unit is the feature, and this line is its boundary. A future change to `pin` alone should be a small PR; the creation of a command is the one case where the record is the change.

L6 — T3 done: the three scenarios live in `M:/pruebas/funky-scenarios/` with a `setup.ps1` that rebuilds them from scratch and a README carrying the brief and the report table. Verified that each one fires what it promises: `start` prints the post-0009 order, `lockfile-committed` prints `git add -f` on the ignored lockfile, `pin` lists four specifiers with their ranges, the three skill states produce three different refusals with three different actions, and the quarantine route names `pnpm-workspace.yaml` next to the rule that keeps `.npmrc` ignored. The CI rule group is deliberately absent and the README says why.
