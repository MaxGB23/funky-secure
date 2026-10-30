import { renderHuman } from '../lib/render-human.js';
import { renderJson } from '../lib/render-json.js';
import { collectScan } from '../lib/scan.js';
import { offByPolicy } from '../lib/render-human.js';
import { catalog as defaultCatalog } from '../rules/index.js';

/**
 * `scan` (RFC 11.1): read-only, deterministic, human or JSON, one verdict.
 * @param {object} options
 * @returns {Promise<number>} exit code
 */
export async function run({
  cwd,
  env,
  stdout,
  scope = 'auto',
  preset,
  format = 'human',
  failOn = 'error',
  requireVerified = false,
  only,
  ignore,
  strictProbes = false,
  withTimestamp = false,
  verbose = false,
  catalog = defaultCatalog,
  collector,
}) {
  const { report, policy } = await collectScan({
    cwd,
    env,
    scope,
    preset,
    only,
    ignore,
    failOn,
    requireVerified,
    strictProbes,
    catalog,
    collector,
  });

  const color = Boolean(stdout?.isTTY) && !('NO_COLOR' in (env ?? {}));
  const text =
    format === 'json'
      ? renderJson(report, withTimestamp ? { timestamp: new Date().toISOString() } : {})
      : renderHuman(report, { color, verbose, off: offByPolicy(policy) });

  stdout.write(text);
  return report.summary.verdict === 'fail' ? 1 : 0;
}
