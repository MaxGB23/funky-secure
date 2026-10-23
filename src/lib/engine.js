/**
 * The rule engine: runs the active catalog over a resolved context and normalizes what a rule
 * returns into the report contract (RFC 8.1, 10.1).
 *
 * A rule decides only `status`, `code`, `path`, `line`, `message`, `evidence` and `remediation`.
 * The engine supplies `rule`, the effective `severity`, the default `scope`/`target` and the `doc`
 * pointer, so a rule cannot disagree with the policy about its own severity.
 */

/**
 * @param {object} options
 * @param {object} options.ctx resolved context
 * @param {ReturnType<import('./policy.js').resolvePolicy>} options.policy
 * @param {Array<object>} [options.catalog]
 * @param {boolean} [options.strictProbes] turn an unavailable required probe into `error`
 * @returns {Array<object>} findings
 */
export function evaluate({ ctx, policy, catalog = [], strictProbes = false }) {
  const findings = [];

  for (const rule of catalog) {
    const severity = policy.severities[rule.id];
    if (severity === undefined || severity === 'off') continue;
    if (!policy.active.includes(rule.id)) continue;

    let produced;
    try {
      produced = rule.detect(ctx, { policy, severity });
    } catch (error) {
      produced = [
        {
          status: 'error',
          message: `the rule failed: ${error?.message ?? error}`,
          evidence: { error: error?.name ?? 'Error' },
        },
      ];
    }

    if (!Array.isArray(produced)) {
      produced = [
        {
          status: 'error',
          message: 'the rule returned no finding',
          evidence: { returned: typeof produced },
        },
      ];
    }

    for (const finding of produced) {
      const normalized = {
        rule: rule.id,
        status: finding.status,
        severity,
        scope: finding.scope ?? rule.scope?.[0] ?? 'repo',
        target: finding.target ?? rule.targets?.[0] ?? 'repo-root',
        path: finding.path,
        line: finding.line,
        message: finding.message ?? '',
        evidence: finding.evidence,
        remediation: finding.remediation ?? { kind: 'none' },
        doc: `funky-secure explain ${rule.id}`,
        code: finding.code,
      };

      if (strictProbes && finding.status === 'skip' && finding.probeUnavailable === true) {
        normalized.status = 'error';
        normalized.severity = 'error';
        normalized.message = `${normalized.message} (required probe unavailable)`;
      }

      findings.push(normalized);
    }
  }

  return findings;
}
