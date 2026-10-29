import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ConfigError,
  PRESETS,
  RULE_SEVERITIES,
  FAIL_ON_VALUES,
  quarantineFloor,
  resolvePolicy,
  severityRank,
} from '../src/lib/policy.js';
import { catalog as ruleCatalog } from '../src/rules/index.js';

const catalog = [
  { id: 'pin', severity: { baseline: 'error', strict: 'error' } },
  { id: 'exact', severity: { baseline: 'warn', strict: 'error' } },
  { id: 'bots', severity: { baseline: 'error', strict: 'error' } },
];

test('exposes the closed vocabularies of the policy model', () => {
  assert.deepEqual(PRESETS, ['baseline', 'strict', 'starter']);
  assert.deepEqual(RULE_SEVERITIES, ['off', 'info', 'warn', 'error']);
  assert.deepEqual(FAIL_ON_VALUES, ['error', 'warn', 'info', 'none']);
});

test('resolves the preset from the flag, then the config, then baseline', () => {
  const base = { catalog, failOn: 'error' };

  assert.equal(resolvePolicy({ ...base }).preset, 'baseline');
  assert.equal(resolvePolicy({ ...base, config: { preset: 'strict' } }).preset, 'strict');
  assert.equal(
    resolvePolicy({ ...base, presetFromFlag: 'baseline', config: { preset: 'strict' } }).preset,
    'baseline',
  );
});

test('takes each rule severity from the preset and promotes it when the config says so', () => {
  const baseline = resolvePolicy({ catalog, failOn: 'error' });
  const strict = resolvePolicy({ catalog, failOn: 'error', presetFromFlag: 'strict' });
  const overridden = resolvePolicy({ catalog, failOn: 'error', config: { rules: { exact: 'error' } } });

  assert.deepEqual(baseline.severities, { pin: 'error', exact: 'warn', bots: 'error' });
  assert.deepEqual(strict.severities, { pin: 'error', exact: 'error', bots: 'error' });
  assert.deepEqual(overridden.severities, { pin: 'error', exact: 'error', bots: 'error' });
});

test('--only narrows the active set while --ignore wins over it', () => {
  const only = resolvePolicy({ catalog, failOn: 'error', only: ['pin', 'exact'] });
  const both = resolvePolicy({ catalog, failOn: 'error', only: ['pin', 'exact'], ignore: ['exact'] });

  assert.deepEqual(only.active, ['pin', 'exact']);
  assert.deepEqual(both.active, ['pin']);
});

test('a rule set to off is not run and contributes nothing', () => {
  const policy = resolvePolicy({ catalog, failOn: 'error', config: { rules: { bots: 'off' } } });

  assert.deepEqual(policy.active, ['pin', 'exact']);
  assert.deepEqual(policy.severities, { pin: 'error', exact: 'warn', bots: 'off' });
});

test('--only never resurrects a rule that the config turned off', () => {
  const policy = resolvePolicy({
    catalog,
    failOn: 'error',
    config: { rules: { bots: 'off' } },
    only: ['bots'],
  });

  assert.deepEqual(policy.active, []);
});

test('names the offending key when the policy cannot be resolved', () => {
  const cases = [
    [{ only: ['nope'] }, 'nope'],
    [{ ignore: ['nope'] }, 'nope'],
    [{ config: { rules: { nope: 'warn' } } }, 'nope'],
    [{ config: { rules: { pin: 'fatal' } } }, 'pin'],
    [{ presetFromFlag: 'paranoid' }, 'paranoid'],
    [{ failOn: 'sometimes' }, 'sometimes'],
    [{ config: { preset: 'paranoid' } }, 'paranoid'],
  ];

  for (const [overrides, key] of cases) {
    assert.throws(
      () => resolvePolicy({ catalog, failOn: 'error', ...overrides }),
      (error) => error instanceof ConfigError && error.message.includes(key),
    );
  }
});

test('falls back to the error threshold when none is given', () => {
  assert.equal(resolvePolicy({ catalog }).failOn, 'error');
});

test('quarantine floor follows the preset, the pinned major and the repository override', () => {
  assert.equal(quarantineFloor({ preset: 'baseline' }), 1440);
  assert.equal(quarantineFloor({ preset: 'baseline', major: 10 }), 0);
  assert.equal(quarantineFloor({ preset: 'baseline', major: 12 }), 1440);
  assert.equal(quarantineFloor({ preset: 'strict' }), 4320);
  assert.equal(quarantineFloor({ preset: 'strict', override: 10080 }), 10080);
  assert.equal(quarantineFloor({ preset: 'baseline', override: 720 }), 720);
});

