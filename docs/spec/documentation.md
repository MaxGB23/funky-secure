# Help, documentation and the drift gate

> Normative. Extracted verbatim from RFC 0001 section 13 (revision 7). The record is at
> [`../../rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the code owes. Change this file, not the record.

## 13. Help, documentation and the drift gate

### 13.1 One source, three renderings

The rule catalog (each `src/rules/<id>.js` plus `src/rules/index.js`) is the only place where a rule's
id, title, friction, severities, remediation and question are written. From it:

| Rendering | Consumer |
|---|---|
| `funky-secure --help` | the terminal; lists commands, flags, and every rule id with its preset severities |
| `funky-secure explain <id>` | the terminal, in depth, for one rule |
| `docs/rules/<id>.md` | the repository, for review and for linking from a PR |

### 13.2 The gate that makes drift impossible

`tests/drift.test.js` fails when any of these is true:

- A rule in the catalog has no `docs/rules/<id>.md`.
- A file in `docs/rules/` declares an id that the catalog does not contain.
- `--help` output does not contain every catalog rule id and every flag parsed by `src/cli.js`.
- A flag parsed by `src/cli.js` is absent from `docs/cli.md`.
- `docs/architecture.md` lists a module that does not exist in `src/`.

CI runs this test on every push. Help text cannot describe a previous release, because it is
generated from the same data the current release executes, and the docs cannot describe a rule that
no longer exists, because the build fails.

### 13.3 `--help` never reflects repository state

`--help` prints the product's contract only. It never reads `package.json`, never prints a detected
preset, never runs a probe. Two people on two machines get the same help text, and it never says
something that was true before the last release.

### 13.4 Documentation set

```
docs/
  guide.md            the entry point: how to read the output, basic vs advanced commands, recipes
  concept.md          what the product is, what it refuses to be, the two scopes
  cli.md              every command and flag, exit codes, JSON schema
  architecture.md     the four layers, the data flow, the invariants, the module map
  rules/<id>.md       one page per rule: question, detection, evidence, remediation, limits
  decisions.md        pointer to this RFC and to the decision log
```

`docs/architecture.md` is a required deliverable of the first implementation phase, not a follow-up:
the author's forge convention treats it as part of the product (D-14).

---
