# 06 - Glossary

One term, one line, alphabetical. Where the tool prints a word, the line quotes it, so you can match what you
read in a report to the word you did not know.

| Term | What it means |
|---|---|
| exact version | A literal version in `package.json`, such as `1.3.0`: the one spelling that names a single release, and what `pin` writes. |
| finding | One answer printed in a report: a symbol, the rule's title, the evidence it read, and, when there is an action, a `→` line naming it. |
| floating version | A specifier that admits more than one release - `^1.3.0`, `~1.3.0`, `1.x`, `latest`. The report calls it `a floating range`. |
| install script | Code a package runs while it is installed. pnpm skips it in CI by default, and `ci-no-safety-overrides` reports a workflow that turns it back on. |
| lockfile | `pnpm-lock.yaml`: it records the exact version resolved for each dependency, so two machines install the same tree. |
| lockfile-only install | `pnpm install --lockfile-only`: the install that re-records the lockfile from the manifest. `pin` prints it as the step after a pin, and never runs it. |
| manifest | A `package.json`: the file that declares dependencies, scripts, and, for pnpm, the package manager. |
| plan | What `init`, `pin` and `migrate` print before writing: the items, a summary line and `next steps`, under `plan only (nothing has been written)`. |
| preset | Which rules are on and how severe they are: `baseline`, `strict` or `starter`, chosen with `--preset` and printed on the report's first line. |
| provenance | The report's second line: the preset in force and where it came from, and what the run could not verify. |
| quarantine | The waiting period before a new release may be installed. pnpm's built-in is 1440 minutes and it is not strict, so the package is admitted and an exclusion is written. |
| registry | The server a package manager downloads packages from. This tool contacts none: it reads the files that decide an install and prints what they say. |
| rule | One question the tool asks of your repository. Each run answers it `pass`, `fail` or `skip`. |
| scope | How much of the world a run may read: `auto`, `repo`, `machine` or `all`, chosen with `--scope`. `repo` never reads this computer. |
| threshold | The severity at which the verdict turns red: `--fail-on` takes `error`, `warn`, `info` or `none`, and `error` is the default. |
| verdict | The report's `PASS` or `FAIL` line, with the threshold it used and how many rules could not be verified. |
| workspace | A pnpm repository that can hold more than one package, marked by `pnpm-workspace.yaml`. `init` creating that file makes this repository a workspace root. |

**Adds:** the words the rest of the path uses, in one alphabetical page, each in the tool's own spelling - so a
reader who meets `floating range`, `provenance` or `plan only (nothing has been written)` in a report has a line
to look it up in, without leaving the path.

---

Back to [the path](README.md): you have reached the end of it, and the seven command pages are what to read next.
