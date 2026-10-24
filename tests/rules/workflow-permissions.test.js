import test from 'node:test';
import assert from 'node:assert/strict';

import rule from '../../src/rules/workflow-permissions.js';

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

const READ_ONLY = `name: ci
on:
  pull_request:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;

const NO_BLOCK = `name: ci
on:
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;

test('flags a workflow that declares no permissions block', () => {
  const findings = rule.detect(context({ workflows: [workflow(NO_BLOCK)] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'workflow-permissions-missing');
  assert.equal(findings[0].path, '.github/workflows/ci.yml');
  assert.equal(findings[0].line, 1);
});

test('flags write-all at the workflow level', () => {
  const writeAll = `name: ci
on:
  push:
permissions: write-all
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;
  const findings = rule.detect(context({ workflows: [workflow(writeAll)] }));

  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'workflow-permissions-write-all');
  assert.equal(findings[0].line, 4);
  assert.equal(findings[0].evidence.level, 'workflow');
});

test('flags write-all in a job, and accepts a job narrowing the workflow grant', () => {
  const wide = `name: ci
on:
  push:
permissions:
  contents: read
jobs:
  release:
    permissions: write-all
    runs-on: ubuntu-latest
    steps:
      - run: npm publish
`;
  const findings = rule.detect(context({ workflows: [workflow(wide)] }));
  assert.equal(findings[0].code, 'workflow-permissions-write-all');
  assert.equal(findings[0].evidence.level, 'job');
  assert.equal(findings[0].evidence.job, 'release');
  assert.equal(findings[0].line, 8);

  const narrow = `name: ci
on:
  push:
permissions: write-all
jobs:
  release:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - run: npm publish
`;
  const narrowed = rule.detect(context({ workflows: [workflow(narrow)] }));
  assert.equal(narrowed.length, 1, 'only the workflow-level grant is reported');
  assert.equal(narrowed[0].evidence.level, 'workflow');
});

test('does not flag a least-privilege declaration, an empty one or read-all', () => {
  for (const block of ['permissions:\n  contents: read', 'permissions: {}', 'permissions: read-all']) {
    const text = `name: ci\non:\n  push:\n${block}\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n`;
    const findings = rule.detect(context({ workflows: [workflow(text)] }));
    assert.equal(findings[0].status, 'pass', block);
    assert.equal(findings[0].code, 'least-privilege-permissions', block);
  }
});

test('a workflow that declares permissions only per job is never reported as missing', () => {
  const perJob = `name: ci
on:
  push:
jobs:
  build:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;
  const findings = rule.detect(context({ workflows: [workflow(perJob)] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'least-privilege-permissions');
});

test('reports only the jobs that inherit the default when the others declare their own', () => {
  const partial = `name: ci
on:
  push:
jobs:
  build:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: npm publish
`;
  const findings = rule.detect(context({ workflows: [workflow(partial)] }));

  assert.equal(findings[0].code, 'workflow-permissions-missing');
  assert.deepEqual(findings[0].evidence.jobs, ['publish']);
  assert.ok(
    findings[0].message.includes('1 of its 2 jobs (publish)'),
    `the message must name the uncovered job: ${findings[0].message}`,
  );
});

test('skips instead of passing when the fact it would read is absent', () => {
  assert.equal(rule.detect({ policy: {}, severity: () => 'warn' })[0].code, 'no-repo');
  assert.equal(rule.detect(context({}))[0].code, 'no-ci');

  const unparseable = rule.detect(context({ workflows: [workflow('jobs: [oops\n')] }));
  assert.equal(unparseable[0].status, 'skip');
  assert.equal(unparseable[0].code, 'unparseable-workflow');
});

test('the catalog entry declares its identity, severity and page', () => {
  assert.equal(rule.id, 'workflow-permissions');
  assert.equal(rule.scope.includes('repo'), true);
  assert.deepEqual(rule.severity, { baseline: 'warn', strict: 'error' });
  assert.equal(rule.friction, 1);
  assert.equal(rule.docs, 'docs/rules/workflow-permissions.md');
  assert.equal(typeof rule.detect, 'function');
});
