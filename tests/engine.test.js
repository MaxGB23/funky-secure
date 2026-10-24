import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluate } from '../src/lib/engine.js';

const policy = {
  preset: 'baseline',
  quarantineMinutes: 1440,
  failOn: 'error',
  severities: { alpha: 'warn', beta: 'error', off: 'off' },
  active: ['alpha', 'beta'],
};

function rule(overrides = {}) {
  return {
    id: 'alpha',
    scope: ['repo'],
    targets: ['repo-root'],
    detect: () => [{ status: 'pass', message: 'fine' }],
    ...overrides,
  };
}

test('supplies rule, effective severity, scope, target and doc so a rule cannot set them', () => {
  const findings = evaluate({
    ctx: {},
    policy,
    catalog: [
      rule({
        detect: () => [
          {
            status: 'fail',
            severity: 'error',
            rule: 'someone-else',
            doc: 'elsewhere',
            message: 'm',
          },
        ],
      }),
    ],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'alpha');
  assert.equal(findings[0].severity, 'warn', 'the policy wins over what the rule claims');
  assert.equal(findings[0].scope, 'repo');
  assert.equal(findings[0].target, 'repo-root');
  assert.equal(findings[0].doc, 'funky-secure explain alpha');
});

test('hands the resolved policy to the rule as a second argument', () => {
  let received = null;
  evaluate({
    ctx: { marker: true },
    policy,
    catalog: [rule({ detect: (ctx, extra) => (received = { ctx, extra }) ?? [{ status: 'pass', message: '' }] })],
  });

  assert.equal(received.ctx.marker, true);
  assert.equal(received.extra.policy, policy);
  assert.equal(received.extra.severity, 'warn');
});

test('never runs a rule the policy turned off or left out', () => {
  let calls = 0;
  const found = evaluate({
    ctx: {},
    policy,
    catalog: [rule({ id: 'off', detect: () => (calls += 1) }), rule({ id: 'gamma' })],
  });

  assert.equal(calls, 0);
  assert.deepEqual(found, []);
});

test('turns a throwing rule into an error finding instead of a crash', () => {
  const findings = evaluate({
    ctx: {},
    policy,
    catalog: [
      rule({
        detect: () => {
          throw new Error('boom');
        },
      }),
    ],
  });

  assert.equal(findings[0].status, 'error');
  assert.match(findings[0].message, /boom/);
});

test('turns a rule that returns no array into an error finding', () => {
  const findings = evaluate({ ctx: {}, policy, catalog: [rule({ detect: () => undefined })] });

  assert.equal(findings[0].status, 'error');
  assert.match(findings[0].message, /returned no finding/);
});

test('promotes an unavailable probe to error only under --strict-probes', () => {
  const skipping = () => [
    { status: 'skip', code: 'no-pnpm', message: 'skipped: no pnpm', probeUnavailable: true },
  ];

  const lenient = evaluate({ ctx: {}, policy, catalog: [rule({ detect: skipping })] });
  const strict = evaluate({ ctx: {}, policy, catalog: [rule({ detect: skipping })], strictProbes: true });

  assert.equal(lenient[0].status, 'skip');
  assert.equal(lenient[0].severity, 'warn');
  assert.equal(strict[0].status, 'error');
  assert.equal(strict[0].severity, 'error');
  assert.match(strict[0].message, /required probe unavailable/);
});

test('defaults remediation and message so a finding is always renderable', () => {
  const findings = evaluate({
    ctx: {},
    policy,
    catalog: [rule({ detect: () => [{ status: 'skip' }] })],
  });

  assert.deepEqual(findings[0].remediation, { kind: 'none' });
  assert.equal(findings[0].message, '');
});
