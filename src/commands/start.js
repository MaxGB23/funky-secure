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
 * repository past the start is told so in one line instead of being handed a stale checklist.
 */

import { derivePlan } from '../lib/plan.js';
import { notRunLines, offByPolicy } from '../lib/render-human.js';
import { resolvePolicy } from '../lib/policy.js';
import { collectScan } from '../lib/scan.js';
import { catalog as defaultCatalog } from '../rules/index.js';

/** The preset this command recommends (S5): the last step names it, and the honesty line states it. */
const START_PRESET = 'starter';
/** The step that always closes the path, and the preset it names. */
const SCAN_STEP = `funky-secure scan --preset ${START_PRESET}`;

/**
 * Two lines of cause, printed on every run. The order is the whole point of the command: without
 * them the steps read as a list of commands rather than a sequence.
 */
const WHY_ORDER = [
  'the workspace block has to exist before the install that reads it, and a lockfile can',
  'only exist after the first add',
];

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Steps 1 to 4 of S4, in cause order, and only the ones that still apply. Every fact is one the
 * collector already resolved — the repository facts and the plan — so `start` measures nothing of its
 * own and cannot contradict the report about the same repository (S3).
 *
 * @param {{ repo: object | null, writes: number }} state
 * @returns {string[]}
 */
function pendingSteps({ repo, writes }) {
  const present = Array.isArray(repo?.present) ? repo.present : [];
  const steps = [];

  if (repo?.inGit !== true) steps.push('git init');
  if (repo?.files?.packageJson === null || repo?.files?.packageJson === undefined) {
    steps.push('pnpm init');
  }
  if (writes > 0) {
    steps.push(
      `funky-secure init --apply  plan the ${plural(writes, 'write', 'writes')} (nothing is written)`,
    );
  }
  if (!present.includes('pnpm-lock.yaml')) steps.push('pnpm add <your first dependency>');

  return steps;
}

/**
 * @param {{ off: string[], catalog: Array<object>, pending: string[] }} options
 * @returns {string}
 */
function renderStart({ off, catalog, pending }) {
  const lines = ['funky-secure start  ·  guidance, nothing is written', ''];

  if (pending.length === 0) {
    lines.push(`the repository is past the start; the next step is ${SCAN_STEP}`);
  } else {
    // The steps are numbered as printed, so a repository missing only the lockfile starts at 1.
    for (const [index, step] of [...pending, SCAN_STEP].entries()) {
      lines.push(`  ${index + 1}  ${step}`);
    }

    // `why this order` explains an order, so it is printed only when there is one to explain.
    lines.push('', 'why this order', ...WHY_ORDER.map((line) => `  ${line}`));
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

  // The same plan `init` derives, read for one number: the writes that are still waiting.
  const writes = derivePlan({ ctx, policy, catalog, report }).filter(
    (item) => item.state === 'would-write',
  ).length;

  // The honesty line describes the preset this command recommends, not the repository's own policy:
  // S4's last step runs `scan --preset starter`, so that is the coverage the reader will get.
  const starter = resolvePolicy({ catalog, presetFromFlag: START_PRESET, failOn: 'none' });

  const pending = pendingSteps({ repo: ctx.repo, writes });
  stdout.write(renderStart({ off: offByPolicy(starter), catalog, pending }));
  return 0;
}
