/**
 * R7 — `sensitive-ignored` (RFC 8.2, E3).
 *
 * The question is behavioral, not textual: `git check-ignore --no-index --stdin -z` already answered
 * per candidate path and the verdict arrived as `ctx.repo.ignored`. Textual presence in `.gitignore`
 * would be wrong, because a later `!.env` or a nested ignore file changes the truth (E3).
 *
 * No content is read except the root `.npmrc`, and its token value is never printed: presence is the
 * fact, `<redacted>` is the value (RFC 12.3).
 */

const DOC = 'docs/rules/sensitive-ignored.md';
const AUTO = { kind: 'auto', command: 'funky-secure init --apply' };
const SENSITIVE_TRACKED = /\.(?:pem|key)$/i;
const AUTH_TOKEN = /_authToken=/;

export default {
  id: 'sensitive-ignored',
  title: 'Sensitive files are ignored and untracked',
  scope: ['repo'],
  targets: ['repo-root'],
  friction: 0,
  severity: { baseline: 'error', strict: 'error' },
  question: 'Would this repository ignore the files that must never be committed?',
  detection:
    'Feed .env, .env.local, .env.production, secrets.pem, server.key and .npmrc to git check-ignore --no-index --stdin -z (never with -v) and require a per-path match. Additionally report tracked *.pem and *.key files, and a root .npmrc containing a literal _authToken= (presence only, value redacted). Outside git, skip.',
  evidence:
    'the missing ignore entries (one finding for the batch), each tracked sensitive path, and the presence of a token with its value replaced by <redacted>.',
  remediation:
    'funky-secure init --apply appends the missing entries to the managed .gitignore block. Tracked files are removed with git rm --cached <path>, which does not remove them from history.',
  limits:
    'The rule answers for the six declared candidate paths only; any other sensitive name relies on the ignore file the repository already has. The token check reads the root .npmrc only and reports presence, never a value. Ignore coverage is not a history claim: a file unignored today may be committed tomorrow.',
  docs: DOC,

  /**
   * @param {object} ctx resolved context
   * @returns {Array<object>} findings
   */
  detect(ctx) {
    if (!ctx.repo) {
      return [
        {
          status: 'skip',
          code: 'no-repo',
          scope: 'repo',
          target: 'repo-root',
          message: 'skipped: no repository was resolved',
          probeUnavailable: true,
        },
      ];
    }

    const { ignored, ignoreCandidates, tracked, files } = ctx.repo;
    if (ignored === null) {
      return [
        {
          status: 'skip',
          code: 'no-git',
          scope: 'repo',
          target: 'repo-root',
          message: 'skipped: not a git repository, so ignore coverage cannot be evaluated',
          probeUnavailable: true,
        },
      ];
    }

    const findings = [];
    const candidates = Array.isArray(ignoreCandidates) ? ignoreCandidates : [];
    const missing = candidates.filter((path) => !ignored.has(path));

    if (missing.length > 0) {
      findings.push({
        status: 'fail',
        code: 'not-ignored',
        path: '.gitignore',
        message: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not ignored by git`,
        evidence: { path: '.gitignore', missing },
        remediation: AUTO,
      });
    }

    const trackedSensitive = [...(tracked ?? [])]
      .filter((path) => SENSITIVE_TRACKED.test(path))
      .sort();
    for (const path of trackedSensitive) {
      findings.push({
        status: 'fail',
        code: 'tracked-sensitive-file',
        path,
        message: `${path} is tracked by git`,
        evidence: { path },
        remediation: { kind: 'manual', command: `git rm --cached ${path}` },
      });
    }

    const npmrcText = files?.npmrc?.text;
    if (typeof npmrcText === 'string' && AUTH_TOKEN.test(npmrcText)) {
      findings.push({
        status: 'fail',
        code: 'npmrc-token',
        path: '.npmrc',
        message: '.npmrc declares an _authToken entry; its value is redacted',
        evidence: { path: '.npmrc', token: '<redacted>' },
        remediation: tracked?.has?.('.npmrc')
          ? { kind: 'manual', command: 'git rm --cached .npmrc' }
          : { kind: 'none' },
      });
    }

    // `git ls-files` answered null: the tracked set was not measured, so "nothing sensitive is
    // tracked" would be a guess. The ignore findings above still stand.
    const trackedUnreadable = tracked === null;
    if (trackedUnreadable) {
      findings.push({
        status: 'skip',
        code: 'unreadable-tracked-files',
        path: '.',
        message: 'skipped: git ls-files was unavailable, so the tracked set was not measured',
        probeUnavailable: true,
      });
    }

    if (findings.length === 0) {
      findings.push({
        status: 'pass',
        message: 'every sensitive path is ignored and nothing sensitive is tracked',
      });
    }

    return findings;
  },
};
