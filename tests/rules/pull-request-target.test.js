import test from 'node:test';
import assert from 'node:assert/strict';

import rule from '../../src/rules/pull-request-target.js';

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
    severity: () => 'error',
  };
}

const SHA = 'a'.repeat(40);
/** A single-quoted string, because a template literal would read `${{` as an interpolation. */
const HEAD_EXPR = '${{ github.event.pull_request.head.sha }}';

/**
 * A workflow that checks the pull request head out, under the trigger the caller names.
 * @param {string} trigger
 * @param {string} ref
 */
function headCheckout(trigger, ref = '${{ github.event.pull_request.head.sha }}') {
  return `name: ci
on:
  ${trigger}:
    types: [opened]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA}
        with:
          ref: ${ref}
      - run: npm test
`;
}

function plainCheckout(trigger) {
  return `name: ci
on:
  ${trigger}:
    types: [opened]
jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA}
      - run: echo label
`;
}

function workflow(text) {
  return { path: '.github/workflows/ci.yml', text };
}

test('flags a pull_request_target workflow that checks the pull request head out', () => {
  const findings = rule.detect(context({ workflows: [workflow(headCheckout('pull_request_target'))] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'pull-request-target-checkout');
  assert.equal(findings[0].line, 9);
  assert.match(findings[0].message, /pull_request_target/);
  assert.match(findings[0].message, /head/);
});

test('flags the other spellings of the same checkout', () => {
  const byRef = rule.detect(
    context({ workflows: [workflow(headCheckout('pull_request_target', '${{ github.head_ref }}'))] }),
  );
  assert.equal(byRef[0].code, 'pull-request-target-checkout');

  const byCommand = `name: ci
on:
  pull_request_target:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA}
      - run: git checkout ${HEAD_EXPR}
`;
  const byRun = rule.detect(context({ workflows: [workflow(byCommand)] }));
  assert.equal(byRun[0].code, 'pull-request-target-checkout');
  assert.equal(byRun[0].line, 9);
});

test('does not flag the trigger alone, or a head checkout without it', () => {
  const alone = rule.detect(context({ workflows: [workflow(plainCheckout('pull_request_target'))] }));
  assert.equal(alone[0].status, 'pass');
  assert.equal(alone[0].code, 'pull-request-target-without-head-checkout');
  assert.match(alone[0].message, /pull_request_target/);

  const other = rule.detect(context({ workflows: [workflow(headCheckout('pull_request'))] }));
  assert.equal(other[0].status, 'pass');
  assert.equal(other[0].code, 'no-pull-request-target');
});

test('reads the trigger only from the top-level on key, never from a mention', () => {
  const mentioned = `name: ci
on:
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "we do not use pull_request_target here"
      - uses: actions/checkout@${SHA}
        with:
          ref: ${HEAD_EXPR}
`;
  const findings = rule.detect(context({ workflows: [workflow(mentioned)] }));
  assert.equal(findings[0].code, 'no-pull-request-target');
});

test('skips instead of passing when the fact it would read is absent', () => {
  assert.equal(rule.detect({ policy: {}, severity: () => 'error' })[0].code, 'no-repo');
  assert.equal(rule.detect(context({}))[0].code, 'no-ci');

  const unparseable = rule.detect(context({ workflows: [workflow('jobs: [oops\n')] }));
  assert.equal(unparseable[0].status, 'skip');
  assert.equal(unparseable[0].code, 'unparseable-workflow');
});

test('the catalog entry declares its identity, severity and page', () => {
  assert.equal(rule.id, 'pull-request-target');
  assert.equal(rule.scope.includes('repo'), true);
  assert.deepEqual(rule.severity, { baseline: 'error', strict: 'error' });
  assert.equal(rule.friction, 1);
  assert.equal(rule.docs, 'docs/rules/pull-request-target.md');
  assert.equal(typeof rule.detect, 'function');
});
