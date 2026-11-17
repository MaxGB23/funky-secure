import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import rule from '../../src/rules/actions-pinned-sha.js';
import { run } from '../../src/cli.js';

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

/// The field loop (odd/tasks/field-loop-every-rule.md, T8): the four sides of `S3` and the three
/// obligations of `S4`, measured through the binary over a repository written at run time in the OS
/// temp directory (`S5`), so nothing here is a fixture family in the tree and no machine fact is read:
/// `--scope repo` excludes the machine, and this rule reads files only.

/** A committed identity, so a checkout of the test's own does not depend on the host's git config. */
const IDENTITY = ['-c', 'user.email=82458865+MaxGB23@users.noreply.github.com', '-c', 'user.name=MaxGB23'];

/** A commit SHA and a digest, real 40 and 64 hex: what the printed placeholder asks the reader for. */
const SHA = '11bd71901bbe5b1630ceea73d27597364c9af683';
const DIGEST = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** The moving references of the fail side: a tag, a branch, and three docker spellings with no digest. */
const MOVING = [
  'name: ci',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: actions/setup-node@main',
  '      - uses: docker://alpine:3.20',
  '      - uses: docker://registry:5000/app:1.2',
  '      - uses: docker://registry:5000/app',
  '      - run: echo hi',
].join('\n');

/** A workflow whose merge key the reader refuses, so the rule has no step to attribute. */
const UNPARSEABLE = [
  'name: broken',
  'on: push',
  'jobs:',
  '  build:',
  '    <<: *defaults',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
].join('\n');

/** The pass side: 40 hex, a digest on a registry with a port, and a local action. */
const PINNED = [
  'name: ci',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  `      - uses: actions/checkout@${SHA}`,
  `      - uses: docker://ghcr.io/owner/image@sha256:${DIGEST}`,
  '      - uses: ./.github/actions/local',
].join('\n');

/**
 * A real checkout: a git repository on a feature branch with one workflow file, committed.
 * @param {import('node:test').TestContext} t
 * @param {string} text the workflow file
 * @returns {string} the repository directory
 */
