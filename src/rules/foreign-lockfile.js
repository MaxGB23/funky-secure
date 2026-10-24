/**
 * R3 — `foreign-lockfile` (RFC 8.2).
 *
 * Pure: the foreign lockfile names are read from the resolved presence list. Severity stays `warn`
 * in both presets (RFC 9.1 deviation from 4.2): the product recommends pnpm, it does not require it.
 */

const DOC = 'docs/rules/foreign-lockfile.md';
const FOREIGN = ['package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const PNPM_LOCKFILE = 'pnpm-lock.yaml';

function migrateCommand(files) {
  if (files.includes('package-lock.json')) return 'funky-secure migrate --from npm --apply';
  if (files.includes('yarn.lock')) return 'funky-secure migrate --from yarn --apply';
  return 'funky-secure migrate --from auto --apply';
}

export default {
  id: 'foreign-lockfile',
  title: 'No other package manager shapes this repository',
  scope: ['repo'],
  targets: ['repo-root'],
  friction: 0,
  severity: { baseline: 'warn', strict: 'warn' },
  question: 'Does another package manager still shape this repository?',
  detection:
    'package-lock.json, yarn.lock, bun.lock or bun.lockb at the repository root. None present passes; one or more produce a single foreign-lockfile finding that lists them all. When pnpm-lock.yaml coexists the message uses error-level wording, because two lockfiles resolve two dependency trees; the severity itself remains warn in both presets (RFC 9.1).',
  evidence: '{ files, pnpmLockfile }',
  remediation:
    'manual — funky-secure migrate --from npm --apply, or --from yarn when yarn.lock is the foreign lockfile; a bun-only repository names --from auto.',
  limits:
    'Recommends pnpm, never requires it, so the rule stays warn in both presets (RFC 9.1 deviation from 4.2). It lists files only: it does not read them, does not decide which tree wins and deletes nothing; the removal is step 4 of the migrate plan.',
  docs: DOC,

  detect(ctx) {
    const repo = ctx.repo ?? null;
    if (repo === null) {
      return [
        {
          status: 'skip',
          code: 'no-repo-root',
          message: 'skipped: no repository root was resolved, so foreign lockfiles cannot be listed',
          evidence: { files: [], pnpmLockfile: null },
          remediation: { kind: 'none' },
        },
      ];
    }

    const files = FOREIGN.filter((name) => repo.present.includes(name));
    const pnpmLockfile = repo.present.includes(PNPM_LOCKFILE);
    const evidence = { files, pnpmLockfile };

    if (files.length === 0) {
      return [
        {
          status: 'pass',
          message: 'no foreign lockfile is present; pnpm is the only package manager shaping this repository',
          evidence,
          remediation: { kind: 'none' },
        },
      ];
    }

    const listed = files.join(', ');
    const message = pnpmLockfile
      ? `${listed} ${files.length === 1 ? 'coexists' : 'coexist'} with ${PNPM_LOCKFILE}: two lockfiles resolve two dependency trees, so the install works locally and breaks in CI`
      : `${listed} ${files.length === 1 ? 'is' : 'are'} still present; another package manager still shapes this repository`;

    return [
      {
        status: 'fail',
        code: 'foreign-lockfile',
        message,
        evidence,
        remediation: { kind: 'manual', command: migrateCommand(files) },
      },
    ];
  },
};
