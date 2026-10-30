import test from 'node:test';
import assert from 'node:assert/strict';

import rule from '../../src/rules/actions-pinned-sha.js';

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
    actionFiles: [],
    botFiles: [],
    editorFiles: [],
    skippedGlobs: [],
    ...overrides,
  };
}

function context(workflows, actionFiles = []) {
  return {
    scope: 'repo',
    cwd: '/repo',
    root: '/repo',
    env: {},
    configPath: null,
    machine: null,
    repo: repo({ workflows, actionFiles }),
  };
}

function workflow(path, lines) {
  return { path, text: lines.join('\n') };
}

/**
 * `.github/actions/setup/action.yml` from `t3-oss/create-t3-app` (read-only clone), byte for byte: the
 * one real composite action the field round found invisible, consumed by four of its workflows.
 */
const T3_SETUP_ACTION = [
  'name: "Setup and install"',
  'description: "Common setup steps for Actions"',
  '',
  'runs:',
  '  using: composite',
  '  steps:',
  '    - uses: pnpm/action-setup@v3',
  '    - uses: actions/setup-node@v4',
  '      with:',
  '        node-version: 20',
  '        cache: "pnpm"',
  '',
  '    - shell: bash',
  '      run: pnpm install',
].join('\n');

test('reads the unpinned steps of a real composite action, with the workflow message and remediation', () => {
  const findings = rule.detect(
    context([], [{ path: '.github/actions/setup/action.yml', text: T3_SETUP_ACTION }]),
  );

  assert.deepEqual(
    findings.map((finding) => [finding.status, finding.code, finding.path, finding.line]),
    [
      ['fail', 'unpinned-action', '.github/actions/setup/action.yml', 7],
      ['fail', 'unpinned-action', '.github/actions/setup/action.yml', 8],
    ],
  );
  assert.deepEqual(
    findings.map((finding) => finding.message),
    [
      'pnpm/action-setup@v3 is a tag; pin the 40-character commit SHA so the workflow cannot change under you — resolve it with git ls-remote against the action\'s host and keep the tag as the comment, because this tool does not use the network',
      'actions/setup-node@v4 is a tag; pin the 40-character commit SHA so the workflow cannot change under you — resolve it with git ls-remote against the action\'s host and keep the tag as the comment, because this tool does not use the network',
    ],
  );
  assert.deepEqual(
    findings.map((finding) => finding.remediation),
    [
      { kind: 'manual', command: 'uses: pnpm/action-setup@<sha> # v3' },
      { kind: 'manual', command: 'uses: actions/setup-node@<sha> # v4' },
    ],
  );
  assert.deepEqual(
    findings.map((finding) => finding.evidence),
    [
      { uses: 'pnpm/action-setup@v3', form: 'tag' },
      { uses: 'actions/setup-node@v4', form: 'tag' },
    ],
  );
});

test('reports a composite action step exactly as it reports the same step in a workflow', () => {
  const sameStep = '      - uses: pnpm/action-setup@v3';
  const fromWorkflow = rule.detect(
    context([
      workflow('.github/workflows/ci.yml', [
        'name: ci',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        sameStep,
      ]),
    ]),
  );
  const fromAction = rule.detect(
    context([], [
      workflow('.github/actions/setup/action.yml', [
        'name: setup',
        'runs:',
        '  using: composite',
        '  steps:',
        sameStep,
      ]),
    ]),
  );

  assert.equal(fromWorkflow.length, 1);
  assert.equal(fromAction.length, 1);
  assert.equal(fromAction[0].message, fromWorkflow[0].message);
  assert.deepEqual(fromAction[0].remediation, fromWorkflow[0].remediation);
  assert.deepEqual(fromAction[0].evidence, fromWorkflow[0].evidence);
  assert.equal(fromAction[0].code, fromWorkflow[0].code);
  assert.deepEqual([fromAction[0].path, fromAction[0].line], ['.github/actions/setup/action.yml', 5]);
});

