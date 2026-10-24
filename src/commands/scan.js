import { renderHuman } from '../lib/render-human.js';
import { renderJson } from '../lib/render-json.js';
import { collectScan } from '../lib/scan.js';
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
  only,
  ignore,
  strictProbes = false,
  withTimestamp = false,
  catalog = defaultCatalog,
  collector,
}) {
  const { report } = await collectScan({
    cwd,
    env,
    scope,
    preset,
    only,
    ignore,
    failOn,
    strictProbes,
    catalog,
    collector,
  });

  const color = Boolean(stdout?.isTTY) && !('NO_COLOR' in (env ?? {}));
  const text =
    format === 'json'
      ? renderJson(report, withTimestamp ? { timestamp: new Date().toISOString() } : {})
      : renderHuman(report, { color });

  stdout.write(text);
  return report.summary.verdict === 'fail' ? 1 : 0;
}
