/**
 * R6 — `env-not-tracked`: is any environment file committed? (RFC 8.2 R6, E4, 4.6)
 *
 * The collector resolves the complete tracked list once, so the rule needs no pathspec: it filters
 * that list by basename and excludes the template names the RFC's over-matching glob would
 * otherwise report (E4). No git probe is added, no file is read and no value is ever printed (N5).
 *
 * A tracked environment file carries the command that removes it from the index (S4). Rotation stays
 * in the message, because no command can undo a secret that already reached history.
 */

/**
 * The template names that are not spelled `.example` (RFC 8.2 R6, E4). The `.example` family itself
 * is matched by suffix, not by enumeration: a template is a file meant to be copied, and
 * `.env.local.example` is as much a template as `.env.example` (S1.3).
 */
const TEMPLATE_NAMES = new Set(['.env.sample', '.env.template', '.env.dist']);

/**
 * @param {string} base a basename
 * @returns {boolean} is this name a template rather than a live environment file?
 */
function isTemplateName(base) {
  return base.endsWith('.example') || TEMPLATE_NAMES.has(base);
}

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
  return base.startsWith('.env') && !isTemplateName(base);
}

export default {
  id: 'env-not-tracked',
  title: 'No environment file is committed',
  label: 'Environment files',
  scope: ['repo'],
  targets: ['repo-root'],
  friction: 0,
  severity: { baseline: 'error', strict: 'error' },
  question: 'Is any environment file committed?',
  detection:
    'Every path in the complete tracked set whose basename starts with ".env", at any depth, ' +
    'excluding the template names .env.sample, .env.template and .env.dist and every name ending in ' +
    '.example (.env.example, .env.local.example, .env.production.example): a template is a file ' +
    'meant to be copied, not a credential. ' +
    'No pathspec and no second git probe: the collector already resolved the whole list.',
  evidence: 'The tracked path. File contents are never read and no value is printed.',
  remediation:
    'None automatic. Removing the file from the index (git rm --cached) does not remove it from ' +
    'history, so the credentials it contains must be rotated.',
  limits:
    'Judges tracked state only, not ignore coverage (R7) or history. A prefix match, as the RFC ' +
    'glob is, so .envrc and .env.local are included, and only the template family (.env.sample, ' +
    '.env.template, .env.dist and any name ending in .example) is excluded. Outside git the ' +
    'tracked set is unknown: skip.',
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
      remediation: { kind: 'manual', command: `git rm --cached ${path}` },
    }));
  },
};