test('passes a composite action whose steps are pinned, local or a digest', () => {
  const findings = rule.detect(
    context([], [
      workflow('.github/actions/setup/action.yml', [
        'name: setup',
        'runs:',
        '  using: composite',
        '  steps:',
        '    - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
        '    - uses: ./.github/actions/local',
        '    - uses: docker://ghcr.io/owner/image@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ]),
    ]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'pinned-actions');
});

test('reads no step out of a javascript action, which has none to attribute', () => {
  const findings = rule.detect(
    context([], [
      workflow('.github/actions/js/action.yml', [
        'name: js',
        'runs:',
        '  using: node20',
        '  main: index.js',
        '  post: cleanup.js',
      ]),
    ]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
});

test('reads a composite action whose runs: key carries a trailing comment', () => {
  const findings = rule.detect(
    context([], [
      workflow('.github/actions/setup/action.yml', [
        'name: setup',
        'runs: # the only block GitHub reads',
        '  using: composite',
        '  steps:',
        '    - uses: actions/checkout@v4',
      ]),
    ]),
  );

  assert.deepEqual(
    findings.map((finding) => [finding.status, finding.path, finding.line]),
    [['fail', '.github/actions/setup/action.yml', 5]],
  );
});

test('skips an action file that declares no runs: block instead of reporting it clean', () => {
  const findings = rule.detect(
    context([], [workflow('.github/actions/odd/action.yml', ['name: odd', 'inputs:', '  token:', '    required: true'])]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'skip');
  assert.equal(findings[0].code, 'not-an-action');
  assert.equal(findings[0].path, '.github/actions/odd/action.yml');
  assert.equal(
    findings[0].message,
    'skipped: .github/actions/odd/action.yml declares no top-level runs: block, so it is not a composite action and no step can be attributed',
  );
  assert.equal(findings[0].probeUnavailable, undefined, 'a file that was read and refused is not an unavailable probe');
});

test('skips a composite action the reader cannot attribute', () => {
  const findings = rule.detect(
    context([], [
      workflow('.github/actions/broken/action.yml', [
        'name: broken',
        'runs:',
        '  using: composite',
        '  steps:',
        '    - name: merged',
        '      <<: *defaults',
        '      uses: actions/checkout@v4',
      ]),
    ]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'skip');
  assert.equal(findings[0].code, 'unparseable-action');
  assert.match(findings[0].message, /^skipped: unparseable composite action — /);
  assert.match(findings[0].message, /merge key at line 6/);
});

test('passes a step pinned to a full 40-character commit SHA in either hex case', () => {
  const findings = rule.detect(
    context([
      workflow('.github/workflows/ci.yml', [
        'name: ci',
        'on: pull_request',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
        '      - uses: actions/setup-node@49933EA5288CAECA8642D1E84AFBD3F7D6820020',
      ]),
    ]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'pinned-actions');
});

test('fails a tag, a branch and a short SHA, each with its offending form', () => {
  const findings = rule.detect(
    context([
      workflow('.github/workflows/ci.yml', [
        'name: ci',
        'on: pull_request',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: pnpm/action-setup@main',
        '      - uses: actions/cache@abc1234',
      ]),
    ]),
  );

  assert.equal(findings.length, 3);
  assert.deepEqual(
    findings.map((finding) => finding.status),
    ['fail', 'fail', 'fail'],
  );
  assert.deepEqual(
    findings.map((finding) => finding.code),
    ['unpinned-action', 'unpinned-action', 'unpinned-action'],
  );
  assert.deepEqual(
    findings.map((finding) => finding.evidence.form),
    ['tag', 'branch', 'short-sha'],
  );
  assert.deepEqual(
    findings.map((finding) => finding.evidence.uses),
    ['actions/checkout@v4', 'pnpm/action-setup@main', 'actions/cache@abc1234'],
  );
  assert.deepEqual(
    findings.map((finding) => finding.line),
    [7, 8, 9],
  );
  assert.equal(findings[0].path, '.github/workflows/ci.yml');
  // Remediation conformance sweep: the template named "owner/repo" while the finding already knew
  // which action and which ref it was talking about. A placeholder that discards the two facts in hand
  // makes the reader copy them by hand, and <sha> alone does not say what to put before the @.
  assert.deepEqual(findings[0].remediation, {
    kind: 'manual',
    command: 'uses: actions/checkout@<sha> # v4',
  });
  assert.deepEqual(findings[1].remediation, {
    kind: 'manual',
    command: 'uses: pnpm/action-setup@<sha> # main',
  });
});

test('never treats a with: key, a block scalar or a folded value as a step', () => {
  const findings = rule.detect(
    context([
      workflow('.github/workflows/decoys.yml', [
        'name: decoys',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: pinned',
        '        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
        '        with:',
        '          uses: not-an-action/ref@v9',
        '      - name: block scalar',
        '        run: |',
        '          echo "uses: heredoc/decoy@deadbeef"',
        '          uses: another/decoy@v1',
        '      - name: folded',
        '        run: >-',
        '          echo folded',
        '          uses: wrapped/decoy@v2',
      ]),
    ]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(
    findings.some((finding) => finding.code === 'unpinned-action' || finding.code === 'mutable-docker-tag'),
    false,
  );
});

test('fails a mutable docker tag', () => {
  const findings = rule.detect(
    context([
      workflow('.github/workflows/docker.yml', [
        'name: docker',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: docker://alpine:3.20',
      ]),
    ]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'mutable-docker-tag');
  assert.deepEqual(findings[0].evidence, { uses: 'docker://alpine:3.20', form: 'docker-tag' });
  assert.equal(findings[0].line, 7);
  // The image keeps its scheme and its tag: a template that loses either cannot be pasted anywhere.
  assert.deepEqual(findings[0].remediation, {
    kind: 'manual',
    command: 'uses: docker://alpine@sha256:<64 hex> # 3.20',
  });
});

test('passes a docker digest and a local action', () => {
  const findings = rule.detect(
    context([
      workflow('.github/workflows/docker.yml', [
        'name: docker',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: docker://ghcr.io/owner/image@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        '      - uses: ./.github/actions/local',
      ]),
    ]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
});

test('passes when the repository has no workflow at all', () => {
  const findings = rule.detect(context([]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
});

test('skips an unparseable workflow instead of scanning its lines', () => {
  const findings = rule.detect(
    context([
      workflow('.github/workflows/broken.yml', [
        'name: broken',
        'on: push',
        'jobs:',
        '  build:',
        '    <<: *defaults',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
      ]),
    ]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'skip');
  assert.equal(findings[0].code, 'unparseable-workflow');
  assert.equal(findings[0].path, '.github/workflows/broken.yml');
  assert.match(findings[0].message, /^skipped: /);
});

test('skips when no repository facts were collected', () => {
  const findings = rule.detect({
    scope: 'repo',
    cwd: '/repo',
    root: null,
    env: {},
    configPath: null,
    machine: null,
    repo: null,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'skip');
  assert.equal(findings[0].code, 'no-repo');
});
