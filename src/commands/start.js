/**
 * `start` (record 0003, 11.7): the ordered path from an empty directory to a first scan.
 *
 * Read-only (S2). It runs the same collection and the same write plan `scan` and `init` use (S3) and
 * names the commands only a human can run: nothing here writes, installs or touches the machine.
 * It exits `0` whatever the state is, because it is guidance and not a gate; `2` stays a usage error
 * and the CLI owns it.
 *
 * The path is ordered by cause (S4) and only the steps that still apply are printed: a block has to
 * exist before the install that reads it, and a lockfile can only exist after the first add. A
 * repository another manager generated is read from the presence list the collector already resolved
 * (L10): the block is written **first**, then the human resolves once under it, then the foreign
 * lockfile goes, because `migrate --apply` refuses to remove the only lockfile and `pnpm-lock.yaml` is
 * what the install writes. The old order — migrate before the block — was structurally unable to
 * honour that: the first resolve of every migration happened before the policy that governs it.
 * A `pnpm-lock.yaml` that appears during the migration is the migration's business, not this step's. A
 * repository past the start is told so in one line instead of being handed a stale checklist.
 */

import { derivePlan, writtenPaths } from '../lib/plan.js';
import { statusPorcelain } from '../lib/git.js';
import { notRunLines, offByPolicy } from '../lib/render-human.js';
import { resolvePolicy } from '../lib/policy.js';
import { createCollector } from '../lib/probes.js';
import { collectScan } from '../lib/scan.js';
import { FOREIGN_LOCKFILES } from '../lib/targets.js';
import { catalog as defaultCatalog } from '../rules/index.js';

/** The preset this command recommends (S5): the last step names it, and the honesty line states it. */
const START_PRESET = 'starter';
/** The step that always closes the path, and the preset it names. */
const SCAN_STEP = `funky-secure scan --preset ${START_PRESET}`;

/**
 * The commit step, printed before the block is written over an uncommitted tree.
 *
 * `init --apply` refuses to write over uncommitted changes — a security tool does not mix its edits
 * with a stranger's — and every freshly generated project is in exactly that state. `start` used to
 * tell the reader to run `init --apply` first, so the canonical first-run path could not be completed
 * by running its own steps. The commit is what makes the next step possible; the message is
 * deliberately dull, because it belongs to the repository and not to this tool.
 */
const COMMIT_MESSAGE = 'chore: baseline before funky-secure';
const COMMIT_STEP = `git add -A && git commit -m "${COMMIT_MESSAGE}"`;
/** The step that asks a second time, printed where no repository exists yet. */
export const START_AGAIN_STEP = 'funky-secure start';

/** Why the path stops there: the plan is a measurement, and only a repository can be measured. */
const WHY_START_AGAIN =
  'the plan is derived from a repository: the ignore rule and the clean-tree question are answered only by git';

/**
 * The steps printed in a directory that is not a repository yet.
 *
 * Nothing past `git init` is derivable there: R7 `sensitive-ignored` declares `outside git, skip`, so W2
 * is not planned until a repository exists, and the dirty-tree question has no git to answer it. A plan
 * printed from this directory is one that `init --apply` contradicts one step later (0031).
 *
 * @param {{ repo: object | null }} state
 * @returns {string[]}
 */
function pendingBootSteps({ repo }) {
  const steps = ['git init'];
  if (repo?.files?.packageJson === null || repo?.files?.packageJson === undefined) {
    steps.push('pnpm init');
  }
  steps.push(START_AGAIN_STEP);
  return steps;
}

/** The commit that closes the writes: it names them, so an untracked cache beside them stays out. */
const APPLY_MESSAGE = 'chore: apply funky-secure';
/** The commit that puts the lockfile under version control, which is what the last scan reads. */
const TRACK_MESSAGE = 'chore: track the lockfile';
/**
 * The commit that names the pin, so `git log --grep` finds it months later (0028).
 *
 * `pin --apply` leaves the manifest dirty and the next writer refuses that state, so the path prints
 * the command that produces the clean tree the steps after it require. It stages the manifest and
 * nothing else, for the reason 0016 gives: a generated repository's untracked tool cache stays out.
 */
