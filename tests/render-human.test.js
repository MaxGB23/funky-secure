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
import { join } from 'node:path';

import { buildReport } from '../src/lib/report.js';
import { renderHuman } from '../src/lib/render-human.js';
import { catalog as ruleCatalog } from '../src/rules/index.js';

const tool = { name: 'funky-secure', version: '0.1.0' };
const policy = { preset: 'baseline', quarantineMinutes: 1440, failOn: 'error' };
const NEXT = 'next     ';
const ACTION = '     → ';
/**
 * An absolute root that need never exist: the rendering is arithmetic over strings (10.3), and a short
 * spelling keeps a prefixed command on one line, which is what these tests assert.
 */
const ROOT = process.platform === 'win32' ? 'C:\\repo' : '/repo';
const MEMBER = join(ROOT, 'packages', 'a');
const DEEP = join(MEMBER, 'src', 'deep');

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

function nextLines(report, options) {
  const lines = renderHuman(report, options).split('\n').filter((line) => line !== '');
  const start = lines.findIndex((line) => line.startsWith('next'));
  return start === -1 ? [] : lines.slice(start);
}

/** A report whose verdict passes and whose only finding names `command` (10.3). */
function commandReport(command) {
  return reportWith([
    finding({
      severity: 'warn',
      path: 'pnpm-lock.yaml',
      message: 'a message',
      remediation: { kind: 'manual', command },
    }),
  ]);
}

function actionLines(text) {
  return text.split('\n').filter((line) => line.startsWith(ACTION));
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

test('a long command stays on one line, past the 96-column bound (10.3)', () => {
  const command = `git rm --cached ${'nested/'.repeat(12)}production.env`;
  const report = reportWith(
    [finding({ rule: 'alpha', severity: 'warn', remediation: { kind: 'manual', command } })],
    [],
  );

  const lines = nextLines(report);
  assert.deepEqual(lines, [NEXT + command], 'the command is one line, however long');
  assert.deepEqual(actionLines(renderHuman(report)), [ACTION + command], 'at the finding too');
  assert.ok(command.length + NEXT.length > 96, 'this command is long enough that wrapping was the old answer');
  const others = renderHuman(report)
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith(NEXT) && !line.startsWith(ACTION));
  assert.ok(
    others.every((line) => line.length <= 96),
    `a line that is not the command exceeded 96 columns:\n${others.join('\n')}`,
  );
});

// --- The report says where its commands run (10.3, issue #540) -------------------------------

test('from a member, each tool command states the absolute root at both print sites', () => {
  for (const command of [
    'pnpm install --lockfile-only',
    'git rm --cached production.env',
    'corepack use pnpm@10.0.0',
  ]) {
    const report = commandReport(command);
    const text = renderHuman(report, { root: ROOT, cwd: MEMBER });
    const spelling = `(cd "${ROOT}" && ${command})`;

    assert.deepEqual(actionLines(text), [ACTION + spelling], `${command}: the action line states the root`);
    assert.deepEqual(nextLines(report, { root: ROOT, cwd: MEMBER }), [NEXT + spelling], `${command}: the next block agrees`);
    assert.equal(
      text.split(spelling).length - 1,
      2,
      `${command}: one command, one spelling, printed at both sites`,
    );
  }
});

test('from two levels below, both print sites carry the same root spelling', () => {
  const command = 'pnpm install --lockfile-only';
  const report = commandReport(command);
  const text = renderHuman(report, { root: ROOT, cwd: DEEP });
  const spelling = `(cd "${ROOT}" && ${command})`;

  assert.deepEqual(actionLines(text), [ACTION + spelling]);
  assert.deepEqual(nextLines(report, { root: ROOT, cwd: DEEP }), [NEXT + spelling]);
  assert.equal(text.split(spelling).length - 1, 2, 'one command, one spelling');
});

test('at the root the rendered bytes are today’s, and with no directory nothing is added', () => {
  const report = commandReport('git rm --cached production.env');
  const today = renderHuman(report);

  assert.equal(renderHuman(report, { root: ROOT, cwd: ROOT }), today, 'the root prints today’s bytes');
  assert.equal(renderHuman(report, { root: ROOT }), today, 'no directory prints today’s bytes');
  assert.equal(renderHuman(report, { cwd: MEMBER }), today, 'no root prints today’s bytes');
  assert.equal(today.includes('(cd'), false, 'the root never states a directory');
});

test('a command this tool does not print for the root is unchanged from a member', () => {
  for (const command of [
    'delete the ignore-scripts key from .npmrc',
    'funky-secure migrate --from npm --apply',
  ]) {
    const report = commandReport(command);
    const text = renderHuman(report, { root: ROOT, cwd: MEMBER });

    assert.deepEqual(actionLines(text), [ACTION + command], `${command}: the action line is unchanged`);
    assert.deepEqual(nextLines(report, { root: ROOT, cwd: MEMBER }), [NEXT + command]);
    assert.equal(text.includes('(cd'), false, `${command}: no directory is added`);
  }
});

test('a prefixed command that passes 96 columns is one pasteable line at both sites', () => {
  const command = `git rm --cached ${'nested/'.repeat(12)}production.env`;
  const report = commandReport(command);
  const text = renderHuman(report, { root: ROOT, cwd: DEEP });
  const spelling = `(cd "${ROOT}" && ${command})`;

  // A field round found the old answer here: `wrap` split the group after `(cd`, so the printed block
  // was a parse error on both shells — the line it cut ended with `&&` and the next began with it
  // (cmd 255, bash 2). The line that exists to be pasted outranks the reading bound (10.3).
  assert.ok(spelling.length + ACTION.length > 96, 'the prefix takes this spelling past the reading bound');
  assert.deepEqual(actionLines(text), [ACTION + spelling], 'the action line is the whole group, unbroken');
  assert.deepEqual(nextLines(report, { root: ROOT, cwd: DEEP }), [NEXT + spelling], 'and so is the next line');
  assert.equal(
    text.split('\n').some((line) => line.trimEnd().endsWith('&&')),
    false,
    'no line ends with the operator, so no shell sees a group cut there',
  );
});
