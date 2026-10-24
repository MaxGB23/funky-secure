import test from 'node:test';
import assert from 'node:assert/strict';

import rule from '../../src/rules/ci-no-safety-overrides.js';

/** A complete repository fact set, as `src/lib/targets.js` resolves it. */
function repo(overrides = {}) {
  return {
    root: '/repo',
    inGit: true,
    branch: 'main',
    files: { packageJson: null, workspaceYaml: null, lockfile: null, npmrc: null, gitignore: null },
    present: [],
    tracked: new Set(),
    ignoreCandidates: [],
    ignored: new Set(),
    npmrc: { tracked: false, hasToken: false, tokenlessTracked: false },
    importers: [],
    workflows: [],
    botFiles: [],
    editorFiles: [],
    skippedGlobs: [],
    ...overrides,
  };
}

function context(facts) {
  return {
    scope: 'repo',
    cwd: '/repo',
    root: '/repo',
    env: {},
    configPath: null,
    machine: null,
    repo: repo(facts),
    policy: { preset: 'baseline', failOn: 'warn' },
    severity: () => 'warn',
  };
}

function workflow(text, path = '.github/workflows/ci.yml') {
  return { path, text };
}

function runStep(command, path) {
  return workflow(`name: ci\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${command}\n`, path);
}

test('flags a CI command that disables the frozen lockfile', () => {
  const findings = rule.detect(context({ workflows: [runStep('pnpm install --no-frozen-lockfile')] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'ci-frozen-lockfile-disabled');
  assert.equal(findings[0].line, 9);
  assert.match(findings[0].message, /--no-frozen-lockfile/);
});

test('flags a repository .npmrc that turns a safety default off', () => {
  const frozen = rule.detect(
    context({ files: { npmrc: { path: '.npmrc', text: 'frozen-lockfile=false\n' } } }),
  );
  assert.equal(frozen[0].code, 'ci-frozen-lockfile-disabled');
  assert.equal(frozen[0].path, '.npmrc');
  assert.equal(frozen[0].line, 1);

  const scripts = rule.detect(
    context({ files: { npmrc: { path: '.npmrc', text: 'strict-peer-dependencies=true\nignore-scripts=false\n' } } }),
  );
  assert.equal(scripts[0].code, 'ci-lifecycle-scripts-enabled');
  assert.equal(scripts[0].line, 2);
});

test('flags a command that re-enables lifecycle scripts', () => {
  for (const command of ['pnpm install --ignore-scripts=false', 'pnpm install --enable-pre-post-scripts']) {
    const findings = rule.detect(context({ workflows: [runStep(command)] }));
    assert.equal(findings[0].status, 'fail', command);
    assert.equal(findings[0].code, 'ci-lifecycle-scripts-enabled', command);
  }
});

test('does not flag the defaults, a comment or a quoted sentence', () => {
  const safe = [
    'pnpm install --frozen-lockfile',
    'pnpm install',
    'pnpm install --ignore-scripts',
    'echo hi # --no-frozen-lockfile',
  ];

  for (const command of safe) {
    const findings = rule.detect(context({ workflows: [runStep(command)] }));
    assert.equal(findings[0].status, 'pass', command);
    assert.equal(findings[0].code, 'ci-safety-defaults', command);
  }

  const npmrc = rule.detect(
    context({ files: { npmrc: { path: '.npmrc', text: '# frozen-lockfile=false\nauto-install-peers=true\n' } } }),
  );
  assert.equal(npmrc[0].status, 'pass');
});

test('skips instead of passing when the fact it would read is absent', () => {
  assert.equal(rule.detect({ policy: {}, severity: () => 'warn' })[0].code, 'no-repo');
  assert.equal(rule.detect(context({}))[0].code, 'no-ci', 'a repository with no CI has nothing to answer');

  const unparseable = rule.detect(context({ workflows: [workflow('jobs: [oops\n')] }));
  assert.equal(unparseable[0].status, 'skip');
  assert.equal(unparseable[0].code, 'unparseable-workflow');
});

test('the catalog entry declares its identity, severity and page', () => {
  assert.equal(rule.id, 'ci-no-safety-overrides');
  assert.equal(rule.scope.includes('repo'), true);
  assert.deepEqual(rule.severity, { baseline: 'warn', strict: 'error' });
  assert.equal(rule.docs, 'docs/rules/ci-no-safety-overrides.md');
  assert.equal(typeof rule.detect, 'function');
});
