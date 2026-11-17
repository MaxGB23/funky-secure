/**
 * The `next` block when the verdict is a pass but a finding names a command (#360).
 *
 * A `warn` below the `--fail-on` threshold is a pass, and the report used to close it with
 * `nothing to do` while the line above listed the command that does it. The spec (10.3) puts the
 * named command ahead of both "nothing to do" sentences, and chooses it the way the `init` branch
 * already chooses its rule: highest severity, ties by catalog order.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReport } from '../src/lib/report.js';
import { renderHuman } from '../src/lib/render-human.js';
import { catalog as ruleCatalog } from '../src/rules/index.js';

const tool = { name: 'funky-secure', version: '0.1.0' };
const policy = { preset: 'baseline', quarantineMinutes: 1440, failOn: 'error' };
const NEXT = 'next     ';

function finding(overrides = {}) {
  return {
    rule: 'alpha',
    status: 'fail',
    severity: 'warn',
    scope: 'repo',
    target: 'repo-root',
    path: undefined,
    message: 'a message',
    remediation: { kind: 'none' },
    ...overrides,
  };
}

function reportWith(findings, catalog = ruleCatalog) {
  return buildReport({
    scope: 'repo',
    policy,
    catalog,
    tool,
    targets: [{ kind: 'repo-root', path: '.' }],
    findings,
  });
}

function nextLines(report) {
  const lines = renderHuman(report).split('\n').filter((line) => line !== '');
  const start = lines.findIndex((line) => line.startsWith('next'));
  return start === -1 ? [] : lines.slice(start);
}

test('a passing run that lists an action ends by naming that action (#360)', () => {
  const report = reportWith([
    finding({
      rule: 'foreign-lockfile',
      severity: 'warn',
      evidence: { files: ['package-lock.json'], pnpmLockfile: false },
      message: 'package-lock.json is present; pnpm resolves this repository instead',
      remediation: { kind: 'manual', command: 'funky-secure migrate --from npm --apply' },
    }),
  ]);

  assert.equal(report.summary.verdict, 'pass', 'a warn is below the default threshold');
  assert.deepEqual(nextLines(report), [`${NEXT}funky-secure migrate --from npm --apply`]);
});

test('a passing run with no command still says there is nothing to do, byte for byte', () => {
  const report = reportWith([
    finding({
      rule: 'foreign-lockfile',
      severity: 'warn',
      evidence: { files: ['package-lock.json'], pnpmLockfile: false },
      message: 'a finding whose remedy is prose, not a command',
      remediation: { kind: 'manual' },
    }),
  ]);

  assert.equal(report.summary.verdict, 'pass');
  assert.deepEqual(nextLines(report), [
    `${NEXT}nothing to do: everything at or above the policy passes`,
  ]);
});

test('the command comes from the highest-severity finding, never from report order', () => {
  const report = reportWith(
    [
      finding({ rule: 'alpha', severity: 'info', remediation: { kind: 'manual', command: 'alpha --fix' } }),
      finding({ rule: 'beta', severity: 'warn', remediation: { kind: 'manual', command: 'beta --fix' } }),
    ],
    [],
  );

  assert.equal(report.summary.verdict, 'pass');
  assert.deepEqual(nextLines(report), [`${NEXT}beta --fix`]);
});

test('a severity tie is broken by catalog order, never by report order', () => {
  const report = reportWith([
    finding({
      rule: 'ci-no-safety-overrides',
      severity: 'warn',
      path: '.npmrc',
      line: 1,
      remediation: { kind: 'manual', command: 'delete the ignore-scripts key from .npmrc' },
    }),
    finding({
      rule: 'foreign-lockfile',
      severity: 'warn',
      evidence: { files: ['package-lock.json'], pnpmLockfile: false },
      remediation: { kind: 'manual', command: 'funky-secure migrate --from npm --apply' },
    }),
  ]);

  assert.equal(report.summary.verdict, 'pass');
  assert.deepEqual(nextLines(report), [`${NEXT}funky-secure migrate --from npm --apply`]);
});

test('a long command wraps on the gutter rather than breaking the 96-column bound (10.3)', () => {
  const command = `git rm --cached ${'nested/'.repeat(12)}production.env`;
  const report = reportWith(
    [finding({ rule: 'alpha', severity: 'warn', remediation: { kind: 'manual', command } })],
    [],
  );

  const lines = nextLines(report);
  assert.ok(lines.length > 1, 'a 100-column command cannot fit on one next line');
  assert.ok(
    lines.every((line) => line.length <= 96),
    `a next line exceeded 96 columns:\n${lines.join('\n')}`,
  );
  const rewritten = lines.map((line) => line.slice(NEXT.length)).join('');
  assert.equal(
    rewritten.replace(/\s+/g, ''),
    command.replace(/\s+/g, ''),
    'wrapping loses no character of the command',
  );
});
