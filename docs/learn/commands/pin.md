# pin

`pin` writes the versions your lockfile has already resolved into `package.json`, so a floating range becomes one
version. It is the first command on this path that changes a dependency line, and the only one that exists to
remove a freedom rather than a file.

## What it answers

*Which of my floating ranges can be made exact right now, and to which version?* The answer is a list of
`from → to` pairs, and every `to` is a version `pnpm-lock.yaml` already records - the tool never guesses one. It
answers the other half in the same breath: the ranges it cannot pin appear under `not pinned`, with the reason.
Nothing here is judged: there is no verdict, no severity and no report.

## What it does

With no flag it plans and stops. It reads the root `package.json` and `pnpm-lock.yaml` - the same two facts the
`exact-versions` rule compares - and prints a plan whose title line says `plan only (nothing has been written)`.
With `--apply` it rewrites the root manifest and prints the absolute path and the SHA-256 of the bytes it wrote,
as `write  <path>  set exact versions  <digest>`. One write per file is the shape of the change: indentation, key
order and line endings survive, and only the specifiers move. The plan's `next steps` is always
`pnpm install --lockfile-only`, because an exact specifier leaves the lockfile recording the range it replaced,
and the tool never runs an install itself. It refuses, exit `3`, writing nothing, when the target carries
uncommitted changes, and when it cannot read the working tree at all - outside a git repository that refusal
arrives with `pass --allow-dirty` as the action, and nothing is written either. Every flag, and the cases it
deliberately leaves alone, are in [`../../cli.md`](../../cli.md).

## When you use it

- When `start` prints it. In a folder with four floating ranges, step 4 of `start`'s plan was
  `funky-secure pin --apply  pin the ranges package.json declares`.
- After a report shows `⚠  Dependency ranges`. The report prints one `→ pnpm pkg set ...` line per finding, and
  this is that change once, for all of them.
- Before the commit, not after. The plan is the diff, so the moment to read it is before `--apply`, and the commit
  line `start` prints is what records the result.
- When the answer is no. `not pinned` is the plan telling you a range needs an install first, which is a fact
  about your lockfile and cheaper to read than to discover halfway through a release.

## When it is superfluous

- **Once the manifest is exact, the plan is one line and zero writes.** I ran `--apply` twice in a row; the second
  run printed `would not write` for the same file under `keep exact versions   (3 specifiers are already exact)`,
  `summary  0 writes · 1 already at policy · 0 conflicts`, and exited `0`.
- **A range the lockfile never recorded cannot be pinned.** I added `lodash@^4.17.21` to the manifest with no
  record for it. `pin` pinned the other three, printed `lodash (dependencies) floats and the lockfile records no
  version, so it is not pinned`, and exited `0`. The route there is an install first, and it is the report's own
  line: `pnpm install --lockfile-only && funky-secure scan --only exact-versions`.
- **Its exit code is not a check.** I never saw a `1` from it. The outcomes were `0` (a plan holding one write),
  `0` (the write, on a clean tree), `0` (nothing left to write) and `3` (refused) - so a pipeline that gated on
  `pin` would be green in every state, including the state where there was nothing to pin. The check is
  `scan --only exact-versions`, which is also the command that names the install after the write.
- **The step after the write is printed twice anyway.** Immediately after a successful `pin --apply`,
  `scan --only exact-versions` reported three warnings - `left-pad is 1.3.0 in package.json but ^1.3.0 in
  pnpm-lock.yaml` - and its `next` line was `pnpm install --lockfile-only`: the same string `pin`'s own
  `next steps` had just printed. `pin` removes the typing, not the step.
- **A dirty target is a stop, not a wait.** `funky-secure: commit package.json or pass --allow-dirty, then re-run`
  and `reason: refusing to write over uncommitted changes: package.json`, exit `3`, nothing written. Running it
  again prints the same two lines; the cure is a commit, and the plan could not make that decision for you.

So the command is superfluous in exactly the two states its own summary names: `0 writes · N already at policy`,
and `not pinned` with no write at all. Both end in one printed line and exit `0`.

## What you will see

Four runs. The first three are one scratch repository in the system temp directory - a `package.json` declaring
`left-pad@^1.3.0`, `is-odd@^3.0.1` and `typescript@~5.9.2`, a `pnpm-lock.yaml` recording all three, and one
commit. The plan, with nothing written (`git status --porcelain` printed nothing afterwards):

