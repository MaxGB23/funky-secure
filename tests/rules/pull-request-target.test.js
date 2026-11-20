import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../../src/cli.js';
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

/** A pull request number as an expression, written from a string so no template literal reads it. */
const NUMBER_EXPR = '${{ github.event.pull_request.number }}';

/**
 * The workflow `headCheckout` writes, with its `with:` map written in flow style instead: the same
 * mapping on the key's own line, which YAML defines and GitHub accepts (#405).
 * @param {string} trigger
 * @param {string} mapping the map's source, braces included
 */
function flowCheckout(trigger, mapping) {
  return `name: ci
on:
  ${trigger}:
    types: [opened]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA}
        with: ${mapping}
`;
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

test('flags a head reached by pull request number, not only by an expression', () => {
  const NUMBER = '${{ github.event.pull_request.number }}';
  const runWorkflow = (command) => `name: ci
on:
  pull_request_target:
    types: [opened]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: ${command}
`;
  const shapes = [
    ['a checkout of refs/pull/<number>/head', headCheckout('pull_request_target', `refs/pull/${NUMBER}/head`)],
    ['a checkout of refs/pull/<number>/merge', headCheckout('pull_request_target', `refs/pull/${NUMBER}/merge`)],
    ['gh pr checkout <number>', runWorkflow(`gh pr checkout ${NUMBER}`)],
    [
      'a pull/<number>/head fetch and a FETCH_HEAD checkout',
      runWorkflow(`git fetch origin pull/${NUMBER}/head && git checkout FETCH_HEAD`),
    ],
  ];

  for (const [shape, text] of shapes) {
    const findings = rule.detect(context({ workflows: [workflow(text)] }));
    assert.equal(findings.length, 1, `${shape}: ${JSON.stringify(findings)}`);
    assert.equal(findings[0].status, 'fail', shape);
    assert.equal(findings[0].code, 'pull-request-target-checkout', shape);
    assert.equal(findings[0].line, 9, shape);
  }
});

test('reads a pull request number as a literal reference, resolved by nothing', () => {
  const byRef = rule.detect(
    context({ workflows: [workflow(headCheckout('pull_request_target', 'refs/pull/7/head'))] }),
  );
  assert.equal(byRef[0].code, 'pull-request-target-checkout');
  assert.deepEqual(byRef[0].evidence, {
    job: 'build',
    step: 0,
    kind: 'uses',
    expression: 'refs/pull/7/head',
  });

  const byMerge = rule.detect(
    context({ workflows: [workflow(headCheckout('pull_request_target', 'refs/pull/7/merge'))] }),
  );
  assert.equal(byMerge[0].code, 'pull-request-target-checkout');
});

test('joins a pull head fetch and a FETCH_HEAD checkout written on two lines', () => {
  const text = [
    'name: ci',
    'on:',
    '  pull_request_target:',
    '    types: [opened]',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: |',
    '          git fetch origin pull/${{ github.event.pull_request.number }}/head',
    '          git checkout FETCH_HEAD',
  ].join('\n');

  const findings = rule.detect(context({ workflows: [workflow(text)] }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'pull-request-target-checkout');
  assert.equal(findings[0].line, 9);
});

test('does not flag a pull head fetched but a different ref checked out', () => {
  const text = [
    'name: ci',
    'on:',
    '  pull_request_target:',
    '    types: [opened]',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: git fetch origin pull/7/head && git checkout main',
  ].join('\n');

  const findings = rule.detect(context({ workflows: [workflow(text)] }));
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'pull-request-target-without-head-checkout');
});

test('reads a head named in a flow-style with map, at the step line', () => {
  const byNumber = `refs/pull/${NUMBER_EXPR}/head`;
  const shapes = [
    ['a reference a pull request number addresses', `{ ref: ${byNumber} }`, byNumber],
    ['an expression', `{ ref: ${HEAD_EXPR} }`, HEAD_EXPR],
    ['the same map with another key beside it', `{ fetch-depth: 0, ref: ${byNumber} }`, byNumber],
  ];

  for (const [shape, mapping, expression] of shapes) {
    const findings = rule.detect(
      context({ workflows: [workflow(flowCheckout('pull_request_target', mapping))] }),
    );
    assert.equal(findings.length, 1, `${shape}: ${JSON.stringify(findings)}`);
    assert.equal(findings[0].status, 'fail', shape);
    assert.equal(findings[0].code, 'pull-request-target-checkout', shape);
    assert.equal(findings[0].line, 9, shape);
    assert.deepEqual(findings[0].evidence, { job: 'build', step: 0, kind: 'uses', expression }, shape);
  }
});

test('answers a flow-style with map with the bytes of the block spelling', () => {
  const ref = `refs/pull/${NUMBER_EXPR}/head`;
  const blocked = rule.detect(
    context({ workflows: [workflow(headCheckout('pull_request_target', ref))] }),
  );
  const flowed = rule.detect(
    context({ workflows: [workflow(flowCheckout('pull_request_target', `{ ref: ${ref} }`))] }),
  );

  assert.deepEqual(flowed, blocked);
});

test('a flow-style with map that names no head is still a pass', () => {
  for (const mapping of ['{ ref: refs/heads/main }', '{}']) {
    const findings = rule.detect(
      context({ workflows: [workflow(flowCheckout('pull_request_target', mapping))] }),
    );
    assert.equal(findings.length, 1, mapping);
    assert.equal(findings[0].status, 'pass', mapping);
    assert.equal(findings[0].code, 'pull-request-target-without-head-checkout', mapping);
  }
});

test('a flow-style with map it cannot attribute skips the file instead of guessing', () => {
  for (const mapping of ['{ ref:', '{ ref: refs/pull/7/head']) {
    const findings = rule.detect(
      context({ workflows: [workflow(flowCheckout('pull_request_target', mapping))] }),
    );
    assert.equal(findings.length, 1, mapping);
    assert.equal(findings[0].status, 'skip', mapping);
    assert.equal(findings[0].code, 'unparseable-workflow', mapping);
    assert.match(findings[0].message, /line 10/, mapping);
  }
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

test('flags an action that is not actions/checkout when a with: value names the head', () => {
  // The danger is the ref that reaches the working tree, not the name of the action that put it
  // there: a local composite action and a third-party checkout read the head exactly as the first
  // party one does (issue 518).
  const local = `name: ci
on:
  pull_request_target:
    types: [opened]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/checkout-head
        with:
          ref: ${HEAD_EXPR}
`;
  const findings = rule.detect(context({ workflows: [workflow(local)] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'pull-request-target-checkout');
  assert.equal(findings[0].evidence.kind, 'uses');
  assert.equal(findings[0].line, 9);
});

test('flags the commands a checkout uses when they are not git checkout', () => {
  // `git switch`, `git worktree add` and a hard reset onto the ref read the head as much as
  // `git checkout` does; leaving them out turned a real finding into a pass (issue 518).
  const bodies = [
    `git switch --detach ${HEAD_EXPR}`,
    `git worktree add /tmp/head ${HEAD_EXPR}`,
    `git reset --hard ${HEAD_EXPR}`,
    `git restore --source=${HEAD_EXPR} .`,
  ];

  for (const body of bodies) {
    const text = `name: ci
on:
  pull_request_target:
    types: [opened]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: ${body}
`;
    const findings = rule.detect(context({ workflows: [workflow(text)] }));
    assert.equal(findings[0].status, 'fail', `${body} checks the head out`);
    assert.equal(findings[0].code, 'pull-request-target-checkout');
    assert.equal(findings[0].evidence.kind, 'run');
  }
});

test('does not flag a command that names the head and checks nothing out', () => {
  // The negative control for the widening: reporting the commit under review is not reading it.
  const text = `name: ci
on:
  pull_request_target:
    types: [opened]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "reviewing ${HEAD_EXPR}"
`;
  const findings = rule.detect(context({ workflows: [workflow(text)] }));

  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'pull-request-target-without-head-checkout');
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

/// The four sides of `S3` and the three obligations of `S4`, driven through the binary over
/// repositories built at runtime (`S5`). No fixture family is committed: every path is a
/// `mkdtempSync` directory, and the child environment is scrubbed of `CI` and every `npm_config_*`.
/// This rule reads workflow files only, so no pnpm probe answers any side and no side depends on the
/// machine.

function capture() {
  return { text: '', isTTY: false, write(chunk) { this.text += chunk; return true; } };
}

/** One command of the binary, with the runner's environment taken out. */
async function cli(dir, argv) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name !== 'CI' && !/^npm_config_/i.test(name)) env[name] = value;
  }
  const stdout = capture();
  const stderr = capture();
  const code = await run(argv, { cwd: dir, env, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/** One `scan` of this rule at repository scope, so no machine fact reaches the counts. */
function scan(dir, argv = []) {
  return cli(dir, ['scan', '--scope', 'repo', '--only', 'pull-request-target', ...argv]);
}

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-pr-target-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeWorkflow(dir, lines, name = 'ci.yml') {
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dir, '.github', 'workflows', name), `${lines.join('\n')}\n`);
}

/** The combination this rule exists for: the trigger, and the head checked out at line 9. */
const FAILING = [
  'name: ci', // 1
  'on:', // 2
  '  pull_request_target:', // 3
  '    types: [opened]', // 4
  'jobs:', // 5
  '  build:', // 6
  '    runs-on: ubuntu-latest', // 7
  '    steps:', // 8
  `      - uses: actions/checkout@${SHA}`, // 9
  '        with:', // 10
  '          ref: ${{ github.event.pull_request.head.sha }}', // 11
  '      - run: npm test', // 12
];

/** The trigger with no head checkout: the safe shape the rule must not fail. */
const SAFE = [
  'name: ci', 'on:', '  pull_request_target:', '    types: [opened]', 'jobs:',
  '  label:', '    runs-on: ubuntu-latest', '    steps:',
  `      - uses: actions/checkout@${SHA}`,
  '      - run: echo label',
];

/** A head checkout where the head is the checked-out commit by definition. */
const HEAD_UNDER_PULL_REQUEST = [
  'name: ci', 'on:', '  pull_request:', 'jobs:', '  build:', '    runs-on: ubuntu-latest',
  '    steps:', `      - uses: actions/checkout@${SHA}`, '        with:',
  '          ref: ${{ github.event.pull_request.head.sha }}',
];

function failingRepo(t) {
  const dir = scratch(t);
  writeWorkflow(dir, FAILING);
  return dir;
}

/** `[status, code, target, path, line]`, ordered so the report's own order is not a fact. */
function projection(report) {
  return report.findings
    .map((finding) => [finding.status, finding.code, finding.target, finding.path, finding.line])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

/** The counts and the verdict the human report prints, read back from its own lines. */
function humanSummary(text) {
  const counts = /^summary {2}(\d+) errors? · (\d+) warnings? · (\d+) info · (\d+) passing · (\d+) skipped$/m.exec(text);
  assert.ok(counts !== null, `the human report printed no summary line:\n${text}`);
  const verdict = /^verdict {2}(PASS|FAIL) \(threshold: (\w+)/m.exec(text);
  assert.ok(verdict !== null, `the human report printed no verdict line:\n${text}`);
  const [error, warn, info, pass, skip] = counts.slice(1).map(Number);
  return { error, warn, info, pass, skip, verdict: verdict[1].toLowerCase() };
}

/// Side one: it fails, with its own code, at the line the finding names.

test('side one: the head checkout fails at the step line, and the scan is read-only', async (t) => {
  const dir = failingRepo(t);
  const workflowPath = join(dir, '.github', 'workflows', 'ci.yml');
  const before = readFileSync(workflowPath, 'utf8');

  const json = await scan(dir, ['--format', 'json']);
  assert.equal(json.stderr, '');
  assert.equal(json.code, 1, 'an error finding is a failing run at the default threshold');
  const report = JSON.parse(json.stdout);

  assert.deepEqual(report.summary, { error: 1, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  assert.deepEqual(projection(report), [
    ['fail', 'pull-request-target-checkout', 'ci', '.github/workflows/ci.yml', 9],
  ]);
  const [finding] = report.findings;
  assert.equal(
    finding.message,
    'job "build" checks out the pull request head under pull_request_target; the workflow runs in ' +
      "the base repository's context, so fork code runs with its secrets",
  );
  assert.deepEqual(finding.evidence, {
    job: 'build',
    step: 0,
    kind: 'uses',
    expression: '${{ github.event.pull_request.head.sha }}',
  });
  assert.equal(finding.severity, 'error');

  const human = await scan(dir);
  assert.equal(human.code, 1);
  assert.match(human.stdout, /^ {2}✖ {2}pull_request_target {2}· {2}\.github\/workflows\/ci\.yml:9$/m);
  assert.match(human.stdout.replace(/\s+/g, ' '), /the workflow runs in the base repository's context/);

  assert.equal(readFileSync(workflowPath, 'utf8'), before, 'a scan never edits a workflow');
});

/// The count the page states: one finding per offending step, not one per workflow.

test('side one: each offending step is one fail at its own line, under a declared trigger alone', async (t) => {
  const dir = scratch(t);
  writeWorkflow(dir, [
    'name: ci', 'on:', '  pull_request_target:', 'jobs:', '  build:', // 3: the trigger alone
    '    runs-on: ubuntu-latest', '    steps:',
    `      - uses: actions/checkout@${SHA}`, // 8: the first offending step
    '        with:',
    '          ref: ${{ github.event.pull_request.head.sha }}',
    '      - run: git checkout ${{ github.head_ref }}', // 11: the second, as a command
  ]);

  const report = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual(report.summary, { error: 2, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  assert.deepEqual(
    report.findings.map((finding) => [finding.line, finding.evidence.step, finding.evidence.kind]),
    [[8, 0, 'uses'], [11, 1, 'run']],
  );
});

/// Side one, widened: the head is reached by a pull request number, not only by an expression.

test('side one: a head reached by pull request number fails at the step line', async (t) => {
  const NUMBER = '${{ github.event.pull_request.number }}';
  const preamble = [
    'name: ci',
    'on:',
    '  pull_request_target:',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
  ];
  const shapes = [
    [
      'refs/pull/<number>/head',
      [...preamble, `      - uses: actions/checkout@${SHA}`, '        with:', `          ref: refs/pull/${NUMBER}/head`],
    ],
    [
      'refs/pull/<number>/merge',
      [...preamble, `      - uses: actions/checkout@${SHA}`, '        with:', `          ref: refs/pull/${NUMBER}/merge`],
    ],
    ['gh pr checkout <number>', [...preamble, `      - run: gh pr checkout ${NUMBER}`]],
    [
      'a pull/<number>/head fetch and a FETCH_HEAD checkout',
      [...preamble, `      - run: git fetch origin pull/${NUMBER}/head && git checkout FETCH_HEAD`],
    ],
  ];

  for (const [shape, lines] of shapes) {
    const dir = scratch(t);
    writeWorkflow(dir, lines);
    const json = await scan(dir, ['--format', 'json']);
    assert.equal(json.stderr, '', shape);
    assert.equal(json.code, 1, shape);
    const report = JSON.parse(json.stdout);
    assert.deepEqual(
      report.summary,
      { error: 1, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' },
      shape,
    );
    assert.deepEqual(
      projection(report),
      [['fail', 'pull-request-target-checkout', 'ci', '.github/workflows/ci.yml', 8]],
      shape,
    );
    assert.equal(report.findings[0].remediation.kind, 'manual', shape);
  }
});

/// Side two: it passes, and the pass is counted rather than merely absent.

test('side two: the safe shapes are one counted pass for the whole repository', async (t) => {
  const triggerOnly = scratch(t);
  writeWorkflow(triggerOnly, SAFE, 'a.yml');
  writeWorkflow(triggerOnly, SAFE, 'b.yml');

  const json = await scan(triggerOnly, ['--format', 'json']);
  assert.equal(json.code, 0);
  const report = JSON.parse(json.stdout);
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  // The report never prints a pass row (`render-json.js` filters `status !== 'pass'`), so the count is
  // the whole of what a reader sees: two workflows that declare the trigger are one pass, not two.
  assert.deepEqual(report.findings, []);

  const human = await scan(triggerOnly);
  assert.deepEqual(humanSummary(human.stdout), report.summary, 'the pass is counted in both formats');
  assert.match(human.stdout, /^ {5}all 1 rule pass$/m);
  assert.equal(human.stdout.includes('✖'), false);
  for (const code of ['pull-request-target-without-head-checkout', 'no-pull-request-target']) {
    assert.equal(
      human.stdout.includes(code),
      false,
      'the page says neither format prints a pass code, so the reader sees the count and never which half',
    );
  }

  const headOnly = scratch(t);
  writeWorkflow(headOnly, HEAD_UNDER_PULL_REQUEST);
  assert.deepEqual(
    JSON.parse((await scan(headOnly, ['--format', 'json'])).stdout).summary,
    { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
    'a head checkout under pull_request is the safe shape, not a finding',
  );
});

/// Side three: it skips for want of a fact, with the code and the fact named, and no skip is a pass.

test('side three: no-ci, unparseable-workflow and no-repo name their fact, and none is a pass', async (t) => {
  const absent = scratch(t);
  const empty = scratch(t);
  mkdirSync(join(empty, '.github', 'workflows'), { recursive: true });

  for (const [shape, dir] of [['no workflows directory', absent], ['an empty workflows directory', empty]]) {
    const json = await scan(dir, ['--format', 'json']);
    assert.equal(json.code, 0, `${shape}: a skip is not a failure`);
    const report = JSON.parse(json.stdout);
    assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' }, shape);
    assert.equal(report.findings.length, 1, shape);
    assert.equal(report.findings[0].status, 'skip', shape);
    assert.equal(report.findings[0].code, 'no-ci', shape);
    // Issue #390: the fact measured is that no workflow file exists, which is the same fact whether
    // the directory is absent or present and empty. A sentence naming the directory is false in the
    // second shape, so it names the file.
    assert.equal(
      report.findings[0].message,
      'skipped: there is no workflow file, so no workflow can declare a trigger',
      `${shape}: the skip names the workflow file it did not find`,
    );
    assert.equal(report.findings[0].message.includes('directory'), false, `${shape}: it names no directory`);
  }

  const broken = scratch(t);
  writeWorkflow(broken, ['jobs: [oops'], 'bad.yml');
  const brokenJson = await scan(broken, ['--format', 'json']);
  assert.equal(brokenJson.code, 0);
  const brokenReport = JSON.parse(brokenJson.stdout);
  assert.deepEqual(brokenReport.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  assert.deepEqual(projection(brokenReport), [['skip', 'unparseable-workflow', 'ci', '.github/workflows/bad.yml', undefined]]);
  assert.match(brokenReport.findings[0].message, /^skipped: unparseable workflow — /);

  const mixed = scratch(t);
  writeWorkflow(mixed, ['jobs: [oops'], 'bad.yml');
  writeWorkflow(mixed, SAFE, 'good.yml');
  assert.deepEqual(
    JSON.parse((await scan(mixed, ['--format', 'json'])).stdout).summary,
    { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' },
    'the rule never adds a pass on top of a file it could not read',
  );

  const noRepo = JSON.parse(
    (await cli(absent, ['scan', '--scope', 'machine', '--only', 'pull-request-target', '--format', 'json'])).stdout,
  );
  assert.equal(noRepo.findings[0].code, 'no-repo');
  assert.equal(noRepo.findings[0].message, 'skipped: the repository was excluded by --scope machine');
  assert.deepEqual(noRepo.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
});

/// Side four: off by policy — the preset and the veto leave neither a finding nor a count.

test('side four: starter turns the rule off, and no veto leaves a finding or a count', async (t) => {
  const dir = failingRepo(t);

  const baseline = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.equal(baseline.summary.error, 1, 'baseline runs it at `error`');
  const strict = JSON.parse((await scan(dir, ['--format', 'json', '--preset', 'strict'])).stdout);
  assert.equal(strict.summary.error, 1, 'strict runs it at `error` too');

  const starterHuman = await scan(dir, ['--preset', 'starter']);
  const starter = await scan(dir, ['--preset', 'starter', '--format', 'json']);
  assert.equal(starter.code, 0);
  assert.deepEqual(
    JSON.parse(starter.stdout).summary,
    { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' },
    'the preset leaves neither a finding nor a count',
  );
  assert.match(starterHuman.stdout.replace(/\s+/g, ' '), /off by policy: .*pull_request_target/);

  const ignored = JSON.parse((await scan(dir, ['--ignore', 'pull-request-target', '--format', 'json'])).stdout);
  assert.deepEqual(ignored.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(ignored.findings, [], '--ignore leaves neither a finding nor a count');

  writeFileSync(
    join(dir, 'funky-secure.config.json'),
    `${JSON.stringify({ rules: { 'pull-request-target': 'off' } }, null, 2)}\n`,
  );
  const off = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual(off.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(off.findings, [], 'a repository that turns the rule off counts nothing either');
});

/// `S4`, the remediation: both halves the finding prints clear that finding, on a disposable copy —
/// and each leaves the workflow unable to run fork code in the base repository's context.

test('obligation: each printed remediation clears its own finding', async (t) => {
  const before = JSON.parse((await scan(failingRepo(t), ['--format', 'json'])).stdout).findings[0];
  assert.deepEqual(before.remediation, {
    kind: 'manual',
    command: 'remove the pull_request_target trigger, or the step that checks out the pull request head',
  });

  const withoutTrigger = failingRepo(t);
  const triggerPath = join(withoutTrigger, '.github', 'workflows', 'ci.yml');
  writeFileSync(
    triggerPath,
    readFileSync(triggerPath, 'utf8').replace('  pull_request_target:\n    types: [opened]\n', '  push:\n'),
  );
  const triggerRun = await scan(withoutTrigger, ['--format', 'json']);
  assert.equal(triggerRun.code, 0, 'the first half of the remediation no longer fails the run');
  assert.deepEqual(
    JSON.parse(triggerRun.stdout).summary,
    { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
  );

  const withoutStep = failingRepo(t);
  const stepPath = join(withoutStep, '.github', 'workflows', 'ci.yml');
  writeFileSync(
    stepPath,
    readFileSync(stepPath, 'utf8').replace(
      `      - uses: actions/checkout@${SHA}\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n`,
      '',
    ),
  );
  assert.equal(readFileSync(stepPath, 'utf8').includes('github.event.pull_request.head'), false);
  const stepRun = await scan(withoutStep, ['--format', 'json']);
  assert.equal(stepRun.code, 0, 'the second half of the remediation no longer fails the run');
  assert.deepEqual(
    JSON.parse(stepRun.stdout).summary,
    { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
    'and it is a counted pass',
  );
});

/// `S4`, the two formats: same count, path, line and message — never a code, which the human
/// renderer does not print for any rule.

test('obligation: both formats agree on count, path, line and message, and neither prints a code', async (t) => {
  const passing = scratch(t);
  writeWorkflow(passing, SAFE);
  const categories = [['fail', failingRepo(t)], ['pass', passing], ['skip', scratch(t)]];

  for (const [shape, dir] of categories) {
    const json = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
    const human = await scan(dir);
    const flat = human.stdout.replace(/\s+/g, ' ');

    assert.deepEqual(humanSummary(human.stdout), json.summary, `${shape}: the two formats count the same`);
    for (const finding of json.findings) {
      assert.ok(flat.includes(finding.message), `${shape}: no message ${JSON.stringify(finding.message)}`);
      // A pathless finding (the `no-ci` skip) has no location to print, so the message is all there is
      // to compare — the message itself stopped carrying a `.github/workflows` dot with #390, which is
      // why this reads the path only when the report has one.
      if (finding.path !== undefined) {
        assert.ok(flat.includes(finding.path), `${shape}: no path ${finding.path}`);
      }
      if (finding.line !== undefined) {
        assert.ok(flat.includes(`${finding.path}:${finding.line}`), `${shape}: no ${finding.path}:${finding.line}`);
      }
      assert.equal(human.stdout.includes(finding.code), false, `${shape}: the human report printed ${finding.code}`);
    }
  }
});
