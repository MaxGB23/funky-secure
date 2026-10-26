import test from 'node:test';
import assert from 'node:assert/strict';

import rule from '../../src/rules/env-not-tracked.js';

/** A complete repository fact set, as `src/lib/targets.js` resolves it. */
function repo(overrides = {}) {
  return {
    root: '/repo',
    inGit: true,
    branch: 'main',
    files: {
      packageJson: null,
      workspaceYaml: null,
      lockfile: null,
      npmrc: null,
      gitignore: null,
    },
    present: [],
    tracked: new Set(),
    ignoreCandidates: [],
    ignored: new Set(),
    importers: [],
    workflows: [],
    botFiles: [],
    editorFiles: [],
    skippedGlobs: [],
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    scope: 'repo',
    cwd: '/repo',
    root: '/repo',
    env: {},
    configPath: null,
    machine: null,
    repo: repo(),
    ...overrides,
  };
}

test('fails a committed .env and names the rotation requirement', () => {
  const findings = rule.detect(context({ repo: repo({ tracked: new Set(['.env', 'package.json']) }) }));

  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'env-tracked');
  assert.equal(finding.path, '.env');
  assert.deepEqual(finding.evidence, { path: '.env' });
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'git rm --cached .env' });
  assert.match(finding.message, /\.env/);
  assert.match(finding.message, /rotat/i);
});

test('passes when only template names are tracked, nested templates included', () => {
  const tracked = new Set([
    '.env.example',
    '.env.sample',
    '.env.template',
    '.env.dist',
    '.env.test.example',
    'packages/api/.env.example',
  ]);

  const findings = rule.detect(context({ repo: repo({ tracked }) }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'no-env-tracked');
});

test('fails an environment file nested at any depth', () => {
  const findings = rule.detect(
    context({ repo: repo({ tracked: new Set(['packages/api/.env', 'src/index.js']) }) }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'env-tracked');
  assert.equal(findings[0].path, 'packages/api/.env');
  assert.deepEqual(findings[0].remediation, {
    kind: 'manual',
    command: 'git rm --cached packages/api/.env',
  });
  assert.match(findings[0].message, /must be rotated/, 'the message keeps the rotation the fix does not do');
});

test('reports one finding per tracked environment file, in path order', () => {
  const findings = rule.detect(
    context({ repo: repo({ tracked: new Set(['b/.env', '.env.local', '.env']) }) }),
  );

  assert.deepEqual(
    findings.map((finding) => [finding.status, finding.path]),
    [
      ['fail', '.env'],
      ['fail', '.env.local'],
      ['fail', 'b/.env'],
    ],
  );
  assert.deepEqual(
    findings.map((finding) => finding.remediation.command),
    ['git rm --cached .env', 'git rm --cached .env.local', 'git rm --cached b/.env'],
    'every tracked environment file names its own index removal',
  );
});

test('ignores a path whose basename does not start with .env', () => {
  const findings = rule.detect(
    context({ repo: repo({ tracked: new Set(['env.example', 'docs/env.md']) }) }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
});

test('skips outside git instead of guessing the tracked set', () => {
  const findings = rule.detect(context({ repo: repo({ inGit: false, branch: null, tracked: null }) }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'skip');
  assert.equal(findings[0].code, 'no-git');
  assert.match(findings[0].message, /^skipped: /);
  assert.equal(findings[0].probeUnavailable, true);
});

test('skips when no repository facts were collected', () => {
  const findings = rule.detect(context({ repo: null }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'skip');
  assert.equal(findings[0].code, 'no-repo');
  assert.equal(findings[0].probeUnavailable, true);
});