```
funky-secure pin  ·  preset baseline  ·  plan only (nothing has been written)

would write
  C:\Users\cb147\AppData\Local\Temp\gp3qojzH\ga0ZQddv\fs-learn-capture-40407\pin-a\package.json
    set exact versions   (pins 3 specifiers to the version pnpm-lock.yaml records)

summary  1 write · 0 already at policy · 0 conflicts

next steps
  pnpm install --lockfile-only

pins
  dependencies.left-pad  ^1.3.0 → 1.3.0
  dependencies.is-odd  ^3.0.1 → 3.0.1
  devDependencies.typescript  ~5.9.2 → 5.9.2
```

Exit `0`. The same command with `--apply`, in the same folder:

```
funky-secure pin  ·  preset baseline  ·  applying the plan below

would write
  C:\Users\cb147\AppData\Local\Temp\gp3qojzH\ga0ZQddv\fs-learn-capture-40407\pin-a\package.json
    set exact versions   (pins 3 specifiers to the version pnpm-lock.yaml records)

summary  1 write · 0 already at policy · 0 conflicts

next steps
  pnpm install --lockfile-only

pins
  dependencies.left-pad  ^1.3.0 → 1.3.0
  dependencies.is-odd  ^3.0.1 → 3.0.1
  devDependencies.typescript  ~5.9.2 → 5.9.2
write  C:\Users\cb147\AppData\Local\Temp\gp3qojzH\ga0ZQddv\fs-learn-capture-40407\pin-a\package.json  set exact versions  23acc4591b730849925b7a0dd091130f3adbe7a9bc0a432e50681c55b22bca53
```

Exit `0`, and `git diff` in that folder showed three lines changed and nothing else: `"left-pad": "^1.3.0"` became
`"left-pad": "1.3.0"`, and the two others the same way. The plan is printed before it is performed, and the title
line and the one `write` line are the only difference between the two runs above.

Running `--apply` a second time, on the state the first one produced:

```
funky-secure pin  ·  preset baseline  ·  applying the plan below

would not write
  C:\Users\cb147\AppData\Local\Temp\gp3qojzH\ga0ZQddv\fs-learn-capture-40407\pin-a\package.json
    keep exact versions   (3 specifiers are already exact)

summary  0 writes · 1 already at policy · 0 conflicts
```

Exit `0`, and no `next steps`: there is no step after nothing.

The fourth run is a different scratch repository, identical except for one dependency added to the manifest that
the lockfile never recorded:

```
funky-secure pin  ·  preset baseline  ·  plan only (nothing has been written)

would write
  C:\Users\cb147\AppData\Local\Temp\gp3qojzH\ga0ZQddv\fs-learn-capture-40407\pin-c\package.json
    set exact versions   (pins 3 specifiers to the version pnpm-lock.yaml records)

summary  1 write · 0 already at policy · 0 conflicts

next steps
  pnpm install --lockfile-only

pins
  dependencies.left-pad  ^1.3.0 → 1.3.0
  dependencies.is-odd  ^3.0.1 → 3.0.1
  devDependencies.typescript  ~5.9.2 → 5.9.2

not pinned
  lodash (dependencies) floats and the lockfile records no version, so it is not pinned
```

Exit `0`: three ranges it can write, one it cannot, and the sentence that says which is which.

## What you do next

Follow `next steps`, which is `pnpm install --lockfile-only`: between the write and that install,
`scan --only exact-versions` reports three warnings, one per specifier, and its `next` line is the same command.
[`../../cli.md`](../../cli.md) states the pin is complete only once the install has re-recorded the lockfile, and
that scan line is how you watch it happen. Commit with the line `start` prints for the commit
(`git add package.json pnpm-lock.yaml && git commit -m "chore: pin the ranges"`). When the plan says
`not pinned`, the install comes first and the pin second, in that order.

**Adds:** the moment the plan decides between a pin it will write and a range it cannot - three specifiers
written, one left under `not pinned` with the reason, `--apply` twice with `0 writes` the second time - plus the
exit codes that show `pin` is a repair and never a check.

---

Next: [migrate](migrate.md), the command that removes the other manager's lockfile.
