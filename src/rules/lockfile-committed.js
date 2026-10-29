/**
 * R2 — `lockfile-committed` (RFC 8.2, 4.6).
 *
 * Pure: presence, the tracked set and the ignore verdicts are resolved by the collector, so this
 * rule never runs git and never reads the lockfile. The lockfileVersion is deliberately not compared
 * with pnpm (RFC 4.1).
 *
 * Every failure names the human action that fixes it (S4): the rule can fix nothing itself, so the
 * remediation is the command a person runs, never a silent `none`.
 */

const DOC = 'docs/rules/lockfile-committed.md';
const LOCKFILE = 'pnpm-lock.yaml';

function finding(status, code, message, evidence, remediation = { kind: 'none' }) {
  return { status, code, path: LOCKFILE, message, evidence, remediation };
}

export default {
  id: 'lockfile-committed',
  title: 'pnpm-lock.yaml is present, tracked and not ignored',
  label: 'Lockfile',
  scope: ['repo'],
  targets: ['repo-root'],
  friction: 0,
  severity: { baseline: 'error', strict: 'error' },
  question: 'Is the lockfile present, tracked, and not ignored?',
  detection:
    'pnpm-lock.yaml at the repository root. Outside git only existence is checked and the finding states that the tracked and ignored parts were not evaluated. Inside git a present lockfile must appear in the tracked set and must not match a git ignore rule; an absent file fails with lockfile-missing, an untracked one with lockfile-untracked, an ignored one with lockfile-ignored.',
  evidence: '{ path, present, tracked, ignored } with null where git did not answer',
  remediation:
    'manual — git add pnpm-lock.yaml (untracked), git check-ignore -v pnpm-lock.yaml to find the ignore source (ignored), pnpm install (missing).',
  limits:
    'Does not compare lockfileVersion with the installed pnpm: pnpm performs that check on install and a second copy would go stale (RFC 4.1). It does not parse the lockfile, does not read .gitignore and cannot see an ignore rule git did not report through the collected facts.',
  docs: DOC,

  detect(ctx) {
    const repo = ctx.repo ?? null;
    if (repo === null) {
      return [
        finding(
          'skip',
          'no-repo-root',
          'skipped: no repository root was resolved, so the lockfile cannot be located',
          { path: LOCKFILE, present: null, tracked: null, ignored: null },
        ),
      ];
    }

    const present = repo.present.includes(LOCKFILE);
    const tracked = repo.tracked === null ? null : repo.tracked.has(LOCKFILE);
    const ignored = repo.ignored === null ? null : repo.ignored.has(LOCKFILE);
    const evidence = { path: LOCKFILE, present, tracked, ignored };

    if (!present) {
      return [
        finding(
          'fail',
          'lockfile-missing',
          `${LOCKFILE} is missing from the repository root; installs are not reproducible without it`,
          evidence,
          { kind: 'manual', command: 'pnpm install' },
        ),
      ];
    }

    if (tracked === false) {
      // An untracked lockfile that an ignore rule also matches is the state this rule fires on most,
      // and `git add` fails there with "The following paths are ignored" (measured: exit 1). The
      // command has to run in the state the finding describes.
      return [
        finding(
          'fail',
          'lockfile-untracked',
          ignored === true
            ? `${LOCKFILE} is present but not tracked by git, and an ignore rule matches it; CI resolves a different dependency tree on every install`
            : `${LOCKFILE} is present but not tracked by git; CI resolves a different dependency tree on every install`,
          evidence,
          ignored === true
            ? { kind: 'manual', command: 'git add -f pnpm-lock.yaml' }
            : { kind: 'manual', command: 'git add pnpm-lock.yaml' },
        ),
      ];
    }

    if (tracked === true && ignored === true) {
      return [
        finding(
          'fail',
          'lockfile-ignored',
          `${LOCKFILE} is tracked but matched by a git ignore rule; find the source with git check-ignore -v ${LOCKFILE} and remove it, or the file is one re-add away from leaving version control`,
          evidence,
          { kind: 'manual', command: 'git check-ignore -v pnpm-lock.yaml' },
        ),
      ];
    }

    if (!repo.inGit) {
      return [
        finding(
          'pass',
          undefined,
          `${LOCKFILE} is present; tracking and ignore rules were not evaluated because this is not a git repository`,
          evidence,
        ),
      ];
    }

    if (tracked === null) {
      return [
        finding(
          'pass',
          undefined,
          `${LOCKFILE} is present; tracking and ignore rules were not evaluated because git did not report the tracked files`,
          evidence,
        ),
      ];
    }

    if (ignored === null) {
      return [
        finding(
          'pass',
          undefined,
          `${LOCKFILE} is present and tracked; ignore rules were not evaluated because git did not report the ignore verdict`,
          evidence,
        ),
      ];
    }

    return [
      finding('pass', undefined, `${LOCKFILE} is present, tracked and not ignored`, evidence),
    ];
  },
};