const PIN_MESSAGE = 'chore: pin the ranges';
const PIN_STEP = `git add package.json && git commit -m "${PIN_MESSAGE}"`;

/** The branch the migration step names. A step that requires a state prints how to reach it (0018). */
const FEATURE_BRANCH = 'chore/supply-chain-bootstrap';

/** `pin` desyncs the lockfile on purpose (0011), so the resolve that re-syncs it is a step, not a footnote. */
const LOCKFILE_ONLY_STEP = 'pnpm install --lockfile-only';

/**
 * Why the same step appears twice, and what each appearance is for.
 *
 * One before `init --apply`, because the writer refuses to land on work someone else left uncommitted.
 * One after it, because the writer has just made exactly that state, and the next writer — `pin` —
 * refuses it too. `start` promised a path whose own steps could not be completed in order: a
 * `create-next-app` manifest carries carets, `pin` is the verb that clears them, and running `start`
 * literally left the reader with warnings and no route (0015).
 */
const WHY_COMMIT_AFTER =
  'a writer refuses a tree with uncommitted work, so the commit after the writes is what lets the next one run';
/** The one line `pin` adds: the block governs the next add, and something has to govern the ranges already here. */
const WHY_PIN =
  'the workspace block governs the dependencies added next, and pin is what clears the ranges already in the manifest';

/**
 * Two lines of cause, printed on every run. The order is the whole point of the command: without
 * them the steps read as a list of commands rather than a sequence.
 */
const WHY_ORDER = [
  'the workspace block has to exist before the install that reads it, and a lockfile can',
  'only exist after the first add',
];
/** The one line a foreign lockfile adds to `why this order` (L10): one short sentence, never a block. */
const WHY_MIGRATE_AFTER =
  'migrate comes after the install, because the install is what writes the lockfile it keeps';

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * The lockfiles another package manager produced, read from the presence list the collector already
 * resolved (L10). No probe is added: the fact is the one `foreign-lockfile` reports from.
 *
 * @param {object | null} repo
 * @returns {string[]}
 */
function foreignLockfiles(repo) {
  const present = Array.isArray(repo?.present) ? repo.present : [];
  return present.filter((name) => FOREIGN_LOCKFILES.includes(name));
}

/**
 * The steps of S4, in cause order, and only the ones that still apply. Every fact is one the
 * collector already resolved — the repository facts and the plan — so `start` measures nothing of its
 * own and cannot contradict the report about the same repository (S3).
 *
 * @param {{ repo: object | null, writes: number }} state
 * @returns {string[]}
 */
