/**
 * The dogfooding proof (RFC 15.4, 2.8, 20.10): this repository passes its own scan with the real
 * collector and the real machine. If the repository stops passing, this test fails — that is the
 * point, not an inconvenience.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { run } from '../src/cli.js';

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

/** The real CLI against this repository root, with the real collector and the real environment. */
async function selfScan(argv) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(argv, {
    cwd: process.cwd(),
    env: process.env,
    stdout,
    stderr,
  });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

test('the repository passes its own scan at --fail-on warn', async () => {
  const { code, stdout, stderr } = await selfScan(['scan', '--scope', 'repo', '--fail-on', 'warn']);

  assert.equal(stderr, '', 'the self-scan wrote to stderr');
  assert.equal(code, 0, `the self-scan exited ${code}:\n${stdout}`);
  assert.equal(stdout.includes('✖'), false, `the self-scan reported a failure:\n${stdout}`);
  assert.match(stdout, /verdict {2}PASS/);
});

test('the JSON self-scan passes and every finding is a declared skip', async () => {
  const { code, stdout, stderr } = await selfScan(['scan', '--scope', 'repo', '--format', 'json']);

  assert.equal(stderr, '', 'the JSON self-scan wrote to stderr');
  assert.equal(code, 0, `the JSON self-scan exited ${code}:\n${stdout}`);

  const report = JSON.parse(stdout);
  assert.equal(report.summary.verdict, 'pass');

  // `scan --scope repo` excludes the machine configuration by contract, so the quarantine rule
  // reports a skip with a reason. A skip is never a pass and is never silently dropped.
  for (const finding of report.findings) {
    assert.equal(finding.status, 'skip', `${finding.rule} reported ${finding.status}`);
    assert.equal(typeof finding.code, 'string', `${finding.rule} skip carries no code`);
    assert.match(finding.message, /^skipped: /, `${finding.rule} skip declares no reason`);
  }
});
