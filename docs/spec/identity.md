# Identity and naming

> Normative. Extracted verbatim from RFC 0001 section 6 (revision 7). The record is at
> [`../../rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the code owes. Change this file, not the record.

## 6. Identity and naming

### 6.1 Decision: keep `funky-secure`

Considered, and rejected, because the alternative names describe the current capability instead of
the domain, and would have to be renamed again the moment `apply` ships:

| Candidate | Why not |
|---|---|
| `funky-audit` | Names the v0.1 verb. Breaks the day the tool applies a change. |
| `funky-guard` / `funky-shield` | Implies enforcement and blocking, which is an explicit non-goal (N3). |
| `funky-sentry` | Brand collision with an observability vendor; bad for npm search and for trust. |
| `funky-checklist` | Accurate but reductive; it is a policy engine, not a list. |
| `funky-hygiene` | Sounds like formatting; loses the supply-chain framing. |

`funky-secure` reads correctly in both registers the product needs:

```
funky-secure scan                 # auditor: what is wrong
funky-secure init --apply         # initializer: make it right
```

Forge has the same property: `funky-forge` does not mean "estimator", it names the workshop.
`secure` names the workshop.

### 6.2 Naming rules

- Repository: `MaxGB23/funky-secure`.
- npm package: `funky-secure`. Binary: `funky-secure`.
- No version suffix in any identifier. Release line starts at `0.1.0`.
- Rule ids are `kebab-case`, stable, never renamed without an entry in the decision log: tooling and
  configs refer to them.
- Every artifact this product *touches* keeps its upstream name (`pnpm-workspace.yaml`,
  `pnpm-lock.yaml`, `.gitignore`). The product never introduces its own directory, dotfile or state
  file in v0.1. The only files it may create, and only through the plan of section 11.2, are
  `pnpm-workspace.yaml` (W1a/W1b, when the file is absent) and `funky-secure.config.json` (W4, only with
  `--preset strict --apply`).

---
