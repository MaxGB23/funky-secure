import test from 'node:test';
import assert from 'node:assert/strict';

import { IGNORE_CANDIDATES } from '../../src/lib/targets.js';
import rule from '../../src/rules/sensitive-ignored.js';

/**
 * A plain context: the ignore verdict is a resolved fact (`git check-ignore` ran before the rule),
 * the tracked list is a resolved set and the only file text is the root `.npmrc`.
 * @param {object} options
 */
function ctx({
  ignored = [...IGNORE_CANDIDATES],
  tracked = [],
  npmrc = null,
  inGit = true,
} = {}) {
  return {
    scope: 'repo',
    cwd: '/repo',
    root: inGit ? '/repo' : null,
    env: {},
    configPath: null,
    machine: null,
    repo: {
      root: '/repo',
      inGit,
      branch: inGit ? 'main' : null,
      files: { packageJson: null, workspaceYaml: null, lockfile: null, npmrc, gitignore: null },
      present: [],
      tracked: tracked === null ? null : new Set(tracked),
      ignoreCandidates: IGNORE_CANDIDATES,
      ignored: ignored === null ? null : new Set(ignored),
      importers: [],
      workflows: [],
      botFiles: [],
      editorFiles: [],
      skippedGlobs: [],
    },
  };
}

test('declares the fixed contract fields of R7', () => {
  assert.equal(rule.id, 'sensitive-ignored');
  assert.equal(rule.friction, 0);
  assert.deepEqual(rule.severity, { baseline: 'error', strict: 'error' });
  assert.deepEqual(rule.scope, ['repo']);
  assert.deepEqual(rule.targets, ['repo-root']);
  assert.equal(rule.docs, 'docs/rules/sensitive-ignored.md');
});

test('every candidate ignored and nothing sensitive tracked passes', () => {
  const findings = rule.detect(ctx({ tracked: ['.env.example', 'docs/keys.md', 'src/index.js'] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, undefined);
});

test('missing ignore coverage is one finding that names every missing entry', () => {
  const ignored = IGNORE_CANDIDATES.filter((path) => path !== '.env' && path !== 'server.key');
  const findings = rule.detect(ctx({ ignored }));
  const failures = findings.filter((finding) => finding.status === 'fail');

  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 'not-ignored');
  assert.deepEqual(failures[0].evidence, {
    path: '.gitignore',
    missing: ['.env', 'server.key'],
  });
  assert.ok(failures[0].message.includes('.env'));
  assert.ok(failures[0].message.includes('server.key'));
  assert.deepEqual(failures[0].remediation, {
    kind: 'auto',
    command: 'funky-secure init --apply',
  });
});

test('a tracked .env.example is a template, not a secret', () => {
  const findings = rule.detect(
    ctx({ tracked: ['.env.example', '.env.sample', 'config/server.key.example'] }),
  );

  assert.deepEqual(
    findings.map((finding) => finding.status),
    ['pass'],
  );
});

test('a root .npmrc without a token is not a finding when it is ignored', () => {
  const findings = rule.detect(
    ctx({ npmrc: { path: '/repo/.npmrc', text: 'registry=https://registry.npmjs.org/\n' } }),
  );

  assert.deepEqual(
    findings.map((finding) => finding.status),
    ['pass'],
  );
});

test('a root .npmrc with an auth token is redacted in the evidence and absent from the message', () => {
  const text = 'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=npm_secret_value\n';
  const findings = rule.detect(ctx({ npmrc: { path: '/repo/.npmrc', text } }));
  const failures = findings.filter((finding) => finding.status === 'fail');

  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 'npmrc-token');
  assert.equal(failures[0].path, '.npmrc');
  assert.deepEqual(failures[0].evidence, { path: '.npmrc', token: '<redacted>' });
  assert.ok(!JSON.stringify(failures[0]).includes('npm_secret_value'));
});

test('tracked *.pem and *.key files are findings with a manual removal command', () => {
  const findings = rule.detect(ctx({ tracked: ['certs/server.pem', 'server.key', 'src/index.js'] }));
  const failures = findings.filter((finding) => finding.status === 'fail');

  assert.deepEqual(
    failures.map((finding) => finding.code),
    ['tracked-sensitive-file', 'tracked-sensitive-file'],
  );
  assert.deepEqual(
    failures.map((finding) => finding.path),
    ['certs/server.pem', 'server.key'],
  );
  assert.deepEqual(failures[0].remediation, {
    kind: 'manual',
    command: 'git rm --cached certs/server.pem',
  });
});

test('outside git the rule skips instead of assuming ignore coverage', () => {
  const [finding] = rule.detect(ctx({ ignored: null, inGit: false }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-git');
  assert.equal(finding.probeUnavailable, true);
  assert.ok(finding.message.startsWith('skipped: '));
});

test('an unreadable tracked set is a skip, never an assumed empty set', () => {
  const findings = rule.detect(ctx({ tracked: null }));

  assert.deepEqual(
    findings.map((finding) => [finding.status, finding.code]),
    [['skip', 'unreadable-tracked-files']],
  );
});

test('without a resolved repository the rule skips', () => {
  const [finding] = rule.detect({ ...ctx(), repo: null });

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-repo');
  assert.equal(finding.probeUnavailable, true);
});
