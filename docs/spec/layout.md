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

Deliberate absences: no `src/utils/` dumping ground, no state directory, no `.funky/`, no config
generator, no `dist/`, no build step, no devDependency.

---
