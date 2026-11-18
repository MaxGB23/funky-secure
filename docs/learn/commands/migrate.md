# migrate

`migrate` is the way off npm or yarn. It prints the five steps in the order that works, performs exactly one of them
- the deletion of the other manager's lockfile - and refuses to do even that until the conditions the plan itself
describes are met.

## What it answers

*What is left before npm or yarn stops shaping this repository, in what order, and which of those steps does this
tool do for me?* The answer is five numbered steps. The first names the evidence it read, the second the `.npmrc`
keys pnpm no longer reads, the third the import a human has to run, the fourth the removal, and the fifth the
workflow lines that still mention npm or yarn. Step 3 is named and never executed, and step 5 is headed
`suggestions only` because it prints lines rather than changing them.

## What it does

With no flag it prints the plan and changes nothing: the title line says `plan only (nothing has been written)`.
It reads the lockfiles at the root, the `packageManager` declaration, the manager lines in `.npmrc`, and every
workflow and action file whose text mentions npm or yarn. `--apply` performs step 4 only, and it re-reads every
precondition immediately before the first deletion, because the removal has no rollback: each deleted file is
printed as `remove  <absolute path>` and the last line is `step 4 complete: removed package-lock.json`. It
refuses, exit `3`, writing nothing - and outside a git repository it refuses before it prints the plan at all:

```
funky-secure: run migrate inside a git worktree
reason: migrate needs a git repository: step 4 removes a tracked lockfile on a branch, and this directory is not inside one
```

The other refusals are the same two lines with a different action: `create pnpm-lock.yaml first (run pnpm import),
then re-run migrate --apply` when step 3 has not been done (`pnpm-lock.yaml is absent (never delete the only
lockfile)`), `switch to a feature branch (git switch -c chore/supply-chain-bootstrap) and re-run migrate --apply` on
the default branch, and `check out a branch and re-run migrate --apply` on a detached `HEAD`. `--from` is checked
against the repository rather than trusted, and a `--from npm` in a folder that holds no `package-lock.json` exits
`2`, not `3`, because that is a flag the repository contradicts and not a decision the tool made. There is no
`--format`: the output is always the human plan. Every flag is in [`../../cli.md`](../../cli.md).

## When you use it

- When the report says `✖  Foreign lockfile`. Its remediation line in a repository holding both lockfiles was
  `→ funky-secure migrate --from npm --apply`, and the report's `next` block said the same.
- When `start` prints it: step 8 of that plan was `funky-secure migrate --apply  on a feature branch: it refuses to
  remove a lockfile on main`. The refusal is announced before you can walk into it.
- When the versions the other manager resolved must survive. Step 3 is `pnpm import`, which keeps them, and it is
  the one step the tool will not run for you.
- On a feature branch, with the tree committed. Step 4 is a deletion; the branch is what makes it reviewable, and
  the default-branch refusal is the tool agreeing with you.

## When it is superfluous

- **After the migration, `--apply` is a no-op that says so.** I ran it a second time in the folder it had just
  cleaned: `nothing to remove: no foreign lockfile is present`, exit `0`.
- **It is not a check.** The outcomes I saw are `0` (a plan), `0` (a completed removal), `0` (the repeat) and `3`
  (each refusal), plus one `2` for a `--from` the repository contradicted. There is no `1` in the list, so nothing
  about your repository is graded here; the check is `scan --only foreign-lockfile`, whose finding is what named
  this command in the first place.
- **Step 3 is a line another command already prints.** `start`'s step 3 was `pnpm import`, in those words, in the
  same repository; `migrate`'s step 3 adds the comment about what a re-run replaces. So the plan that sent you here
  had already handed you the import.
- **Everything except the deletion is printed, not performed.** The CI follow-up is
  `.github/workflows/ci.yml:8  - run: npm ci` under a heading that says `suggestions only`, and a second run prints
  it again. If the line you wanted changed is that one, `migrate --apply` will not change it.
