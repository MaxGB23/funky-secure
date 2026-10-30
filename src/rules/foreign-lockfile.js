/**
 * R3 — `foreign-lockfile` (RFC 8.2).
 *
 * Pure: the foreign lockfile names are read from the resolved presence list. The severity follows the
 * state (0029): a foreign lockfile that stands alone is `warn` in `baseline` and in `strict`, because
 * the product recommends pnpm and does not require it, and one that coexists with `pnpm-lock.yaml` is
 * `error` in both, because two lockfiles are two resolutions of one manifest.
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
  label: 'Foreign lockfile',
  scope: ['repo'],
  targets: ['repo-root'],
  friction: 0,
  severity: { baseline: 'warn', strict: 'warn' },
  // The coexistence state carries its own severity, selected by the evidence the finding already
  // holds: no second rule id, no second probe, and the policy still clamps what this says (0029).
  severityWhen: [
    {
      state: 'coexistence',
      evidence: 'pnpmLockfile',
      is: true,
      severity: { baseline: 'error', strict: 'error' },
    },
  ],
  question: 'Does another package manager still shape this repository?',
  detection:
    'package-lock.json, yarn.lock, bun.lock or bun.lockb at the repository root. None present passes; one or more produce a single foreign-lockfile finding that lists them all. The severity follows the state, identically in baseline and in strict: a foreign lockfile that stands alone is warn, and one that coexists with pnpm-lock.yaml is error (RFC 0029, 8.2 R3).',
  evidence: '{ files, pnpmLockfile }',
  remediation:
    'manual — funky-secure migrate --from npm --apply, or --from yarn when yarn.lock is the foreign lockfile; a bun-only repository names --from auto.',
  limits:
    'A foreign lockfile that stands alone is a warn, never a gate: the product recommends pnpm and does not require it, so the declared deviation from the friction table (RFC 9.1) covers that state only (0029). It lists files only: it does not read them, does not decide which tree wins and deletes nothing; the removal is step 4 of the migrate plan.',
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
    // One register in both states: the sentence names the state, and the severity carries the weight
    // (0029). It never escalates to error-level wording, because `warn` and `error` are the policy's
    // answer about this state, not the sentence's.
    const beside = pnpmLockfile ? ` beside ${PNPM_LOCKFILE}` : '';
    const message = `${listed} ${files.length === 1 ? 'is' : 'are'} still present${beside}; another package manager still shapes this repository`;

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
