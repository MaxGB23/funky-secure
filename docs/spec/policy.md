# Policy model

> Normative. Extracted verbatim from RFC 0001 section 9 (revision 7). The record is at
> [`../../rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the code owes. Change this file, not the record.

## 9. Policy model

### 9.1 Presets

| Preset | Intent | Effect |
|---|---|---|
| `baseline` (default) | Adoptable anywhere without a fight | Friction-0 rules are `error`; friction 1–2 are `warn` |
| `strict` | The author's own repositories | Friction 0–1 rules are `error`; friction 2 stays `warn` unless the policy promotes it (`exact-versions`, `quarantine`) |
| `starter` | A project on day zero, before there is anything to check | Exactly six rules at the severity they carry in `baseline`: `package-manager-pin`, `lockfile-committed`, `foreign-lockfile`, `quarantine`, `exact-versions`, `sensitive-ignored`. Every other rule is `off` |

Declared deviations from that table, all visible in the rule headings of section 8.2:

- **`foreign-lockfile` (R3)** is `warn` in `baseline` and in `strict` while the foreign lockfile stands
  alone, and `error` in both presets while it coexists with `pnpm-lock.yaml`: G4 says recommend pnpm,
  not require it, and that covers a repository that chose another manager, not a repository holding
  two lockfiles and therefore two resolutions of one manifest (0029). `starter` runs the rule, so it
  carries both severities (0003 L10).
- **`quarantine` (R4)** is promoted to `error` in `strict` and stays `warn` in `baseline`, and its
  floor follows the preset: the manager's built-in default in `baseline`, `4320` in `strict` (8.2 R4,
  9.4).
- **`actions-pinned-sha` (R8)** is `error` in both presets: pinning a reference is a one-line edit with
  no behavioral cost, so the friction class of the *finding* is not the friction of the *fix*.

`starter` is **additive**: it is a subset of `baseline`, and `baseline` and `strict` do not change at
all — not one severity, not one declared deviation, not one byte of their output. It runs the six
day-zero questions and turns the other six rules `off`: tracked environment files and the five CI and
workflow rules. Those read artefacts a new project does not have yet, and `off` is stated rather than
silent, so a green report under `starter` names the coverage it does not have (10.3). The foreign
lockfile belongs to the set because a repository a framework generator produced starts with another
manager's lockfile, and it is the one rule that says a second package manager still shapes the
repository; the standalone case keeps the `warn` of `baseline`, so including it keeps the preset
gentle, and coexistence with `pnpm-lock.yaml` is the one state in the preset that is not, because a
repository on day zero with two lockfiles is the case nobody should leave overnight. `starter` is
selectable through `--preset starter` and through `preset` in the config file, and an added catalog
rule stays `off` under it until the preset says otherwise, because a preset that claims to check less
must fail in the safe direction.

`starter` keeps the manager's quarantine floor: `quarantineFloor('starter')` is the documented
default for the pinned major, the same value `baseline` uses, and never the `4320` minutes of
`strict` (9.4). A reduced preset reduces the set of rules, not the standard of the rules it keeps.

Preset resolution order (highest wins):

1. `--preset` on the command line.
2. `preset` in `funky-secure.config.json`.
3. `baseline`.

### 9.2 Overrides and precedence

```json
{
  "preset": "strict",
  "quarantineMinutes": 4320,
  "rules": {
    "exact-versions": "warn",
    "no-bot-auto-merge": "off"
  }
}
```

Precedence, highest first: `--ignore <ids>` → `--only <ids>` → config `rules` → preset default.
Severity values: `off | info | warn | error`. `--fail-on <severity>` decides the verdict, not the
rules (section 10.5).

Severity `off` means the rule is not run: it produces no finding, is not counted in the summary, and
`explain <id>` still documents it, so turning a rule off stays visible in the documentation instead
of disappearing silently.

Rules are **not** silently ignored when mistyped: an unknown id in `rules`, an unknown severity, or
an unknown top-level key is a configuration error → exit `2`, with the offending key named. Silent
config typos are the same class of defect as a stale help text: the user believes something is
enforced when it is not.

### 9.3 Config file discovery

`funky-secure.config.json` at the git toplevel of the current directory, else in the current
directory. Machine scope never reads a repository config. The file is JSON only (no YAML, no JS, no
comments) so there is no parser to depend on and no code execution path.

### 9.4 Quarantine policy and its source

The floor R4 compares against is preset-dependent: `baseline` uses the manager's documented built-in
default for the pinned major (1440 minutes on the pnpm 11/12 line, 0 before 11), `starter` uses the
same manager default because it is a reduced `baseline` (9.1), and `strict` uses `4320` (72 hours).
`quarantineMinutes` in the repository config overrides the preset floor for every preset — the value
is policy, not law: a repository with a documented hotfix process may lower it or
list exemptions, and the report shows the effective number so the lowering is visible in review.
`minimumReleaseAgeExclude` entries are reported in the evidence (count and values), so an exemption is
never invisible. In non-strict mode pnpm itself grows that list, which is why the strictness fact
matters more than the number.

**Provenance.** The effective configuration merges the machine, the workspace and the environment and
reports no origin (E2), so a report never attributes a value to the project or to the machine. What it
states exactly, and does: which file the preset came from, and whether the repository itself declares
the quarantine key. The distinction matters because the alternative — a `PASS` produced by the
reviewer's own machine configuration — is indistinguishable from a hardened repository.

---