- **Without git it is not available to you at all.** Both the plan and `--apply` stop at the two lines quoted
  above, exit `3`: a folder that is not a worktree gets no plan to read.

So the command is superfluous outside a worktree, after the foreign lockfile is gone, and for everyone whose only
question was what CI says - the step that answers it prints suggestions and changes nothing.

## What you will see

Two runs in the same scratch repository in the system temp directory: a `package.json`, a `package-lock.json`, a
`pnpm-lock.yaml` already imported from it, one workflow line mentioning npm, one commit on `main`, and then the
feature branch `chore/supply-chain-bootstrap`.

The plan, with nothing written:

```
funky-secure migrate  ·  from npm  ·  plan only (nothing has been written)

1. evidence
   foreign lockfiles   package-lock.json
   packageManager      (not declared)
   .npmrc              (no manager lines)

2. report-only .npmrc keys pnpm does not read
   (none present)

3. human step (this tool never runs it)
   pnpm import   # reads package-lock.json, writes pnpm-lock.yaml; a re-run replaces what it recorded
   pnpm-lock.yaml is present; whether it was imported from package-lock.json or resolved from the manifest, only the import carries its versions

4. removal (only after pnpm-lock.yaml exists)
   pnpm-lock.yaml      present
   would remove        package-lock.json

5. ci follow-up (suggestions only)
   .github/workflows/ci.yml:8  - run: npm ci
```

Exit `0`, and `git status --porcelain` printed nothing afterwards. The same command with `--apply`, in that same
folder:

```
funky-secure migrate  ·  from npm  ·  apply

1. evidence
   foreign lockfiles   package-lock.json
   packageManager      (not declared)
   .npmrc              (no manager lines)

2. report-only .npmrc keys pnpm does not read
   (none present)

3. human step (this tool never runs it)
   pnpm import   # reads package-lock.json, writes pnpm-lock.yaml; a re-run replaces what it recorded
   pnpm-lock.yaml is present; whether it was imported from package-lock.json or resolved from the manifest, only the import carries its versions

4. removal (only after pnpm-lock.yaml exists)
   pnpm-lock.yaml      present
   would remove        package-lock.json

5. ci follow-up (suggestions only)
   .github/workflows/ci.yml:8  - run: npm ci

remove  C:\Users\cb147\AppData\Local\Temp\gp3qojzH\ga0ZQddv\fs-learn-capture-40407\migrate-e\package-lock.json
step 4 complete: removed package-lock.json
```

Exit `0`, and `git status --porcelain` in that folder printed ` D package-lock.json` afterwards: one file gone, and
nothing else touched. Note that step 4 still says `would remove` in an `apply` run - it is the plan being printed,
and the removal is the `remove` line below it.

In a second scratch copy of the same fixture, still on `main`, the same `--apply` printed that plan and then
refused, exit `3`, deleting nothing:

```
funky-secure: switch to a feature branch (git switch -c chore/supply-chain-bootstrap) and re-run migrate --apply
reason: refusing to remove package-lock.json: the current branch main matches the main/master check, which is a fallback because refs/remotes/origin/HEAD could not be read (the repository has no remote)
```

That last clause is the tool being exact: this repository has no remote, so the branch check is the fallback, and it
says which one you are up against instead of claiming to have read a default branch that does not exist here.

## What you do next

Run the step the plan named and the tool did not: `pnpm import`, then commit `pnpm-lock.yaml`. Then `--apply` on a
feature branch, which deletes the foreign lockfile and nothing else - after the removal above,
`scan --only foreign-lockfile` in that folder printed `summary  0 errors · 0 warnings · 0 info · 1 passing · 0
skipped` and `next     nothing to do: everything at or above the policy passes`, exit `0`. Then read step 5 by hand:
the workflow line it quoted is the part of the migration the tool refuses to decide for you.

**Adds:** the branch and the missing lockfile as the two things the removal refuses on, with the exit codes I saw,
and the three steps the command prints and never performs - the import, the CI follow-up and the check that says
whether any of it worked.

---

Next: [explain](explain.md), the one command that reads no repository at all.
