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
    botFiles: [],
    editorFiles: [],
    skippedGlobs: [],
    ...overrides,
  };
}

function context(workflows) {
  return {
    scope: 'repo',
    cwd: '/repo',
    root: '/repo',
    env: {},
    configPath: null,
    machine: null,
    repo: repo({ workflows }),
  };
}

function workflow(path, lines) {
  return { path, text: lines.join('\n') };
}

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
  assert.deepEqual(findings[0].remediation, {
    kind: 'manual',
    command: 'uses: owner/repo@<sha> # vX.Y.Z',
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
