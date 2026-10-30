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
    'Reads packageManager from the root package.json and compares it with the version pnpm --version reports. A pin equal to pnpm@<observed> passes; an absent declaration fails with pin-missing; any other value — another manager or a different pnpm version — fails with pin-conflict. An unavailable pnpm version is a skip (no-pnpm), never a wrong pin; a missing or malformed package.json is a skip (no-package-json).',
  evidence: '{ declared, observed, executable }',
  remediation:
    'auto — funky-secure init --apply writes packageManager when the pin is missing; a conflicting pin is manual — corepack use pnpm@<observed>.',
  limits:
    'Reads the declaration only: it does not resolve a version, does not read corepack state, does not check the lockfile and never rewrites a conflicting pin (RFC 4.3). A repository deliberately on another manager is the finding, not a false positive; the documented override is turning the rule off.',
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
      // A project that declares devEngines.packageManager answers with the version it manages: from its
      // own directory it reported 12.16.0 while the binary on PATH was 12.3.4. The version probe runs
      // outside the repository now (0019), so it sees the PATH binary, and the honest finding is that
      // the machine cannot verify this pin — never a conflict whose remediation tells the user to
      // downgrade the project to whatever happens to be installed here (0020).
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

      return [
        {
          status: 'fail',
          code: 'pin-conflict',
          path: PATH,
          message: `package.json declares ${declared}, but the pnpm answering is pnpm@${observed}`,
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
