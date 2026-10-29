/**
 * R4 — `quarantine` (RFC 8.2, 9.4).
 *
 * The question is not "is there a number" but "is the number a gate". pnpm applies the built-in
 * default of 1440 minutes on the 11/12 line without reporting it in `pnpm config list --json`, and it
 * applies it non-strictly: it appends `minimumReleaseAgeExclude` entries to `pnpm-workspace.yaml` and
 * exits 0, even under `CI=true` (E1). Only an explicitly configured `minimumReleaseAge` makes
 * `minimumReleaseAgeStrict` default to true. So absence of the key is reported as an inherited,
 * non-strict value — never as "disabled" and never as 0.
 *
 * `detect` is pure: the machine configuration arrives in `ctx.machine.config`. The preset floor
 * arrives in the optional second argument, because the engine does not pass the policy yet; without
 * it the baseline floor of the active major is used, and that fallback is reported in the evidence.
 *
 * A skip caused by the scope contract names what was not verified and the command that verifies it
 * (S6); a skip caused by an unavailable probe stays `probeUnavailable` (RFC 7.3).
 *
 * `detect` and `plan` read different things on purpose (RFC 11.2.1): the finding reports the
 * effective configuration the machine applies, while the plan reads only the repository's own
 * `pnpm-workspace.yaml`, so a machine that already satisfies the policy cannot suppress the write.
 */

import { quarantineFloor } from '../lib/policy.js';
import {
  WORKSPACE_RELATIVE,
  planTarget,
  quarantineStrictness,
  workspaceBlockFacts,
  writeQuarantineGate,
} from '../lib/writers.js';

const DOC = 'docs/rules/quarantine.md';
const AUTO = { kind: 'auto', command: 'funky-secure init --apply' };

