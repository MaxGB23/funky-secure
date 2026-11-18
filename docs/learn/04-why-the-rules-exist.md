# 04 - Why the rules exist

A report line names a rule, and a rule names an attacker's move. `✖  Lockfile  ·  pnpm-lock.yaml` is not a
matter of taste: it says the bytes you review and the bytes a machine installs are two different sets, and that
whoever resolved the second one - not you - chose them.

This page gives every rule its attack, one section per rule, and links the page that holds the rest. It is not a
fix manual. [`../guide.md`](../guide.md) already carries a table from finding to action with a row for twelve of
the thirteen rule ids - I counted the rows, and `workflow-run-artifact` is the one that is not there. This page
answers a different question from that table: not *I have a finding, what do I do*, but *who is doing this, and
what do they get*.

## How the rules are grouped

`docs/rules/` is one flat folder: thirteen pages, one per id, in alphabetical order of file name, and nothing in
it groups them. So the grouping below is not invented here - it is the grouping the report itself prints. Each
rule answers about one place it read, and the report heads its blocks by place. A `scan --scope all` in a
repository with one workflow printed `MACHINE`, `REPO-ROOT`, `IMPORTER  package.json` and `CI`, in that order.

Counted from the catalog, six rules read the repository root, one reads `package.json` files - the root's and
each workspace package's - and six read the workflows and actions under `.github/`. Two of the six root rules
also need one fact from this computer and no other rule does: the release-age policy pnpm applies, and the pnpm
that actually answers.

## The six that read the repository root

### package-manager-pin - the pnpm that installs is not one you chose

A repository that declares no pinned pnpm is installed by whatever pnpm answers on the machine, so the toolchain
deciding what lands in `node_modules` is a choice nobody made on purpose, and a runner and a laptop can make
different ones from the same commit. The attack is a quiet one: a version resolved by a manager nobody named, in
a repository whose own files say nothing about it. A versioned declaration is the one line that makes the answer
belong to the repository.

