/**
 * R1 — `package-manager-pin` (RFC 8.2).
 *
 * Pure: every fact comes from the resolved context. The rule answers one question with one finding
 * and never touches the filesystem, the machine or the clock.
 */

import {
  PACKAGE_JSON_RELATIVE,
  findingsOf,
  planTarget,
  writePackageManagerPin,
} from '../lib/writers.js';

const DOC = 'docs/rules/package-manager-pin.md';
const PATH = 'package.json';

/**
 * Whether the project pins the manager it runs with, through `devEngines.packageManager`.
 *
 * @param {object} ctx resolved context
 * @returns {boolean}
 */
function managesOwnVersion(ctx) {
  const json = ctx.repo?.files?.packageJson?.json ?? null;
  if (json === null || typeof json !== 'object') return false;
  const engine = json.devEngines?.packageManager;
  return engine !== null && typeof engine === 'object' && engine.name === 'pnpm';
}

function declaredPin(ctx) {
  const json = ctx.repo?.files?.packageJson?.json ?? null;
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  const value = json.packageManager;
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Whether the declaration names a versioned pnpm, which is the only shape where the repository is the
 * authority: pnpm re-executes itself to honour `packageManager`, so the version answering from the
 * project's own directory is the declared one (S9, 0024).
 * @param {string} declared
 * @returns {boolean}
 */
function isVersionedPnpm(declared) {
  return /^pnpm@\d+\.\d+\.\d+/.test(declared);
}

function readablePackageJson(ctx) {
  const file = ctx.repo?.files?.packageJson ?? null;
  if (file === null) return false;
  return file.json !== null && typeof file.json === 'object' && !Array.isArray(file.json);
}

export default {
  id: 'package-manager-pin',
  title: 'package.json declares the pnpm that answers',
  label: 'Package manager',
  scope: ['repo'],
  targets: ['repo-root'],
  friction: 0,
  severity: { baseline: 'error', strict: 'error' },
  question:
    'Does package.json declare the package manager, and does the declaration match the pnpm actually answering?',
  detection:
    'Reads packageManager from the root package.json. A versioned pnpm declaration is the authority: it passes, and the pnpm answering on the machine rides along as evidence rather than as a verdict, because pnpm re-executes itself to honour the declaration inside the project. An absent declaration fails with pin-missing; a declaration that names another manager is a skip (not-pnpm), since the pnpm question does not apply to it; a pnpm declaration this rule cannot compare with the answering binary keeps pin-conflict. An unavailable pnpm version is a skip (no-pnpm), never a wrong pin; a missing or malformed package.json is a skip (no-package-json).',
  evidence: '{ declared, observed, executable }',
  remediation:
    'auto — funky-secure init --apply writes packageManager when it is missing, and only then; a pin that is already declared is never rewritten, whatever the machine runs.',
  limits:
    'Reads the declaration only: it does not resolve a version, does not read corepack state and never checks the lockfile. A difference between the declared pin and the pnpm on the PATH is a property of the machine, not of the repository, so it is evidence and not a finding; the documented override for a repository deliberately on another manager is to turn the rule off.',
  docs: DOC,

  detect(ctx) {
    const observed = ctx.machine?.version ?? null;
    const executable = ctx.machine?.executable ?? null;
    const declared = declaredPin(ctx);
    const evidence = { declared, observed, executable };

    if (ctx.machine === null) {
      return [
        {
          status: 'skip',
          code: 'no-pnpm',
          path: PATH,
          // `--scope repo` excludes the machine by contract (RFC 7.2), so the skip names what was
          // not verified and the command that verifies it (S6).
          message:
            'skipped: the machine is out of scope, so the declared packageManager pin was not compared with the pnpm that answers; run funky-secure scan --scope all to verify it',
          evidence,
          remediation: { kind: 'none' },
        },
      ];
    }

    if (observed === null) {
      return [
        {
          status: 'skip',
          code: 'no-pnpm',
          path: PATH,
          message: 'skipped: pnpm --version did not answer, so the pin cannot be verified',
          evidence,
          remediation: { kind: 'none' },
          probeUnavailable: true,
        },
      ];
    }

    const file = ctx.repo?.files?.packageJson ?? null;
    if (file === null || file.json === null || typeof file.json !== 'object') {
      return [
        {
          status: 'skip',
          code: 'no-package-json',
          path: PATH,
          message:
            file === null
              ? 'skipped: the repository root has no package.json to read the pin from'
              : 'skipped: package.json could not be parsed, so the pin cannot be read',
          evidence,
          remediation: { kind: 'none' },
        },
      ];
    }

    if (declared === null) {
      return [
        {
          status: 'fail',
          code: 'pin-missing',
          path: PATH,
          message: `package.json declares no packageManager; declare "packageManager": "pnpm@${observed}"`,
          evidence,
          remediation: { kind: 'auto', command: 'funky-secure init --apply' },
        },
      ];
    }

    if (declared !== `pnpm@${observed}`) {
      // A repository that declares a versioned pnpm is the authority for that question: pnpm
      // re-executes itself to honour `packageManager`, so from inside the project the answering
      // version is the declared one. The probe runs outside the repository (0019), which is why it
      // sees the PATH binary, and comparing the two says something about THIS MACHINE. Reporting it
      // as a violation made a correctly pinned repository fail and printed a remediation that would
      // rewrite a deliberate pin to whatever the auditor happens to run — measured on three real
      // repositories (shadcn-ui/ui pnpm@10.33.4, create-t3-app pnpm@10.8.0, primevue pnpm@9.6.0).
      // It is information, and it carries no remediation (0024, S9).
      if (managesOwnVersion(ctx)) {
        return [
          {
            status: 'skip',
            code: 'self-managed-pin',
            path: PATH,
            message: `package.json declares ${declared} and manages its own pnpm through devEngines.packageManager, so the pnpm answering (pnpm@${observed}) does not describe it; run pnpm --version inside the project to confirm the pin`,
            evidence,
            remediation: { kind: 'none' },
          },
        ];
      }

      if (isVersionedPnpm(declared)) {
        // The repository is the authority and it is correct: pnpm honours the declaration inside the
        // project, so there is nothing to fix. The machine's own PATH version rides along as evidence,
        // because hiding it would leave a reader wondering why the two differ.
        return [
          {
            status: 'pass',
            code: 'pin-differs-from-machine',
            path: PATH,
            message: `package.json declares ${declared}, which pnpm answers inside this project; the pnpm on this machine's PATH is pnpm@${observed}, and that difference describes the machine, not the repository`,
            evidence,
            remediation: { kind: 'none' },
          },
        ];
      }

      // A declaration that is not a versioned pnpm: another manager, or a shape this rule cannot
      // compare. The pnpm question does not apply to it, and the rules that need a pnpm repository
      // already report the consequence (lockfile-committed, foreign-lockfile).
      if (!declared.startsWith('pnpm@')) {
        return [
          {
            status: 'skip',
            code: 'not-pnpm',
            path: PATH,
            message: `skipped: package.json declares ${declared}, so this repository is not on pnpm and the pin question does not apply`,
            evidence,
            remediation: { kind: 'none' },
          },
        ];
      }

      return [
        {
          status: 'fail',
          code: 'pin-conflict',
          path: PATH,
          message: `package.json declares ${declared}, which is not a version this rule can compare with the pnpm answering (pnpm@${observed})`,
          evidence,
          remediation: { kind: 'manual', command: `corepack use pnpm@${observed}` },
        },
      ];
    }

    return [
      {
        status: 'pass',
        path: PATH,
        message: `package.json pins pnpm@${observed}, the pnpm that answered`,
        evidence,
        remediation: { kind: 'none' },
      },
    ];
  },

  /**
   * RFC 8.2 fix `auto` (W3): declare the missing pin, or report the conflicting one as a conflict
   * and leave it alone. The finding comes from the same report the run renders, so the plan cannot
   * describe a different repository than the scan.
   *
   * @param {object} ctx resolved context
   * @param {{ report?: object }} [options]
   * @returns {Array<object>} plan items
   */
  plan(ctx, { report } = {}) {
    if (!ctx.repo || !ctx.machine) return [];
    const version = ctx.machine.version ?? null;
    if (version === null) return [];

    const declared = declaredPin(ctx);
    const failed =
      report === undefined
        ? readablePackageJson(ctx) && declared !== `pnpm@${version}`
        : findingsOf(report, this.id).some(
            (finding) =>
              finding.status === 'fail' &&
              (finding.code === 'pin-missing' || finding.code === 'pin-conflict'),
          );
    if (!failed) return [];

    return [
      planTarget(ctx, {
        relative: PACKAGE_JSON_RELATIVE,
        operation: 'set packageManager',
        result: writePackageManagerPin({
          packageJsonText: ctx.repo.files?.packageJson?.text ?? null,
          version,
        }),
      }),
    ];
  },
};