function pendingSteps({ repo, writes, uncommitted = false, pins = 0, paths = [], trackLockfile = false }) {
  const present = Array.isArray(repo?.present) ? repo.present : [];
  const foreign = foreignLockfiles(repo);
  const steps = [];
  const tracked = (paths ?? []).filter((path) => typeof path === 'string' && path !== '');
  const commitWrites =
    tracked.length > 0
      ? `git add ${tracked.join(' ')} && git commit -m "${APPLY_MESSAGE}"`
      : COMMIT_STEP;
  // The closing commit names what it covers: the lockfile the install writes and the foreign one the
  // migration removes. It stages no manifest, because after the pin's own commit nothing else on the
  // path writes one (0028), and a commit that stages nothing is not a step.
  const lockfileAtEnd = foreign.length > 0 || trackLockfile;
  const trackFiles = ['pnpm-lock.yaml', ...foreign];
  const trackStep = `git add ${trackFiles.join(' ')} && git commit -m "${TRACK_MESSAGE}"`;

  if (repo?.inGit !== true) steps.push('git init');
  if (repo?.files?.packageJson === null || repo?.files?.packageJson === undefined) {
    steps.push('pnpm init');
  }
  // The block can only be written over a committed tree, so the commit is a step and not a footnote.
  if (writes > 0 && uncommitted) steps.push(COMMIT_STEP);
  // The block first, then one resolve under it, then the foreign lockfile: `migrate --apply` refuses to
  // remove the only lockfile, so it needs the `pnpm-lock.yaml` the install writes, and the install has
  // to read a block that already exists.
  if (writes > 0) {
    steps.push(
      `funky-secure init --apply  plan the ${plural(writes, 'write', 'writes')} (nothing is written)`,
    );
    // `init --apply` leaves the manifest dirty, and `pin --apply` refuses that state. The commit names
    // the files the plan wrote, so an untracked tool cache beside them is not swept in.
    steps.push(commitWrites);
  }
  if (foreign.length > 0) {
    // `pnpm import` reads the foreign lockfile and writes `pnpm-lock.yaml` with the versions it
    // recorded. `pnpm install` never reads it: it resolves from the manifest, so the pins the user
    // migrated from are gone before `migrate` deletes the file that held them (0021).
    steps.push('pnpm import');
  }
  // Never asked for while another manager's lockfile is present: the add would write a second one.
  if (foreign.length === 0 && !present.includes('pnpm-lock.yaml')) {
    steps.push('pnpm add <your first dependency>');
  }
  // The ranges already in the manifest are the second debt: the workspace block governs the next
  // `pnpm add`, and only `pin` touches what is in `package.json` today.
  if (pins > 0) {
    steps.push(
      `funky-secure pin --apply  pin the ${plural(pins, 'range', 'ranges')} this repository already has`,
    );
  }
  if (pins > 0) {
    steps.push(LOCKFILE_ONLY_STEP);
    // The pin has a commit of its own, immediately after the resolve it requires: it leaves the
    // manifest dirty and the next writer refuses that state (0028). It prints only where `pin`
    // printed, because a commit that stages nothing is never printed.
    steps.push(PIN_STEP);
  }
  if (foreign.length > 0) {
    steps.push(`git switch -c ${FEATURE_BRANCH}`);
    steps.push(
      'funky-secure migrate --apply  on a feature branch: it refuses to remove a lockfile on main',
    );
  }
  // The last scan reads a tracked lockfile. Whether one will exist is knowable here — the install above
  // writes it, or it is already present — so the step is printed from a fact and not from a guess.
  if (lockfileAtEnd) steps.push(trackStep);

  return steps;
}

/**
 * Whether the plan's own targets carry uncommitted work, which is the state `init --apply` refuses.
 *
 * The same probe `applyPlan` runs, over the same paths, so `start` cannot promise a step the next
 * command will refuse: a failed `git status` is not dirty, because this is guidance and not a gate.
 *
 * @param {{ plan: Array<object>, ctx: object, collector: object }} options
 * @returns {Promise<boolean>}
 */
async function hasUncommitted({ plan, ctx, collector }) {
  const root = ctx?.repo?.root;
  if (typeof root !== 'string' || root === '') return false;
  const cwd = typeof ctx?.cwd === 'string' && ctx.cwd !== '' ? ctx.cwd : root;
  // The same spelling `applyPlan` uses: the plan carries absolute paths, and `git status` is asked for
  // repository-relative ones, one entry per file (`writtenPaths`, shared with `init`'s next steps).
  const paths = writtenPaths(plan, cwd);
  if (paths.length === 0) return false;
  const dirty = await statusPorcelain(collector, paths);
  if (dirty === null) return false;
  return dirty.some((entry) => paths.includes(entry.slice(3)));
}

/**
 * @param {{ off: string[], catalog: Array<object>, pending: string[], migrate: boolean }} options
 * @returns {string}
 */
