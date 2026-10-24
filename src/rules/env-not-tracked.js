/**
 * R6 — `env-not-tracked`: is any environment file committed? (RFC 8.2 R6, E4)
 *
 * The collector resolves the complete tracked list once, so the rule needs no pathspec: it filters
 * that list by basename and excludes the template names the RFC's over-matching glob would
 * otherwise report (E4). No git probe is added, no file is read and no value is ever printed (N5).
 */

/** The RFC's mandatory template exclusion list (RFC 8.2 R6, E4). */
const TEMPLATE_NAMES = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.dist',
  '.env.test.example',
]);

/**
 * A fact the rule needs is absent. `probeUnavailable` lets `--strict-probes` refuse a green build
 * that measured nothing.
 * @param {string} code
 * @param {string} reason
 */
function skip(code, reason) {
  return { status: 'skip', code, message: `skipped: ${reason}`, probeUnavailable: true };
}

/**
 * @param {string} path repo-relative, POSIX separators
 * @returns {boolean}
 */
function isEnvironmentFile(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.startsWith('.env') && !TEMPLATE_NAMES.has(base);
}

export default {
  id: 'env-not-tracked',
  title: 'No environment file is committed',
  scope: ['repo'],
  targets: ['repo-root'],
  friction: 0,
  severity: { baseline: 'error', strict: 'error' },
  question: 'Is any environment file committed?',
  detection:
    'Every path in the complete tracked set whose basename starts with ".env", at any depth, ' +
    'excluding .env.example, .env.sample, .env.template, .env.dist and .env.test.example. ' +
    'No pathspec and no second git probe: the collector already resolved the whole list.',
  evidence: 'The tracked path. File contents are never read and no value is printed.',
  remediation:
    'None automatic. Removing the file from the index (git rm --cached) does not remove it from ' +
    'history, so the credentials it contains must be rotated.',
  limits:
    'Judges tracked state only, not ignore coverage (R7) or history. A prefix match, as the RFC ' +
    'glob is, so .envrc and .env.local are included. Outside git the tracked set is unknown: skip.',
  docs: 'docs/rules/env-not-tracked.md',

  /**
   * @param {object} ctx the resolved context of `src/lib/targets.js`
   * @returns {Array<object>} findings
   */
  detect(ctx) {
    const repo = ctx.repo;
    if (!repo) return [skip('no-repo', 'no repository facts were collected')];

    const tracked = repo.tracked;
    if (tracked === null || tracked === undefined) {
      return [skip('no-git', 'git is not available, so the tracked set is unknown')];
    }

    const paths = [...tracked].filter(isEnvironmentFile).sort();

    if (paths.length === 0) {
      return [{ status: 'pass', code: 'no-env-tracked', message: 'no environment file is tracked by git' }];
    }

    return paths.map((path) => ({
      status: 'fail',
      code: 'env-tracked',
      path,
      message:
        `${path} is tracked by git; removing it from the index (git rm --cached ${path}) does not ` +
        'remove it from history, so the credentials it contains must be rotated',
      evidence: { path },
      remediation: { kind: 'none' },
    }));
  },
};
