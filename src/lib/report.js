/**
 * The report contract (RFC 10): aggregation, ordering, the summary and the verdict.
 *
 * Pure. Rules hand in findings; the verdict is computed here, once, from severities and
 * `--fail-on` — never inside a rule, never inside a renderer.
 */

import { ConfigError, severityRank } from './policy.js';

export { severityRank };

export const SCHEMA_VERSION = 1;

/** Report order of target kinds (RFC 10.2). */
export const TARGET_ORDER = ['machine', 'repo-root', 'importer', 'ci', 'editor'];
/** Report order of scopes (RFC 10.2). */
export const SCOPE_ORDER = ['machine', 'repo'];

const STATUSES = new Set(['pass', 'fail', 'skip', 'error']);
const SEVERITIES = new Set(['off', 'info', 'warn', 'error']);

function toNfc(value) {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(toNfc);
  if (value !== null && typeof value === 'object') {
    const normalized = {};
    for (const [key, item] of Object.entries(value)) normalized[toNfc(key)] = toNfc(item);
    return normalized;
  }
  return value;
}

function scopeRank(scope) {
  const rank = SCOPE_ORDER.indexOf(scope);
  return rank === -1 ? SCOPE_ORDER.length : rank;
}

function targetRank(target) {
  const rank = TARGET_ORDER.indexOf(target);
  return rank === -1 ? TARGET_ORDER.length : rank;
}

function compareFindings(a, b) {
  return (
    scopeRank(a.scope) - scopeRank(b.scope) ||
    targetRank(a.target) - targetRank(b.target) ||
    (a.ruleIndex ?? 0) - (b.ruleIndex ?? 0) ||
    (a.path ?? '').localeCompare(b.path ?? '') ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.rule.localeCompare(b.rule)
  );
}

function validateFinding(finding) {
  for (const key of ['rule', 'status', 'severity', 'scope', 'target', 'message']) {
    if (finding[key] === undefined || finding[key] === null) {
      throw new ConfigError(`a finding is missing "${key}"`, key);
    }
  }
  if (!STATUSES.has(finding.status)) {
    throw new ConfigError(`unknown finding status "${finding.status}"`, String(finding.status));
  }
  if (!SEVERITIES.has(finding.severity)) {
    throw new ConfigError(`unknown finding severity "${finding.severity}"`, String(finding.severity));
  }
}

/**
 * Builds the report object the renderers read. Passing findings stay in memory (the human renderer
 * names them in one rolled-up line) and are dropped by the JSON renderer (RFC 10.1).
 *
 * @param {object} options
 * @param {string} options.scope
 * @param {{ preset: string, quarantineMinutes: number, failOn: string }} options.policy
 * @param {Array<object>} [options.targets]
 * @param {Array<object>} [options.findings]
 * @param {Array<{ id: string }>} [options.catalog] catalog order, used to break ties
 * @param {{ name: string, version: string }} options.tool
 */
export function buildReport({
  scope,
  policy,
  targets = [],
  findings = [],
  catalog = [],
  tool,
}) {
  const ruleIndex = new Map(catalog.map((rule, index) => [rule.id, index]));

  const normalized = findings.map((finding) => {
    validateFinding(finding);
    return {
      ...toNfc(finding),
      ruleIndex: ruleIndex.get(finding.rule) ?? Number.MAX_SAFE_INTEGER,
    };
  });

  normalized.sort(compareFindings);

  const summary = { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' };
  for (const finding of normalized) {
    if (finding.status === 'pass') {
      summary.pass += 1;
      continue;
    }
    if (finding.status === 'skip') {
      summary.skip += 1;
      continue;
    }
    summary[finding.severity] += 1;
  }

  summary.verdict = decideVerdict(normalized, policy.failOn);

  return {
    schemaVersion: SCHEMA_VERSION,
    tool,
    scope,
    policy: {
      preset: policy.preset,
      quarantineMinutes: policy.quarantineMinutes,
      failOn: policy.failOn,
    },
    targets: targets.map((target) => toNfc(target)),
    summary,
    findings: normalized.map(({ ruleIndex, ...finding }) => finding),
  };
}

/**
 * A finding fails the run when it sits at or above the threshold. Skips and passes never do;
 * `none` is the pure-reporting mode and is always a pass (RFC 10.5).
 */
function decideVerdict(findings, failOn) {
  if (failOn === 'none') return 'pass';
  const threshold = severityRank(failOn);
  for (const finding of findings) {
    if (finding.status !== 'fail' && finding.status !== 'error') continue;
    if (severityRank(finding.severity) >= threshold) return 'fail';
  }
  return 'pass';
}
