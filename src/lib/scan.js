/**
 * One scan, collected once: targets, policy, context and the report object. Commands render it;
 * `init` also derives a plan from it. Keeping this in one place is what stops the plan and the
 * report from disagreeing.
 */

import { loadConfig } from './config.js';
import { createCollector } from './probes.js';
import { evaluate } from './engine.js';
import { repoRoot } from './git.js';
import { resolvePolicy } from './policy.js';
import { buildReport } from './report.js';
import { machineFacts, repoFacts } from './targets.js';
import { TOOL } from './tool.js';

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {NodeJS.ProcessEnv} options.env
 * @param {string} [options.scope] `auto` resolves to `all`
 * @param {string} [options.preset]
 * @param {string[]} [options.only]
 * @param {string[]} [options.ignore]
 * @param {string} [options.failOn]
 * @param {boolean} [options.strictProbes]
 * @param {Array<object>} [options.catalog]
 * @param {object} [options.collector] injected collector, for tests
 */
export async function collectScan({
  cwd,
  env,
  scope = 'auto',
  preset,
  only,
  ignore,
  failOn = 'error',
  strictProbes = false,
  catalog = [],
  collector,
}) {
  const effectiveScope = scope === 'auto' ? 'all' : scope;
  const probes = collector ?? createCollector({ cwd, env });

  const root = effectiveScope === 'machine' ? null : await repoRoot(probes);
  const machine = effectiveScope === 'repo' ? null : await machineFacts(probes);
  const repo = effectiveScope === 'machine' ? null : await repoFacts({ collector: probes, cwd, root });

  const loaded =
    effectiveScope === 'machine'
      ? { config: {}, path: null }
      : loadConfig({ cwd, root: root ?? cwd, catalog });

  const policy = resolvePolicy({
    catalog,
    presetFromFlag: preset,
    config: loaded.config ?? {},
    only,
    ignore,
    failOn,
    major: machine?.facts.major ?? undefined,
  });

  const ctx = {
    scope: effectiveScope,
    cwd,
    root: repo?.facts.root ?? root,
    env,
    machine: machine?.facts ?? null,
    repo: repo?.facts ?? null,
    configPath: loaded.path,
  };

  const findings = evaluate({ ctx, policy, catalog, strictProbes });
  const targets = [...(machine?.targets ?? []), ...(repo?.targets ?? [])];

  const report = buildReport({
    scope: effectiveScope,
    policy,
    targets,
    findings,
    catalog,
    tool: TOOL,
  });

  return { report, ctx, policy, probes };
}
