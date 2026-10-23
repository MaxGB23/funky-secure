/**
 * `init` (RFC 11.2): run the same scan, derive the plan and print it. Without `--apply` this is an
 * offer, not a verdict: the command exits 0 whatever the plan contains.
 */

import { applyPlan, derivePlan, renderPlanHuman, renderPlanJson } from '../lib/plan.js';
import { collectScan } from '../lib/scan.js';
import { TOOL } from '../lib/tool.js';
import { planStrictConfig } from '../lib/writers.js';
import { catalog as defaultCatalog } from '../rules/index.js';

/**
 * The bytes of the discovered config file: `null` when there is none, the text when it is readable,
 * and `undefined` when it exists but cannot be read (never mistaken for absent).
 * @param {{ ctx: object, collector: object }} options
 * @returns {Promise<string | null | undefined>}
 */
async function existingConfigText({ ctx, collector }) {
  if (ctx.configPath === null) return null;
  if (typeof collector?.read !== 'function') return undefined;
  const read = await collector.read(ctx.configPath);
  return read.ok ? read.value : undefined;
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {object} options.env
 * @param {object} options.stdout
 * @param {string} [options.preset]
 * @param {string} [options.format]
 * @param {boolean} [options.apply]
 * @param {boolean} [options.allowDirty]
 * @param {Array<object>} [options.catalog]
 * @param {object} [options.collector]
 * @returns {Promise<number>} exit code
 */
export async function run({
  cwd,
  env,
  stdout,
  stderr,
  preset,
  format = 'human',
  apply = false,
  allowDirty = false,
  catalog = defaultCatalog,
  collector,
}) {
  const { report, ctx, policy, probes } = await collectScan({
    cwd,
    env,
    scope: 'all',
    preset,
    failOn: 'none',
    catalog,
    collector,
  });

  const plan = derivePlan({ ctx, policy, catalog, report });

  // W4 is init's own write, not a rule's: the strict preset persists itself so CI agrees (RFC 11.2).
  if (policy.preset === 'strict') {
    const configText = await existingConfigText({ ctx, collector: probes });
    plan.push(planStrictConfig(ctx, { configText, existingPath: ctx.configPath }));
  }

  const writes = plan.filter((item) => item.state === 'would-write');
  const conflicts = plan.some((item) => item.state === 'conflict');

  // An empty plan — or one where every item is already at policy — performs zero writes and only
  // says so. A plan that carries a conflict is rendered first, so the refusal is visible.
  // With `--format json` stdout carries the plan document and nothing else: the ledger of writes
  // would make it unparseable, so it goes to stderr.
  const ledger = format === 'json' ? stderr ?? stdout : stdout;

  if (apply && writes.length === 0 && !conflicts) {
    return applyPlan({ plan, allowDirty, cwd, collector: probes, stdout: ledger });
  }

  const text =
    format === 'json'
      ? renderPlanJson({ tool: TOOL, command: 'init', policy, plan })
      : renderPlanHuman({ command: 'init', preset: policy.preset, plan });
  stdout.write(text);

  if (!apply) return 0;
  return applyPlan({ plan, allowDirty, cwd, collector: probes, stdout: ledger });
}
