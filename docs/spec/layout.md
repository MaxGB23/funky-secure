# Repository and package layout

> Normative. Extracted verbatim from RFC 0001 section 14 (revision 7). The record is at
> [`../../rfcs/0001-funky-secure-v1/rfc.md`](../../rfcs/0001-funky-secure-v1/rfc.md); this file is
> what the code owes. Change this file, not the record.

## 14. Repository and package layout

```
funky-secure/
├── .github/workflows/ci.yml       # suite, drift gate and self-scan (13.2, 15.4)
├── .github/workflows/release.yml  # tag-driven publication with provenance (17.2-17.5)
├── bin/funky-secure.js            # shebang, imports src/cli.js, sets process.exitCode
├── src/
│   ├── cli.js                     # argv parsing (no framework), command dispatch
│   ├── commands/
│   │   ├── scan.js
│   │   ├── init.js
│   │   ├── migrate.js
│   │   └── explain.js
│   ├── lib/
│   │   ├── targets.js             # target resolution (section 7.1)
│   │   ├── probes.js              # closed probe list (section 12.1)
│   │   ├── git.js                 # git read helpers
│   │   ├── config.js              # config discovery and validation (section 9)
│   │   ├── lockfile.js            # bounded pnpm-lock.yaml reader (R5)
│   │   ├── workflows.js           # minimal workflow reader for R8/R9
│   │   ├── policy.js              # presets, overrides, validation (section 9)
│   │   ├── report.js              # finding aggregation, ordering, verdict
│   │   ├── render-human.js
│   │   ├── render-json.js
│   │   ├── managed-block.js       # marker-based block read/replace
│   │   └── paths.js               # write-target validation (section 11.5)
│   └── rules/
│       ├── index.js               # catalog: id -> module, catalog order
│       └── <id>.js                # one pure rule each (nine in v0.1)
├── docs/                          # section 13.4
├── rfcs/funky-secure-rfc.md       # this document
├── odd/tasks/                     # implementation tasks, one file per phase
├── scripts/gen-golden.js          # regenerates the golden reports (15.2)
├── tests/
│   ├── rules/<id>.test.js
│   ├── golden/                    # expected JSON reports
│   ├── fixtures/                  # read-only repository fixtures per rule
│   ├── cli.test.js                # exit codes, flag parsing, help content
│   └── drift.test.js              # section 13.2
├── package.json                   # zero dependencies, bin, files, engines >= 22
├── LICENSE                        # MIT, as funky-forge
└── README.md
```

### 14.1 The packed set is smaller than the repository

The layout above is what the repository holds, not what the package ships. `files` in `package.json`
is the whole list, and a path outside it does not reach a user:

```
bin/  src/  skills/
docs/cli.md  docs/guide.md  docs/concept.md  docs/rules/  docs/images/diagram.jpg
./README.md  LICENSE
```

Three rules decide membership.

- **What the tool names must exist.** Every rule module declares `docs/rules/<id>.md`, and `explain`
  prints that path in its human output and carries it as `docs` in its JSON. `docs/rules/` therefore
  ships whole, and a release whose packed list is missing a catalogued page fails: a report that names
  a document the package does not contain is a broken promise with a valid exit code.
- **User documentation ships; the development record does not.** `docs/spec/`, `docs/decisions.md`,
  `docs/architecture.md`, `docs/validation.md`, `docs/field-loop.md` and `docs/delivery.md` record how
  the tool was built and what it owes. They stay in the repository, which is public, and are not part
  of the artifact.
- **What the README renders ships.** npm shows the README on the package page, so a relative path it
  references has to resolve inside the tarball. `docs/images/diagram.jpg` is published for that reason
  and is not recompressed to buy bytes.
- **A bare basename in `files` is a glob, not a path.** npm matches `README.md` against every
  directory, which pulled `docs/README.md` and `docs/images/README.md` into the tarball — measured on
  npm 11.15.0, 67 files instead of 65. The root entry is therefore written `./README.md`, and the
  guard normalizes a root-anchored entry before comparing it with a packed path. A negative pattern
  (`!docs/README.md`) does not fix it: the entry that matches them is the one to anchor.

Deliberate absences: no `src/utils/` dumping ground, no state directory, no `.funky/`, no config
generator, no `dist/`, no build step, no devDependency.

---
