/**
 * `init` (RFC 11.2): run the same scan, derive the plan and print it. Without `--apply` this is an
 * offer, not a verdict: the command exits 0 whatever the plan contains.
 */

import { applyPlan, derivePlan, renderPlanHuman, renderPlanJson } from '../lib/plan.js';
import { collectScan } from '../lib/scan.js';
import { TOOL } from '../lib/tool.js';
import { catalog as defaultCatalog } from '../rules/index.js';

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
  const writes = plan.filter((item) => item.state === 'would-write');

  // An empty plan performs zero writes; `applyPlan` is the one place that prints "nothing to apply".
  if (apply && writes.length === 0) {
    return applyPlan({ plan, allowDirty, cwd, collector: probes, stdout });
  }

  const text =
    format === 'json'
      ? renderPlanJson({ tool: TOOL, command: 'init', policy, plan })
      : renderPlanHuman({ command: 'init', preset: policy.preset, plan });
  stdout.write(text);

  if (!apply) return 0;
  return applyPlan({ plan, allowDirty, cwd, collector: probes, stdout });
}