test('carries the resolved quarantine floor into the policy', () => {
  assert.equal(resolvePolicy({ catalog, presetFromFlag: 'strict' }).quarantineMinutes, 4320);
  assert.equal(
    resolvePolicy({ catalog, config: { quarantineMinutes: 2880 } }).quarantineMinutes,
    2880,
  );
  assert.equal(resolvePolicy({ catalog, major: 9 }).quarantineMinutes, 0);
});

test('ranks severities so the verdict can compare them', () => {
  assert.deepEqual(['off', 'info', 'warn', 'error'].map(severityRank), [0, 1, 2, 3]);
});

/// The `starter` preset (record 0003, S5): exactly five rules at their `baseline` severity, the other
/// seven `off`, resolvable from the flag and from the config file, and `baseline`/`strict` untouched.

/** The five the record names, in catalog order — the order the report prints them in. */
const STARTER_ACTIVE = [
  'package-manager-pin',
  'lockfile-committed',
  'quarantine',
  'exact-versions',
  'sensitive-ignored',
];
const CATALOG_IDS = ruleCatalog.map((rule) => rule.id);

const resolve = (options) => resolvePolicy({ catalog: ruleCatalog, failOn: 'error', ...options });

/** The ids the resolved policy leaves `off`, in catalog order. */
function disabled(policy) {
  return CATALOG_IDS.filter((id) => policy.severities[id] === 'off');
}

test('starter resolves from --preset and from the config file', () => {
  assert.equal(resolve({ presetFromFlag: 'starter' }).preset, 'starter');
  assert.equal(resolve({ config: { preset: 'starter' } }).preset, 'starter');
  assert.equal(
    resolve({ presetFromFlag: 'baseline', config: { preset: 'starter' } }).preset,
    'baseline',
    'the flag still wins over the config',
  );
});

test('starter runs exactly five rules and turns the other seven off', () => {
  const policy = resolve({ presetFromFlag: 'starter' });

  assert.deepEqual(policy.active, STARTER_ACTIVE, 'the five the record names, in catalog order');
  assert.deepEqual(disabled(policy), [
    'foreign-lockfile',
    'env-not-tracked',
    'actions-pinned-sha',
    'no-bot-auto-merge',
    'ci-no-safety-overrides',
    'pull-request-target',
    'workflow-permissions',
  ]);
  assert.equal(policy.active.length + disabled(policy).length, CATALOG_IDS.length);
});

test('starter takes each of its five rules from that rule baseline severity', () => {
  const policy = resolve({ presetFromFlag: 'starter' });

  for (const rule of ruleCatalog) {
    const expected = STARTER_ACTIVE.includes(rule.id) ? rule.severity.baseline : 'off';
    assert.equal(policy.severities[rule.id], expected, `${rule.id} is ${policy.severities[rule.id]}`);
  }
  assert.equal(policy.severities['exact-versions'], 'warn', 'a baseline warn stays a warn');
  assert.equal(policy.severities.quarantine, 'warn', 'starter is a reduced baseline, not a second strict');
});

test('baseline and strict keep every rule and every declared severity', () => {
  for (const preset of ['baseline', 'strict']) {
    const policy = resolve({ presetFromFlag: preset });

    assert.deepEqual(policy.active, CATALOG_IDS, `${preset} runs every catalog rule`);
    assert.deepEqual(disabled(policy), [], `${preset} turns nothing off`);
    for (const rule of ruleCatalog) {
      assert.equal(
        policy.severities[rule.id],
        rule.severity[preset],
        `${preset} gives ${rule.id} its own declared severity`,
      );
    }
  }
});

test('the config still overrides a starter severity, and off is still off', () => {
  const promoted = resolve({ presetFromFlag: 'starter', config: { rules: { quarantine: 'error' } } });
  const silenced = resolve({ presetFromFlag: 'starter', config: { rules: { quarantine: 'off' } } });

  assert.equal(promoted.severities.quarantine, 'error');
  assert.deepEqual(silenced.active, ['package-manager-pin', 'lockfile-committed', 'exact-versions', 'sensitive-ignored']);
});

test('starter keeps the manager default quarantine, never the strict floor', () => {
  assert.equal(quarantineFloor({ preset: 'starter' }), 1440);
  assert.equal(quarantineFloor({ preset: 'starter', major: 12 }), 1440);
  assert.equal(quarantineFloor({ preset: 'starter', major: 9 }), 0, 'the pre-11 default is still 0');
  assert.equal(quarantineFloor({ preset: 'starter', override: 720 }), 720);
  assert.equal(resolve({ presetFromFlag: 'starter' }).quarantineMinutes, 1440);
  assert.equal(resolve({ presetFromFlag: 'baseline' }).quarantineMinutes, 1440);
  assert.equal(resolve({ presetFromFlag: 'strict' }).quarantineMinutes, 4320);
});
