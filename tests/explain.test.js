import test from 'node:test';
import assert from 'node:assert/strict';

import { run } from '../src/cli.js';
import { catalog } from '../src/rules/index.js';
import foreignLockfile from '../src/rules/foreign-lockfile.js';
import packageManagerPin from '../src/rules/package-manager-pin.js';

/**
 * `explain` as the complete reference for a rule (RFC 11.4, decision I-33): the surface a reader
 * trusts to tell them what a rule will do. Its human rendering is the only place a state severity can
 * be stated — a rule whose severity follows the state of its finding declares `severityWhen` (0029),
 * and a line that prints only the base pair understates it (issue #105).
 *
 * The JSON document is not covered here on purpose: whether it grows a state table is its own record.
 */

function capture() {
  return {
    text: '',
    write(chunk) {
      this.text += chunk;
      return true;
    },
    isTTY: false,
  };
}

/** The human rendering of one explain id, with the streams captured. */
async function explain(argv, options = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(['explain', ...argv], {
    cwd: process.cwd(),
    env: {},
    stdout,
    stderr,
    ...options,
  });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/** The pair a state declares, defaults included, so a test never restates the renderer's fallback. */
function pairOf(severity) {
  return `${severity?.baseline ?? 'warn'} / ${severity?.strict ?? 'warn'}`;
}

test('a rule whose severity follows the state names the state severity and the state that selects it', async () => {
  const { code, stdout } = await explain(['foreign-lockfile']);

  assert.equal(code, 0);

  // The base pair stays: it is the severity of the state the table does not name.
  assert.ok(
    stdout.includes(
      `friction ${foreignLockfile.friction} · severity ${pairOf(foreignLockfile.severity)} (baseline / strict)`,
    ),
    stdout,
  );

  // Every entry the rule declares is stated, generated from the table rather than from one rule id.
  for (const entry of foreignLockfile.severityWhen) {
    assert.ok(
      stdout.includes(`${entry.state} ${pairOf(entry.severity)}`),
      `the ${entry.state} state and its pair "${pairOf(entry.severity)}" are not in the output:\n${stdout}`,
    );
    assert.ok(
      stdout.includes(`${entry.evidence} is ${entry.is}`),
      `the ${entry.state} state does not say what selects it:\n${stdout}`,
    );
  }

  // The coexistence error is the whole point of the issue: a reader must meet it outside the prose.
  const severityLines = stdout.split('\n').filter((line) => line.startsWith('state'));
  assert.ok(severityLines.length > 0, `no state severity line was printed:\n${stdout}`);
});

test('the state line is generated from severityWhen, not hardcoded for one rule', async () => {
  const synthetic = {
    id: 'synthetic-state',
    title: 'A rule the catalog does not have',
    friction: 2,
    severity: { baseline: 'warn', strict: 'warn' },
    severityWhen: [
      {
        state: 'quarantined',
        evidence: 'quarantineDays',
        is: 7,
        severity: { baseline: 'info', strict: 'error' },
      },
    ],
  };

  const { code, stdout } = await explain(['synthetic-state'], { catalog: [synthetic] });

  assert.equal(code, 0);
  assert.ok(stdout.includes('quarantined info / error'), stdout);
  assert.ok(stdout.includes('quarantineDays is 7'), stdout);
});

test('a rule with no severityWhen prints exactly what it printed before (byte for byte)', async () => {
  const expected = [
    `${packageManagerPin.id} — ${packageManagerPin.title}`,
    '',
    `friction ${packageManagerPin.friction} · severity ${packageManagerPin.severity.baseline} / ${packageManagerPin.severity.strict} (baseline / strict)`,
    '',
    `question    ${packageManagerPin.question}`,
    `detection   ${packageManagerPin.detection}`,
    `evidence    ${packageManagerPin.evidence}`,
    `remediation ${packageManagerPin.remediation}`,
    `limits      ${packageManagerPin.limits}`,
    `docs        ${packageManagerPin.docs}`,
    '',
  ].join('\n');

  const { code, stdout } = await explain(['package-manager-pin']);

  assert.equal(code, 0);
  assert.equal(stdout, expected, 'a rule without a state table gained or lost a line');
});

test('--list keeps the one line per rule it always printed (previous behavior preserved)', async () => {
  const { code, stdout } = await explain(['--list']);

  assert.equal(code, 0);

  const idWidth = Math.max(...catalog.map((rule) => rule.id.length));
  const line = stdout.split('\n').find((candidate) => candidate.startsWith('foreign-lockfile'));
  assert.equal(
    line,
    `${'foreign-lockfile'.padEnd(idWidth)}  warn/warn  ${foreignLockfile.title}`,
    'the list line grew a state the list form never printed',
  );
  assert.equal(
    stdout.split('\n').filter((row) => row !== '').length,
    catalog.length,
    'the catalog list changed shape',
  );
});

test('the JSON document of a rule keeps its base pair and grows no state field (previous behavior preserved)', async () => {
  const { code, stdout } = await explain(['foreign-lockfile', '--format', 'json']);

  assert.equal(code, 0);
  const document = JSON.parse(stdout);
  assert.deepEqual(document.rules[0].severity, { baseline: 'warn', strict: 'warn' });
  assert.equal(
    Object.hasOwn(document.rules[0], 'severityWhen'),
    false,
    'the JSON document is decided by its own record, not by this fix (issue #105)',
  );
});