→ [the rule's page](../rules/package-manager-pin.md)

### lockfile-committed - the lockfile is there, and git does not carry it

Absent, untracked or ignored, an uncommitted lockfile is the state where the repository looks locked and every
runner resolves its own tree. The versions you read and the versions CI installs then come from two separate
resolutions of the same manifest: it builds here, it fails on a fresh clone, and the release differs from the
review. The attacker does not need to do anything - the gap is already open, and a fresh dependency version walks
into it.

→ [the rule's page](../rules/lockfile-committed.md)

### foreign-lockfile - two lockfiles, two dependency trees

`package-lock.json` or `yarn.lock` left beside `pnpm-lock.yaml` means the repository is resolved twice, by two
managers with different algorithms, and it works until the two disagree. Alone, another manager's lockfile is a
preference and the rule says so with a warning; beside a pnpm lockfile it is two answers to one question, and
whichever tool runs first decides what the other one installs.

→ [the rule's page](../rules/foreign-lockfile.md)

### quarantine - a version published minutes ago, approved without a decision

The cheap package attack is short: publish a malicious version of something people depend on, and be installed
before anyone looks. An age gate refuses anything younger than a stated number of minutes, which is what turns
*this release exists* into *this release survived a day of scrutiny*. pnpm ships such a gate, and ships it
non-strict, so a release published minutes ago is admitted rather than refused. The rule asks whether the gate
in force is actually a gate, which is why it is one of the two that need a fact from this machine.

→ [the rule's page](../rules/quarantine.md)

### env-not-tracked - a committed file of secrets

An environment file is the one file in a project that is meant to hold credentials, and committing it publishes
them to everyone who can clone, to every fork, and to the history that outlives the file. Deleting it later does
not un-publish it, so the cure is a rotation and the question worth asking is only whether it was committed at
all.

→ [the rule's page](../rules/env-not-tracked.md)

### sensitive-ignored - the next `git add .`

A `.gitignore` line is a claim, not a fact: a later negation, a nested ignore file, or a `!` rule changes the
truth, so a rule of text never behaves like the rule the reader believes it read. The attack is the ordinary one
- `git add .` with a key, a `.npmrc` or an environment file in the folder - and the defence has to be
behavioural: is the path ignored by git's own machinery, whatever the file's text says.

→ [the rule's page](../rules/sensitive-ignored.md)

## The one that reads your package.json files

### exact-versions - a range is a standing permission

`^1.3.0` is not a version. It is permission for every release from `1.3.0` upward, granted before those releases
exist and without a diff to read. A lockfile records one answer and a refresh under a caret can silently choose
another, so the specifier is where the decision belongs. The same rule catches the second state: a lockfile whose
specifier no longer matches the manifest is a resolution the next install will change.

→ [the rule's page](../rules/exact-versions.md)

## The six that read your workflows

### actions-pinned-sha - code that can change without a commit

`uses: actions/checkout@v4` names a tag, and a tag is a pointer its owner can move. The code that runs in your
pipeline with your token is therefore whatever stood behind the tag when the job started, not what you read. A
forty-character commit SHA is the only spelling that cannot move under you.

→ [the rule's page](../rules/actions-pinned-sha.md)

### no-bot-auto-merge - a dependency update nobody read

Automated updates are the point of a bot, and merging one without a person is where a compromised or simply
broken release reaches the default branch unread. The rule answers in two halves and the halves differ: a bot
configuration is information, carried on a pass whose message says an update exists, while a workflow that merges
a bot's pull request is a finding.

→ [the rule's page](../rules/no-bot-auto-merge.md)

### ci-no-safety-overrides - the freedoms CI puts back

`pnpm install` in CI is already frozen and already skips dependency lifecycle scripts, and an explicit
`--no-frozen-lockfile` or `--ignore-scripts=false` takes both defences away in the one place nobody is watching
the install. The attack is a package's install script running with the job's token and its secrets, on a runner
that trusted a lockfile the flag just stopped being enforced.

→ [the rule's page](../rules/ci-no-safety-overrides.md)

### pull-request-target - a fork's code with your secrets

`pull_request_target` runs in the base repository's context, with its secrets and its token. Checking out the
pull request head inside that workflow means running code the base repository never reviewed, and a stranger
needs only open a pull request to put it there.

→ [the rule's page](../rules/pull-request-target.md)

### workflow-permissions - the token every job inherits

`GITHUB_TOKEN` is minted for every job, and without a `permissions:` declaration each job carries whatever the
repository setting allows. One compromised step then holds scopes nobody granted to that step, and the blast
radius is the repository rather than the step.

→ [the rule's page](../rules/workflow-permissions.md)

### workflow-run-artifact - the escalation assembled between two files

`workflow_run` starts a privileged workflow because another run finished, and the artifact that run uploaded is
waiting to be downloaded. A producer on `pull_request` executes a fork's bytes with a read-only token, so what it
uploads can be written by the fork; the consumer holds a write token and reads it. Neither file is wrong on its
own, which is why the escalation lives between them - and why this is the one rule the table in `guide.md`
does not carry.

→ [the rule's page](../rules/workflow-run-artifact.md)

## The answers do not read each other

This is the spine of the page, and it is what makes a report trustworthy rather than persuasive.

Each rule is handed the resolved context - what the collector read from your repository, plus one machine fact
for the two rules that need it - and returns its own answer. No rule imports another: the only file under
`src/rules/` that imports a rule module is the catalog, `src/rules/index.js`. No rule is given another's finding.
The policy is a separate argument, and exactly one rule reads it inside its own detection, for the release-age
floor; every other rule never sees it.

Severity and activation are settled before any rule runs. The engine reads the policy, skips the rules it
switches off, and only then calls each remaining rule with its severity. So no rule can see how alarming a
neighbour was, and nothing accumulates down the list.

Nothing is remembered between runs either. I ran `scan --scope repo` twice in one folder with no file changed in
between: the same bytes both times, exit `1` both times, and `diff` between the two outputs printed nothing. The
second run is not a second opinion, and no earlier run could have taught this one anything.

## The write plan is not independent

Everything above is a property of the **scan**. `init` is not a scan, and its plan is derived partly from two of
these answers: the `.gitignore` block is planned when `sensitive-ignored` fails, and the `packageManager` writes
are planned from `package-manager-pin`'s answer (`src/lib/writers.js`).

I measured the derivation by changing only those answers, in two scratch repositories. The first declared no
package manager: `init` planned four writes, two of them to `package.json`. The second declared `pnpm@12.3.4` and
a matching `devEngines.packageManager`: the same command planned two, and neither touched `package.json`. After
the first plan was applied, a second `init --apply` printed `nothing to apply` and exited `0` - the answers had
changed, so the plan had.

So say it precisely, because the two halves are easy to confuse: the scan is independent, the writer is not.
Independence is what lets you trust one answer without reading its neighbours; the derivation is what lets a
writer turn those answers into a plan you can read before anything lands.

## Where the rest is written down

Each rule's page under [`../rules/`](../rules/) holds the detection, the evidence a finding carries, the
remediation and the limits. [`../guide.md`](../guide.md) walks the report field by field and carries the
finding-to-action table named at the top. [`../cli.md`](../cli.md) is the contract: flags, exit codes, and the
JSON document. And [03 - Reading the output](03-reading-the-output.md) explains why the answers are printed in
the order they are.

**Adds:** the attacker behind each rule, grouped by the place the rule reads, plus the two facts no rule page
states - that the answers are taken independently of one another and that `init`'s write plan chains on two of
them.

---

Next: [05 - When not to use it](05-when-not-to-use-it.md), the whole decision in one table.