function checkout(t, text) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-t8-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'field-t8', version: '1.0.0', packageManager: 'pnpm@11.0.0' }, null, 2)}\n`,
  );
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), text);
  execFileSync('git', [...IDENTITY, 'init', '-q', '-b', 'feat/t8'], { cwd: dir, encoding: 'utf8' });
  execFileSync('git', [...IDENTITY, 'add', '-A'], { cwd: dir, encoding: 'utf8' });
  execFileSync('git', [...IDENTITY, 'commit', '-qm', 'the field loop'], { cwd: dir, encoding: 'utf8' });
  return dir;
}

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

/** One `scan` of the rule in isolation over a real checkout, with the probes the tool ships. */
async function scan(dir, argv = []) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(['scan', '--scope', 'repo', '--only', 'actions-pinned-sha', ...argv], {
    cwd: dir,
    env: process.env,
    stdout,
    stderr,
  });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/// Side one: it fails, with its own codes, at the path and the line the findings name.

test('side one: a tag, a branch and three docker spellings fail at the line each finding names', async (t) => {
  const dir = checkout(t, MOVING);

  const { code, stdout, stderr } = await scan(dir, ['--format', 'json']);
  assert.equal(stderr, '');
  assert.equal(code, 1, 'an error finding fails the default threshold');
  const report = JSON.parse(stdout);
  assert.deepEqual(report.summary, { error: 5, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  assert.deepEqual(
    report.findings.map((finding) => [finding.status, finding.code, finding.path, finding.line]),
    [
      ['fail', 'unpinned-action', '.github/workflows/ci.yml', 7],
      ['fail', 'unpinned-action', '.github/workflows/ci.yml', 8],
      ['fail', 'mutable-docker-tag', '.github/workflows/ci.yml', 9],
      ['fail', 'mutable-docker-tag', '.github/workflows/ci.yml', 10],
      ['fail', 'mutable-docker-tag', '.github/workflows/ci.yml', 11],
    ],
  );
  assert.deepEqual(
    report.findings.map((finding) => finding.evidence.form),
    ['tag', 'branch', 'docker-tag', 'docker-tag', 'docker-tag'],
  );
  // The line is the line: the file's own 7th line is the checkout reference it named.
  const written = readFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8').split('\n');
  for (const finding of report.findings) {
    assert.match(written[finding.line - 1], new RegExp(`uses: ${finding.evidence.uses.replaceAll('.', '\\.')}`));
  }
});

/// Side two: it passes, and the pass is counted rather than merely absent.

test('side two: 40 hex and a docker digest pass, and the pass is counted', async (t) => {
  const dir = checkout(t, PINNED);

  const { code, stdout } = await scan(dir, ['--format', 'json']);
  const report = JSON.parse(stdout);
  assert.equal(code, 0);
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings, [], 'a passing finding is counted and never listed');

  const human = await scan(dir);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /^summary {2}0 errors · 0 warnings · 0 info · 1 passing · 0 skipped$/m);
  assert.match(human.stdout, /all 1 rule pass/);
});

/// Side three: it skips for want of a fact, with the code and the fact in the message.

test('side three: an unparseable workflow and an excluded repository skip with their codes and facts', async (t) => {
  const broken = checkout(t, UNPARSEABLE);

  const refused = JSON.parse((await scan(broken, ['--format', 'json'])).stdout);
  assert.deepEqual(refused.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  const [skipped] = refused.findings;
  assert.equal(skipped.status, 'skip');
  assert.equal(skipped.code, 'unparseable-workflow');
  assert.equal(skipped.path, '.github/workflows/ci.yml');
  assert.match(
    skipped.message,
    /^skipped: unparseable workflow — merge key at line 5 is not supported$/,
    'the message names the fact the reader could not get, not the file alone',
  );
  assert.deepEqual(skipped.remediation, { kind: 'none' }, 'a skip hands nobody a command');

  const excluded = capture();
  const code = await run(['scan', '--scope', 'machine', '--only', 'actions-pinned-sha', '--format', 'json'], {
    cwd: broken,
    env: process.env,
    stdout: excluded,
    stderr: capture(),
  });
  const report = JSON.parse(excluded.text);
  assert.equal(code, 0, 'a skip is not a failure');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  assert.deepEqual(
    [report.findings[0].code, report.findings[0].message],
    ['no-repo', 'skipped: the repository was excluded by --scope machine'],
  );
});

/// Side four: off by policy — `starter` is the preset that turns it off, and it leaves no count.

test('side four: --preset starter is the off switch, and leaves neither a finding nor a count', async (t) => {
  const dir = checkout(t, MOVING);

  for (const preset of ['baseline', 'strict']) {
    const report = JSON.parse((await scan(dir, ['--preset', preset, '--format', 'json'])).stdout);
    assert.equal(report.summary.error, 5, `${preset}: the rule runs and its five findings survive`);
  }

  const off = await scan(dir, ['--preset', 'starter', '--format', 'json']);
  const report = JSON.parse(off.stdout);
  assert.equal(off.code, 0, 'a rule the policy turned off cannot fail the run');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings, [], 'off by policy leaves neither a finding nor a count');

  const human = await scan(dir, ['--preset', 'starter']);
  assert.match(human.stdout, /^summary {2}0 errors · 0 warnings · 0 info · 0 passing · 0 skipped$/m);
  assert.match(human.stdout, /off by policy:[\s\S]*Pinned actions/, 'the human report says who turned it off');
});

/// Obligation one of `S4`: the remediation is true — what it prints is the line the file needs, and
/// applying it clears the finding.

test('the printed remediation is the line the file needs, and applying it clears every finding', async (t) => {
  const dir = checkout(t, MOVING);
  const path = join(dir, '.github', 'workflows', 'ci.yml');

  const before = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.equal(before.summary.error, 5);

  const lines = readFileSync(path, 'utf8').split('\n');
  for (const finding of before.findings) {
    const { command } = finding.remediation;
    const placeholder = command.includes('<sha>') ? '<sha>' : '<64 hex>';
    assert.ok(
      command.includes(placeholder),
      `${command} prints no pinned form, so nobody can apply it`,
    );
    const applied = command.replace(placeholder, placeholder === '<sha>' ? SHA : DIGEST);
    const at = lines.findIndex((line) => line.trim() === `- uses: ${finding.evidence.uses}`);
    assert.notEqual(at, -1, `the file has no line for ${finding.evidence.uses}`);
    lines[at] = `      - ${applied}`;
  }
  writeFileSync(path, lines.join('\n'));

  const after = await scan(dir, ['--format', 'json']);
  const report = JSON.parse(after.stdout);
  assert.equal(after.code, 0, 'the applied remediation clears the finding that printed it');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings, []);
});

/// The `docker://` obligation: a reference is split where Docker splits it, so the printed pinned form
/// keeps the image, its registry and its port. Splitting on the last colon alone prints
/// `uses: docker@sha256:<64 hex> # //node` and `uses: docker://registry@sha256:<64 hex> # 5000/app`.