function renderStart({ off, catalog, pending, migrate, boot = false }) {
  const lines = ['funky-secure start  ·  guidance, nothing is written', ''];

  if (pending.length === 0) {
    lines.push(`the repository is past the start; the next step is ${SCAN_STEP}`);
  } else {
    // The steps are numbered as printed, so a repository missing only the lockfile starts at 1. A
    // directory that is not a repository stops at the step that asks again, so it appends no scan.
    const printed = boot ? pending : [...pending, SCAN_STEP];
    for (const [index, step] of printed.entries()) {
      lines.push(`  ${index + 1}  ${step}`);
    }

    if (boot) {
      lines.push('', `  ${WHY_START_AGAIN}`);
    } else {
      // `why this order` explains an order, so it is printed only when there is one to explain.
      lines.push('', 'why this order', ...WHY_ORDER.map((line) => `  ${line}`));
      // Each reason is printed only when its step is, so the block never argues for a step that is absent.
      if (pending.some((step) => step.includes('git commit'))) lines.push(`  ${WHY_COMMIT_AFTER}`);
      if (pending.some((step) => step.includes('pin --apply'))) lines.push(`  ${WHY_PIN}`);
      if (migrate) lines.push(`  ${WHY_MIGRATE_AFTER}`);
    }
  }

  // The same sentence the report prints (S6), from the same helper, so the two cannot disagree about
  // what the starter preset left unrun.
  const notRun = notRunLines({ off, catalog });
  if (notRun.length > 0) lines.push('', ...notRun);

  return `${lines.join('\n')}\n`;
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {object} options.env
 * @param {object} options.stdout
 * @param {string} [options.preset] the preset the plan is derived under; the repository's own by default
 * @param {Array<object>} [options.catalog]
 * @param {object} [options.collector]
 * @returns {Promise<number>} exit code, always 0
 */
export async function run({ cwd, env, stdout, preset, catalog = defaultCatalog, collector }) {
  const { report, ctx, policy } = await collectScan({
    cwd,
    env,
    scope: 'all',
    preset,
    failOn: 'none',
    catalog,
    collector,
  });

  // A directory that is not a repository yet has no plan to print: R7 declares `outside git, skip`, so
  // W2 is not planned until one exists, and the dirty-tree question has no git to answer it. Printing a
  // plan from here is what the field loop met as a count that `init --apply` contradicted one step
  // later, so the path stops at the step that asks again (0031).
  if (ctx.repo?.inGit !== true) {
    const bootStarter = resolvePolicy({ catalog, presetFromFlag: START_PRESET, failOn: 'none' });
    stdout.write(
      renderStart({
        off: offByPolicy(bootStarter),
        catalog,
        pending: pendingBootSteps({ repo: ctx.repo }),
        migrate: false,
        boot: true,
      }),
    );
    return 0;
  }

  // The same plan `init` derives: one number for the steps, and the paths whose state decides whether
  // the write would land over uncommitted work.
  const plan = derivePlan({ ctx, policy, catalog, report }).filter(
    (item) => item.state === 'would-write',
  );
  const writes = plan.length;
  // A real run has no injected collector: `start` now asks git one question, so it needs the probe.
  const probe = collector ?? createCollector();
  const uncommitted = writes > 0 && (await hasUncommitted({ plan, ctx, collector: probe }));
  // The ranges the manifest already carries: `start` is guidance, so it names the verb that clears them
  // instead of counting them again. A finding is enough — the count is what the step says.
  const floating = (report.findings ?? []).filter((finding) => finding.code === 'floating-range').length;

  // The honesty line describes the preset this command recommends, not the repository's own policy:
  // S4's last step runs `scan --preset starter`, so that is the coverage the reader will get.
  const starter = resolvePolicy({ catalog, presetFromFlag: START_PRESET, failOn: 'none' });

  const pending = pendingSteps({
    repo: ctx.repo,
    writes,
    uncommitted,
    pins: floating,
    trackLockfile: (report.findings ?? []).some(
      (finding) => finding.rule === 'lockfile-committed' && finding.status !== 'pass',
    ),
    // The plan's own targets, spelled the way git wants them: the same paths `applyPlan` writes, one
    // entry per file. Two plan items over one file (W3 and W3b) are one path to stage, which is why
    // this is `writtenPaths` and not a map over the items.
    paths: writtenPaths(plan, ctx.cwd ?? ctx.repo.root),
  });
  const migrate = foreignLockfiles(ctx.repo).length > 0;
  stdout.write(renderStart({ off: offByPolicy(starter), catalog, pending, migrate }));
  return 0;
}
