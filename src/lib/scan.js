/**
 * One scan, collected once: targets, policy, context and the report object. Commands render it;
 * `init` also derives a plan from it. Keeping this in one place is what stops the plan and the
 * report from disagreeing.
 *
 * This module also resolves the report's provenance (S7), because it is the only place that sees the
 * preset flag, the loaded config and the repository's own `pnpm-workspace.yaml` in one run.
 */

import { CONFIG_FILENAME, loadConfig } from './config.js';
import { createCollector } from './probes.js';
import { evaluate } from './engine.js';
import { repoRoot } from './git.js';
import { resolvePolicy } from './policy.js';
import { buildReport } from './report.js';
import { machineFacts, repoFacts } from './targets.js';
import { TOOL } from './tool.js';

/**
 * Whether this repository's own `pnpm-workspace.yaml` declares the quarantine age. A line scan, not a
 * YAML parse (RFC 4.7), and `false` when the file was not read: an unread file is never reported as
 * an absence (S7).
 * @param {object | null | undefined} repo the resolved repository facts
 * @returns {boolean}
 */
function declaresQuarantineAge(repo) {
  const text = repo?.files?.workspaceYaml?.text;
  return typeof text === 'string' && /^minimumReleaseAge\s*:/m.test(text);
}

/**
 * What the report measured about itself (S7): the preset and the source it came from, whether this
 * repository declares the quarantine key, and whether the machine scope was excluded. It never
 * attributes an effective pnpm value to the project or the machine, because the effective
 * configuration reports no origin (E2).
 *
 * @param {{ effectiveScope: string, policy: { preset: string }, presetFromFlag?: string, loaded: { config: object | null }, repo: object | null }} options
 * @returns {{ preset: string, presetSource: string, quarantine: string, machine: string }}
 */
function provenanceOf({ effectiveScope, policy, presetFromFlag, loaded, repo }) {
  const presetSource =
    presetFromFlag !== undefined
      ? '--preset'
      : loaded.config?.preset === undefined
        ? 'default'
        : CONFIG_FILENAME;

  let quarantine;
  if (effectiveScope === 'repo') quarantine = 'not verified (machine excluded)';
  else if (effectiveScope === 'machine') quarantine = 'not verified (repository excluded)';
  else if (declaresQuarantineAge(repo?.facts)) quarantine = 'declared in pnpm-workspace.yaml';
  else quarantine = 'not declared in this repository';

  return {
    preset: policy.preset,
    presetSource,
    quarantine,
    machine: effectiveScope === 'repo' ? 'excluded' : 'included',
  };
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {NodeJS.ProcessEnv} options.env
 * @param {string} [options.scope] `auto` resolves to `all`
 * @param {string} [options.preset]
 * @param {string[]} [options.only]
 * @param {string[]} [options.ignore]
 * @param {string} [options.failOn]
 * @param {boolean} [options.requireVerified]
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
  requireVerified = false,
  strictProbes = false,
  catalog = [],
  collector,
}) {
  const effectiveScope = scope === 'auto' ? 'all' : scope;
  const probes = collector ?? createCollector({ cwd, env });

  const root = effectiveScope === 'machine' ? null : await repoRoot(probes);
  // RFC 7.2: `--scope repo` inside CI is the supported gate configuration because a runner's
  // machine configuration is not the developer's. Machine facts stay out of the contract entirely,
  // so no rule can turn a runner-only fact into a repo verdict.
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
    requireVerified,
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

  const findings = evaluate({ ctx, policy, catalog, strictProbes });  // Under `--scope repo` the answering version is a fact the pin rule needs, but the machine is not
  // part of the reported scope: no machine target is listed and no machine finding is emitted.
  const targets = [
    ...(effectiveScope === 'repo' ? [] : machine?.targets ?? []),
    ...(repo?.targets ?? []),
  ];

  const report = buildReport({
    scope: effectiveScope,
    policy,
    targets,
    findings,
    catalog,
    provenance: provenanceOf({
      effectiveScope,
      policy,
      presetFromFlag: preset,
      loaded,
      repo,
    }),
    tool: TOOL,
  });

  return { report, ctx, policy, probes };
}