test('the printed docker remediation keeps the image, its registry and its port', () => {
  const findings = rule.detect(
    context([
      workflow('.github/workflows/docker.yml', [
        'name: docker',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: docker://node',
        '      - uses: docker://registry:5000/app',
        '      - uses: docker://registry:5000/app:1.2',
        `      - uses: docker://alpine@sha256:${'a'.repeat(63)}`,
        '      - uses: docker://alpine@md5:abc',
        `      - uses: docker://ghcr.io/owner/image@sha256:${DIGEST}`,
      ]),
    ]),
  );

  assert.equal(findings.length, 5, 'the full digest yields no finding at all');
  assert.deepEqual(
    findings.map((finding) => finding.remediation?.command),
    [
      'uses: docker://node@sha256:<64 hex>',
      'uses: docker://registry:5000/app@sha256:<64 hex>',
      'uses: docker://registry:5000/app@sha256:<64 hex> # 1.2',
      'uses: docker://alpine@sha256:<64 hex>',
      'uses: docker://alpine@sha256:<64 hex>',
    ],
    'a reference that already carries an @ is replaced, never appended to',
  );
  assert.match(findings[0].message, /names no tag, so it resolves to latest/, 'a reference naming no tag says so');
  assert.match(findings[3].message, /carries a sha256 digest of 63 hex characters, not 64/);
  assert.match(findings[4].message, /carries a md5 digest, and only sha256 is accepted/);
});

test('a reference that stops at the @ names no ref instead of claiming a branch', () => {
  const [finding] = rule.detect(
    context([
      workflow('.github/workflows/none.yml', [
        'name: none',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@',
      ]),
    ]),
  );

  assert.equal(finding.code, 'unpinned-action');
  assert.match(finding.message, /^actions\/checkout@ names no ref; pin the 40-character commit SHA/);
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'uses: actions/checkout@<sha>' });
});

/// Obligation two of `S4`: the two formats agree on status, path, count and message. No rule prints a
/// `code` in the human report (`src/lib/render-human.js`), so a code comparison would be a claim about
/// a field that is not printed.

test('human and --format json agree on the count, the path and the message of every finding', async (t) => {
  const dir = checkout(t, MOVING);

  const json = await scan(dir, ['--format', 'json']);
  const human = await scan(dir);
  const report = JSON.parse(json.stdout);

  assert.equal(human.code, json.code, 'the same flags decide the same verdict');
  const counts = /^summary {2}(\d+) errors? · (\d+) warnings? · (\d+) info · (\d+) passing · (\d+) skipped$/m.exec(human.stdout);
  assert.ok(counts !== null, `the human report printed no summary line:\n${human.stdout}`);
  assert.deepEqual(
    counts.slice(1).map(Number),
    [report.summary.error, report.summary.warn, report.summary.info, report.summary.pass, report.summary.skip],
  );

  const flattened = human.stdout.replace(/\s+/g, ' ');
  for (const finding of report.findings) {
    assert.ok(flattened.includes(`${finding.path}:${finding.line}`), `the path and line ${finding.path}:${finding.line} is not in the human report`);
    assert.ok(flattened.includes(finding.message.replace(/\s+/g, ' ')), 'the message is the one the human report carries');
    assert.ok(flattened.includes(finding.remediation.command.replace(/\s+/g, ' ')), 'the command is printed in both formats');
  }

  // A skip names no line and hands nobody a command, and the two formats still agree on its path, its
  // message and its count.
  const broken = checkout(t, UNPARSEABLE);
  const skipRun = await scan(broken, ['--format', 'json']);
  const skipReport = JSON.parse(skipRun.stdout);
  const skipHuman = await scan(broken);
  assert.equal(skipHuman.code, skipRun.code);
  const skipCounts = /^summary {2}\d+ errors? · \d+ warnings? · \d+ info · (\d+) passing · (\d+) skipped$/m.exec(skipHuman.stdout);
  assert.deepEqual(skipCounts.slice(1).map(Number), [skipReport.summary.pass, skipReport.summary.skip]);
  const [only] = skipReport.findings;
  const skipFlat = skipHuman.stdout.replace(/\s+/g, ' ');
  assert.ok(skipFlat.includes(only.path), 'the skip names its file in the human report');
  assert.ok(skipFlat.includes(only.message.replace(/\s+/g, ' ')), 'the skip message is the one the human report carries');
});