export default {
  id: 'quarantine',
  title: 'Quarantine is a gate, not an approval list',
  label: 'Quarantine',
  scope: ['repo'],
  targets: ['repo-root'],
  friction: 2,
  severity: { baseline: 'warn', strict: 'error' },
  question:
    'Is the release-age quarantine an actual gate — a decision a human has to make — rather than an automatic approval list?',
  detection:
    'Read minimumReleaseAge, minimumReleaseAgeStrict and minimumReleaseAgeExclude from the effective configuration. The effective value is the reported age, else the built-in default for the active major (1440 since pnpm 11, 0 before) marked inherited. The effective strictness is the reported flag, else true only when the age was explicitly configured. Pass only when the gate is strict and the value meets the preset floor.',
  evidence:
    'effective value, inherited or configured, effective strictness, the preset floor, and the minimumReleaseAgeExclude entries (count and values).',
  remediation:
    'funky-secure init --apply writes minimumReleaseAgeStrict: true (and the 4320 floor under --preset strict), plus savePrefix: \'\' so a later pnpm add cannot save a caret. Manual: pnpm config set minimum-release-age-strict true --location=project, which in pnpm 12 writes pnpm-workspace.yaml and never a .npmrc — a hand-written .npmrc value is ignored (E8), and .npmrc is where sensitive-ignored requires tokens to stay. The hotfix escape hatch is minimumReleaseAgeExclude.',
  limits:
    'The effective listing merges global, workspace and environment configuration and cannot attribute a value to its source (E2), so the report never claims one. A hand-written .npmrc value is silently ignored by pnpm and cannot be detected here (E8). An unavailable version leaves the active major unknown and the 11/12 line default is used.',
  docs: DOC,

  /**
   * @param {object} ctx resolved context
   * @param {{ policy?: { preset?: string, quarantineMinutes?: number } }} [options]
   * @returns {Array<object>} findings
   */
  detect(ctx, { policy } = {}) {
    const config = ctx.machine?.config;
    if (config === null || config === undefined) {
      // `--scope repo` is the supported CI gate (RFC 7.2): the machine configuration is deliberately
      // out of contract there, so its absence is not an unavailable required probe. Either signal —
      // no machine facts at all, or machine facts collected without their configuration — is the
      // scope contract, and the skip states what it did not verify (S6).
      const outOfScope = ctx.machine === null || ctx.machine?.configOutOfScope === true;
      return [
        {
          status: 'skip',
          code: outOfScope ? 'machine-out-of-scope' : 'no-pnpm-config',
          scope: 'repo',
          target: 'repo-root',
          message: outOfScope
            ? 'skipped: the quarantine was not verified because the machine configuration is out of scope; run funky-secure scan --scope all to verify the release-age gate'
            : 'skipped: pnpm config list --json was unavailable',
          probeUnavailable: !outOfScope,
        },
      ];
    }

    if (typeof config.minimumReleaseAge !== 'undefined' && typeof config.minimumReleaseAge !== 'number') {
      return [
        {
          status: 'skip',
          code: 'unreadable-minimum-release-age',
          scope: 'repo',
          target: 'repo-root',
          message: 'skipped: minimumReleaseAge is not a number',
          probeUnavailable: true,
        },
      ];
    }

    const inherited = typeof config.minimumReleaseAge === 'undefined';
    const major = ctx.machine?.major;
    const effective = inherited
      ? // The built-in default is a function of the major, not of the preset (RFC 9.4, E1).
        quarantineFloor({ preset: 'baseline', major })
      : config.minimumReleaseAge;
    const strict = quarantineStrictness(ctx);
    const floor =
      policy?.quarantineMinutes ??
      quarantineFloor({ preset: policy?.preset ?? 'baseline', major });
    const exclusions = Array.isArray(config.minimumReleaseAgeExclude)
      ? config.minimumReleaseAgeExclude
      : [];
    const evidence = { effective, inherited, strict, policy: floor, exclusions };

    if (!strict) {
      return [
        {
          status: 'fail',
          code: 'quarantine-not-strict',
          scope: 'repo',
          target: 'repo-root',
          message: `quarantine is non-strict: pnpm auto-approves immature packages by writing minimumReleaseAgeExclude (${inherited ? 'inherited' : 'configured'} ${effective})`,
          evidence,
          remediation: AUTO,
        },
      ];
    }

    if (effective < floor) {
      return [
        {
          status: 'fail',
          code: 'quarantine-below-policy',
          scope: 'repo',
          target: 'repo-root',
          message: `quarantine is ${effective} minutes, below the ${floor}-minute policy floor`,
          evidence,
          remediation: AUTO,
        },
      ];
    }

    return [
      {
        status: 'pass',
        scope: 'repo',
        target: 'repo-root',
        message: `quarantine is a ${effective}-minute strict gate (policy floor ${floor})`,
        evidence,
      },
    ];
  },

  /**
   * RFC 8.2 fix `auto` (W1a, W1b, W1c): one managed block carrying the gate, the 4320 floor under the
   * strict preset and `savePrefix: ''`.
   *
   * The trigger is this repository's own `pnpm-workspace.yaml`, never the verdict of this run: a plan
   * derived from the finding would write nothing on a machine whose global configuration already
   * satisfies the policy, and the repository would only be hardened on that one laptop (RFC 11.2.1).
   * The effective value stays the finding's business.
   *
   * @param {object} ctx resolved context
   * @param {{ policy?: { preset?: string } }} [options]
   * @returns {Array<object>} plan items
   */
  plan(ctx, { policy = {} } = {}) {
    if (!ctx.repo) return [];

    const block = workspaceBlockFacts(ctx.repo.files?.workspaceYaml?.text ?? null);
    const strictFloor = policy.preset === 'strict';
    if (block.gate && block.savePrefix && !strictFloor) return [];

    return [
      planTarget(ctx, {
        relative: WORKSPACE_RELATIVE,
        operation: 'managed block',
        result: writeQuarantineGate({
          workspaceYaml: ctx.repo.files?.workspaceYaml?.text ?? null,
          exists: (ctx.repo.present ?? []).includes(WORKSPACE_RELATIVE),
          preset: strictFloor ? 'strict' : 'baseline',
        }),
      }),
    ];
  },
};
