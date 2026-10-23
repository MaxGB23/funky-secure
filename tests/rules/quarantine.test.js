import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePolicy } from '../../src/lib/policy.js';
import rule from '../../src/rules/quarantine.js';

/**
 * A plain context: the rule reads a resolved machine fact and nothing else, so no probe, no
 * filesystem and no clock are involved.
 * @param {object | null} config
 * @param {{ version?: string | null, major?: number | null }} [machine]
 */
function ctx(config, { version = '12.3.4', major = 12 } = {}) {
  return {
    scope: 'all',
    cwd: '/repo',
    root: '/repo',
    env: {},
    configPath: null,
    machine: {
      available: true,
      version,
      major,
      executable: '/usr/local/bin/pnpm',
      installations: ['/usr/local/bin/pnpm'],
      config,
      storePath: '/store',
      userAgent: version === null ? null : `pnpm/${version} npm/? node/? linux x64`,
      reportedVersion: version,
      versionAmbiguous: false,
    },
    repo: null,
  };
}

test('declares the fixed contract fields of R4', () => {
  assert.equal(rule.id, 'quarantine');
  assert.equal(rule.friction, 2);
  assert.deepEqual(rule.severity, { baseline: 'warn', strict: 'error' });
  assert.deepEqual(rule.scope, ['repo']);
  assert.deepEqual(rule.targets, ['repo-root']);
  assert.equal(rule.docs, 'docs/rules/quarantine.md');
  assert.ok(rule.question.includes('gate'));
});

test('an inherited 1440-minute default is non-strict and fails quarantine-not-strict', () => {
  const [finding] = rule.detect(ctx({ registry: 'https://registry.npmjs.org/' }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'quarantine-not-strict');
  assert.equal(
    finding.message,
    'quarantine is non-strict: pnpm auto-approves immature packages by writing minimumReleaseAgeExclude (inherited 1440)',
  );
  assert.deepEqual(finding.evidence, {
    effective: 1440,
    inherited: true,
    strict: false,
    policy: 1440,
    exclusions: [],
  });
  assert.deepEqual(finding.remediation, { kind: 'auto', command: 'funky-secure init --apply' });
});

test('a configured 4320-minute gate passes the strict preset floor', () => {
  const policy = resolvePolicy({ catalog: [rule], presetFromFlag: 'strict', major: 12 });
  const [finding] = rule.detect(ctx({ minimumReleaseAge: 4320 }), { policy });

  assert.equal(policy.quarantineMinutes, 4320);
  assert.equal(finding.status, 'pass');
  assert.equal(finding.evidence.effective, 4320);
  assert.equal(finding.evidence.inherited, false);
  assert.equal(finding.evidence.strict, true);
  assert.equal(finding.evidence.policy, 4320);
});

test('a strict 1440-minute gate fails quarantine-below-policy under the strict floor', () => {
  const policy = resolvePolicy({ catalog: [rule], presetFromFlag: 'strict', major: 12 });
  const [finding] = rule.detect(ctx({ minimumReleaseAge: 1440 }), { policy });

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'quarantine-below-policy');
  assert.equal(finding.evidence.effective, 1440);
  assert.equal(finding.evidence.strict, true);
  assert.equal(finding.evidence.policy, 4320);
  assert.ok(finding.message.includes('1440'));
  assert.ok(finding.message.includes('4320'));
});

test('without a policy argument the baseline floor of the active major is used', () => {
  const [finding] = rule.detect(ctx({ minimumReleaseAge: 1440 }));

  assert.equal(finding.status, 'pass');
  assert.equal(finding.evidence.policy, 1440);
});

test('before pnpm 11 the inherited default is 0 minutes and still non-strict', () => {
  const [finding] = rule.detect(ctx({}, { version: '10.24.0', major: 10 }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'quarantine-not-strict');
  assert.equal(finding.evidence.effective, 0);
  assert.equal(finding.evidence.inherited, true);
  assert.ok(finding.message.endsWith('(inherited 0)'));
});

test('an explicit non-strict flag fails even when the value meets the floor', () => {
  const [finding] = rule.detect(
    ctx({ minimumReleaseAge: 8640, minimumReleaseAgeStrict: false }),
    { policy: { quarantineMinutes: 4320 } },
  );

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'quarantine-not-strict');
  assert.equal(finding.evidence.effective, 8640);
  assert.equal(finding.evidence.inherited, false);
  assert.equal(finding.evidence.strict, false);
  assert.ok(finding.message.endsWith('(configured 8640)'));
});

test('reports the minimumReleaseAgeExclude entries, never hiding an exemption', () => {
  const exclusions = ['react@0.0.0-experimental-a6b912fb-20261023', 'is-number@7.0.0'];
  const [finding] = rule.detect(
    ctx({ minimumReleaseAge: 4320, minimumReleaseAgeStrict: true, minimumReleaseAgeExclude: exclusions }),
    { policy: { quarantineMinutes: 4320 } },
  );

  assert.equal(finding.status, 'pass');
  assert.deepEqual(finding.evidence.exclusions, exclusions);
});

test('an absent exclusion list is reported as an empty array', () => {
  const [finding] = rule.detect(ctx({ minimumReleaseAge: 4320 }), {
    policy: { quarantineMinutes: 4320 },
  });

  assert.deepEqual(finding.evidence.exclusions, []);
});

test('no pnpm configuration is a skip, not a guessed pass', () => {
  const [finding] = rule.detect(ctx(null));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-pnpm-config');
  assert.equal(finding.probeUnavailable, true);
  assert.ok(finding.message.startsWith('skipped: '));
});

test('a minimumReleaseAge that is not a number is a skip, not a coerced zero', () => {
  const [finding] = rule.detect(ctx({ minimumReleaseAge: '4320' }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'unreadable-minimum-release-age');
  assert.equal(finding.probeUnavailable, true);
});
