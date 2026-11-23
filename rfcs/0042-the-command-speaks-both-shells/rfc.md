# RFC 0042 — the command speaks both shells

| | |
|---|---|
| **Status** | `accepted` — the owner decided on issue #548 that a printed command is written for the shells a reader actually opens, and that the shells which lose it are named. It lands with the spec it names, which is the shape the registry already carries for `0038`, `0040` and `0041`, so it is `accepted` and not `draft`. |
| **Revision** | 1 |
| **Present contract** | [`docs/spec/rules.md`](../../docs/spec/rules.md) §8.2 R5, the Remediation bullet and the paragraph that says why the property path is bracketed. |
| **Supersedes** | nothing. |
| **Superseded by** | nothing. |
| **Amends** | [`0007`](../0007-remediation-routes/rfc.md) §8.2 R5: the pin is still `pnpm pkg set`, and the *quoting* of it is decided here — one spelling for a name the dotted path can carry, one for every other name, both quoted so `cmd` reads them. |

## What is true today

§8.2 R5 prints one form, quoted for a POSIX shell (`docs/spec/rules.md:223`):

```sh
pnpm pkg set '<section>["<name>"]=<version>' && pnpm install
```

`cmd.exe` does not process single quotes: it passes them through as literal characters, so pnpm
receives an argument that begins with `'` and answers with a property-path error. The line the tool
prints is therefore unreadable in the shell Windows opens by default, and the reader who pastes it has
no way to tell a quoting failure from a mistake of their own. A field round reported exactly that —
"cmd pasa las comillas simples literales a pnpm".

Two other facts were already settled and are not re-opened here. `0007` decided the *verb*: the pin is
`pnpm pkg set`, never `pnpm add --save-exact`, which is a measured no-op on pnpm 12.3.4. `0041`
decided *where* the line runs: the human rendering prefixes it with `(cd "<root>" && …)` below the
repository root. Neither said anything about how the argument inside the line is quoted.

## Why that is a gap

A remediation is a line to paste, and a line one of the shells a reader opens cannot read is not a
route — it is a route for some readers, printed to all of them. The repository already states the
direction in its own rules: the human text is presentation that may change (10.3), and the
remediation is what clears the finding. A spelling chosen for one shell's grammar made that choice
invisible.

The matrix below was measured across the five shells a reader may open — `cmd`, `bash`, `sh`, `pwsh` 7
and Windows PowerShell 5.1 — against pnpm 12.3.4, by four blind judgements, each cell executed rather
than reasoned about:

| spelling | `cmd` | `bash` | `sh` | `pwsh` 7 | WinPS 5.1 |
|---|---|---|---|---|---|
| `'dependencies["x"]=1'` (`0007`'s form) | fails | ok | ok | ok via `pnpm.ps1`, fails via `pnpm.cmd` | `&&` rejected |
| `"dependencies[\"x\"]=1"` | ok | ok | ok | **2 arguments** → `ERR_PNPM_PKG_SET_INVALID_ARG` | `&&` rejected |
| `dependencies.x=1` | ok | ok | ok | ok | `&&` rejected |

No single spelling wins every cell, so the decision is not "find the universal one" — there is none —
but "choose a spelling per name, and state the cells it loses."

## The rule

**A pin command is printed in one of two spellings, chosen by the name, and both are read identically
by `cmd`, `bash` and `sh`.**

- **the quote-free dotted path** — `pnpm pkg set dependencies.is-odd=3.0.1 && pnpm install` — iff the
  name is unscoped, carries no dot, and does not start with a digit;
- **the bracketed path, the whole argument double-quoted with the inner quotes escaped** —
  `pnpm pkg set "dependencies[\"@types/node\"]=20.11.5" && pnpm install` — for every other name.

The predicate has three clauses, and each one is there because the dotted path loses something without
it. They are not style preferences and they are not the old rule with a prefix:

- **unscoped.** A dot path cannot carry an `@`: `pnpm pkg set 'devDependencies.@types/node=1'` exits
  non-zero with `ERR_PNPM_PKG_INVALID_PROPERTY_PATH` (`0007`), and scoped names are most of a modern
  dependency set.
- **no dot in the name.** `dependencies.lodash.merge=…` is read as three path segments and writes
  `{"lodash":{"merge":…}}` beside the untouched `lodash.merge` entry, exiting `0`. A manifest that now
  carries two meanings for one dependency is worse than a command that refuses: it is a corruption the
  exit code calls success.
- **not starting with a digit.** `dependencies.7zip-bin=…` is refused with
  `Numeric suffix "z" is not supported`, because the segment after the dot is parsed as an array index.

`lodash.merge` and `7zip-bin` are published names, not constructed ones, so the two exclusions are the
common case and not an edge.

## What it costs

The dotted path is the only spelling that serves four of the five shells — `cmd`, `bash`, `sh` and
`pwsh` 7 — and it is exactly the one that cannot carry most names. The bracketed, escaped spelling is
the one that serves `cmd`, `bash` and `sh` for every name, and it loses two shells — both are stated
in the spec, never hidden behind a claim that the form is universal:

- **`pwsh` 7 splits the escaped form into two arguments**, so pnpm receives two positional arguments
  and answers `ERR_PNPM_PKG_SET_INVALID_ARG`, writing nothing. The failure is loud and it writes
  nothing, which is the shape a limit should have. An unscoped, dot-free name still works in `pwsh` 7
  through the dotted path, because `pwsh` 7 reads that spelling as the other three do.
- **Windows PowerShell 5.1 rejects `&&`** before it reads any quoting at all, so no spelling of this
  command runs there. That is a fact about the operator and not about the pin, and writing around it
  would mean printing two commands per finding for one shell's benefit.

Both losses are named in the spec with the shell and the error, so a reader whose terminal refuses the
line learns why from the documentation instead of from a pnpm message that reads like their mistake.

## Why this is a record and not an errata to 0041

`0041` asked *where* a printed command runs, and answered with a prefix around it: the command's bytes
are untouched, and the directory is added in front. This record asks *how the command is quoted*, and
the answer is inside the command — the first token is unchanged and the argument's quoting moves. Two
questions about one line, and an errata corrects what a record got wrong; `0041` got nothing wrong
here, it simply never had this question. `0007` is the record this one amends: it decided the bracketed
property path on every name, and the dotted path is now the form a name can take.

## What this does not do

It changes no byte of the JSON report's *shape*. The spelling lands in `remediation.command`, which is
already a string per finding, so no field is added and no key moves; the goldens regenerate because a
string value changed, which is the value-and-not-shape case the schema already admits.

It does not change any other command. `git add`, `git rm --cached`, `corepack use` and the rest carry no
quoting decision of this kind, and `0041`'s prefix rule is untouched.

It does not claim the code is already there. This record and the spec land first, in their own change;
`src/rules/exact-versions.js`'s two builders, the probe's dialect sentences, the test literals and the
goldens follow in a second one, and until that lands the tool prints `0007`'s bytes.

It does not decide the quoting of a `-C <importer dir>`. Directories are `0040`'s subject, and the
`cmd` quoting of a path with `&`, `;` or `^` in it is a separate measurement with its own two holes.

## Verification

Every cell of the matrix was executed, not inferred: three spellings across five shells, with the pnpm
answer and the manifest recorded for each, and the two corruption cases (`lodash.merge`, `7zip-bin`)
reproduced on the published names. The loss in `pwsh` 7 is `ERR_PNPM_PKG_SET_INVALID_ARG` with the
manifest unchanged, and the loss in Windows PowerShell 5.1 is a parse failure on `&&` before any
argument reaches pnpm.
