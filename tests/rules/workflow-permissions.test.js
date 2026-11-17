import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../../src/cli.js';
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

test('a workflow whose several jobs inherit says so with a plural verb (issue 332)', () => {
  const manyJobs = `name: ci
on:
  pull_request:
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  b:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  c:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  d:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  e:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  f:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;
  const findings = rule.detect(context({ workflows: [workflow(manyJobs)] }));

  assert.equal(
    findings[0].message,
    'the workflow declares no permissions:, so 5 of its 6 jobs (a, b, c, d, e) inherit the scopes the repository setting allows',
  );
});

test('a workflow whose one job inherits keeps the singular verb (issue 332)', () => {
  const oneOfThree = `name: ci
on:
  pull_request:
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  b:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  c:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;
  const findings = rule.detect(context({ workflows: [workflow(oneOfThree)] }));

  assert.equal(
    findings[0].message,
    'the workflow declares no permissions:, so 1 of its 3 jobs (a) inherits the scopes the repository setting allows',
  );
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

test('reports an indentless step list instead of skipping it as unparseable', () => {
  const indentless = `name: ci
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
`;
  const findings = rule.detect(context({ workflows: [workflow(indentless)] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'workflow-permissions-missing');
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

/// The four sides of `S3` and the three obligations of `S4`, driven through the binary over
/// repositories built at runtime (`S5`). No fixture family is committed: every repository is a
/// `mkdtempSync` directory, and the child environment is scrubbed of `CI` and every `npm_config_*`.
/// This rule reads files only — no probe answers any side — so nothing here depends on the machine.

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
  return cli(dir, ['scan', '--scope', 'repo', '--only', 'workflow-permissions', ...argv]);
}

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-workflow-permissions-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeWorkflow(dir, lines, name = 'ci.yml') {
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dir, '.github', 'workflows', name), `${lines.join('\n')}\n`);
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

/**
 * Two of three jobs inherit (`ci.yml`), a workflow-level `write-all` a job narrows (`wide.yml`), and
 * a job-level `write-all` under a narrow workflow (`jobwide.yml`): the three shapes one run answers.
 */
function failingRepo(t) {
  const dir = scratch(t);
  writeWorkflow(dir, [
    'name: ci', 'on:', '  pull_request:', 'jobs:',
    '  a:', '    runs-on: ubuntu-latest', '    steps:', '      - run: npm test',
    '  b:', '    runs-on: ubuntu-latest', '    steps:', '      - run: npm test',
    '  c:', '    permissions:', '      contents: read', '    runs-on: ubuntu-latest',
    '    steps:', '      - run: npm test',
  ]);
  writeWorkflow(dir, [
    'name: wide', 'on:', '  push:', 'permissions: write-all', 'jobs:',
    '  build:', '    runs-on: ubuntu-latest', '    steps:', '      - run: npm test',
    '  narrow:', '    permissions:', '      contents: read', '    runs-on: ubuntu-latest',
    '    steps:', '      - run: npm test',
  ], 'wide.yml');
  writeWorkflow(dir, [
    'name: jobwide', 'on:', '  push:', 'permissions:', '  contents: read', 'jobs:',
    '  release:', '    permissions: write-all', '    runs-on: ubuntu-latest', '    steps:',
    '      - run: npm run build',
  ], 'jobwide.yml');
  return dir;
}

/** A map, `read-all`, `{}` and a per-job-only workflow, plus the three shapes that are not declarations. */
function passingRepo(t) {
  const dir = scratch(t);
  writeWorkflow(dir, [
    '# permissions: write-all', 'name: ci', 'on:', '  push:', 'permissions:', '  contents: read',
    'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:',
    '      - run: echo "permissions: write-all"',
    '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
    '        with:', '          permissions: write-all',
  ]);
  for (const [name, header] of [
    ['perjob.yml', ['jobs:', '  build:', '    permissions:', '      contents: read']],
    ['readall.yml', ['permissions: read-all', 'jobs:', '  build:']],
    ['empty.yml', ['permissions: {}', 'jobs:', '  build:']],
    ['flow.yml', ['permissions: { contents: read }', 'jobs:', '  build:']],
  ]) {
    writeWorkflow(dir, ['name: ' + name.replace('.yml', ''), 'on:', '  push:', ...header,
      '    runs-on: ubuntu-latest', '    steps:', '      - run: npm test'], name);
  }
  return dir;
}

/// Side one: it fails, once per workflow at the line the finding names.

test('side one: one finding per workflow, the inheriting jobs named, and write-all at both scopes', async (t) => {
  const dir = failingRepo(t);
  const before = readFileSync(join(dir, '.github', 'workflows', 'wide.yml'), 'utf8');

  const { code, stdout, stderr } = await scan(dir, ['--format', 'json', '--fail-on', 'warn']);
  assert.equal(stderr, '');
  assert.equal(code, 1, 'three warnings above a `warn` threshold is a failing run');
  const report = JSON.parse(stdout);

  assert.deepEqual(report.summary, { error: 0, warn: 3, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  assert.deepEqual(projection(report), [
    ['fail', 'workflow-permissions-missing', 'ci', '.github/workflows/ci.yml', 1],
    ['fail', 'workflow-permissions-write-all', 'ci', '.github/workflows/jobwide.yml', 8],
    ['fail', 'workflow-permissions-write-all', 'ci', '.github/workflows/wide.yml', 4],
  ]);
  assert.deepEqual(
    report.findings.map((finding) => [finding.path, finding.line, finding.message]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])),
    [
      ['.github/workflows/ci.yml', 1, 'the workflow declares no permissions:, so 2 of its 3 jobs (a, b) inherit the scopes the repository setting allows'],
      ['.github/workflows/wide.yml', 4, 'the workflow grants permissions: write-all, so every scope the GITHUB_TOKEN supports is writable in every job that does not narrow it'],
      ['.github/workflows/jobwide.yml', 8, 'job "release" grants permissions: write-all, so every scope the GITHUB_TOKEN supports is writable in that job, whatever the workflow declares'],
    ],
  );
  const [missing, wide, jobwide] = [
    report.findings.find((finding) => finding.code === 'workflow-permissions-missing'),
    report.findings.find((finding) => finding.path === '.github/workflows/wide.yml'),
    report.findings.find((finding) => finding.path === '.github/workflows/jobwide.yml'),
  ];
  assert.deepEqual(missing.evidence, { level: 'workflow', jobs: ['a', 'b'] }, 'the inheriting jobs are named, not one finding each');
  assert.deepEqual(wide.evidence, { level: 'workflow' });
  assert.deepEqual(jobwide.evidence, { level: 'job', job: 'release' });
  assert.equal(readFileSync(join(dir, '.github', 'workflows', 'wide.yml'), 'utf8'), before, 'a scan is read-only');
});

/// Side two: it passes, and the pass is counted rather than merely absent.

test('side two: the pass is one counted rule, and a run body, a comment or a with: key is not a declaration', async (t) => {
  const dir = passingRepo(t);
  const json = await scan(dir, ['--format', 'json']);
  const report = JSON.parse(json.stdout);

  assert.equal(json.code, 0);
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings, [], 'a pass is a count in the summary, never a row in the report');
  const human = await scan(dir);
  assert.deepEqual(humanSummary(human.stdout), report.summary, 'the pass is counted in both formats');
  assert.match(human.stdout, /all 1 rule pass/);
  assert.equal(/^ {2}[\u2013\u26a0]/m.test(human.stdout), false, 'a pass is not a skip in disguise');

  // The same three passages inside a workflow that declares nothing are a missing declaration, never
  // a `write-all`: the reader reads the structural declaration, not the word.
  const noisy = scratch(t);
  writeWorkflow(noisy, [
    '# permissions: write-all', 'name: noisy', 'on:', '  push:', 'jobs:',
    '  build:', '    runs-on: ubuntu-latest', '    steps:',
    '      - run: echo "permissions: write-all"',
    '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
    '        with:', '          permissions: write-all',
    '  lint:', '    runs-on: ubuntu-latest', '    steps:', '      - run: npm test',
  ]);
  const noisyReport = JSON.parse((await scan(noisy, ['--format', 'json'])).stdout);
  assert.deepEqual(projection(noisyReport), [['fail', 'workflow-permissions-missing', 'ci', '.github/workflows/ci.yml', 1]]);
  assert.deepEqual(noisyReport.findings[0].evidence, { level: 'workflow', jobs: ['build', 'lint'] });
  assert.equal(
    noisyReport.findings[0].message,
    'the workflow declares no permissions:, so every job inherits the scopes the repository setting allows',
    'every job inheriting is said as every job, and evidence.jobs still names each one',
  );
});

/// Side three: it skips for want of a fact, with the code and the fact in the message, and no skip is
/// ever a pass.

test('side three: no-ci, unparseable-workflow and no-repo name their fact, and none is a pass', async (t) => {
  const empty = scratch(t);
  const emptyRun = await scan(empty, ['--format', 'json']);
  const emptyReport = JSON.parse(emptyRun.stdout);
  assert.equal(emptyRun.code, 0, 'a skip is not a failure');
  assert.deepEqual(emptyReport.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  assert.deepEqual(
    emptyReport.findings.map((finding) => [finding.status, finding.code, finding.message, finding.remediation]),
    [[
      'skip',
      'no-ci',
      // Issue #390: the fact measured is that no workflow file exists, never that a directory is
      // absent — the directory may exist and hold none, and the sentence must be true there too.
      'skipped: there is no workflow file, so no workflow can declare permissions',
      { kind: 'none' },
    ]],
  );
  assert.equal(emptyReport.findings[0].message.includes('directory'), false);
  const emptyHuman = await scan(empty);
  assert.match(emptyHuman.stdout, /^summary {2}0 errors · 0 warnings · 0 info · 0 passing · 1 skipped$/m);
  assert.match(emptyHuman.stdout, /1 rule not verified: workflow-permissions/);

  // The directory exists and holds no workflow file: the rule skips for the same reason, and prints
  // the same sentence — measured, and true in both shapes since #390 made it name the file.
  const readmeOnly = scratch(t);
  mkdirSync(join(readmeOnly, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(readmeOnly, '.github', 'workflows', 'README.md'), 'notes\n');
  const readmeReport = JSON.parse((await scan(readmeOnly, ['--format', 'json'])).stdout);
  assert.deepEqual(readmeReport.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  assert.deepEqual(
    readmeReport.findings.map((finding) => [finding.code, finding.message]),
    emptyReport.findings.map((finding) => [finding.code, finding.message]),
  );
  assert.equal(
    readmeReport.findings[0].message,
    'skipped: there is no workflow file, so no workflow can declare permissions',
    'the directory exists here, so only a sentence about the file is true',
  );

  const broken = scratch(t);
  writeWorkflow(broken, ['name: bad', 'on:', '  push:', 'permissions: bogus', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:', '      - run: npm test']);
  const brokenReport = JSON.parse((await scan(broken, ['--format', 'json'])).stdout);
  assert.deepEqual(brokenReport.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  assert.equal(brokenReport.findings[0].code, 'unparseable-workflow');
  assert.equal(brokenReport.findings[0].path, '.github/workflows/ci.yml');
  assert.match(brokenReport.findings[0].message, /^skipped: unparseable workflow — "permissions" at line 4 is neither a map nor write-all\/read-all/);

  const mixed = scratch(t);
  writeWorkflow(mixed, ['name: bad', 'on:', '  push:', 'permissions: bogus', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:', '      - run: npm test'], 'bad.yml');
  writeWorkflow(mixed, ['name: good', 'on:', '  push:', 'permissions:', '  contents: read', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:', '      - run: npm test'], 'good.yml');
  assert.deepEqual(
    JSON.parse((await scan(mixed, ['--format', 'json'])).stdout).summary,
    { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' },
    'the rule never adds a pass on top of a skipped file',
  );

  const noRepo = JSON.parse(
    (await cli(empty, ['scan', '--scope', 'machine', '--only', 'workflow-permissions', '--format', 'json'])).stdout,
  );
  assert.equal(noRepo.findings[0].code, 'no-repo');
  assert.equal(noRepo.findings[0].message, 'skipped: the repository was excluded by --scope machine');
  assert.deepEqual(noRepo.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
});

/// Side four: off by policy — the preset and the veto leave neither a finding nor a count.

test('side four: starter turns the rule off, strict calls both codes errors, and no veto leaves a count', async (t) => {
  const dir = failingRepo(t);

  const baseline = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual([baseline.summary.warn, baseline.findings.length], [3, 3]);
  assert.equal(baseline.findings.every((finding) => finding.severity === 'warn'), true);

  const strict = JSON.parse((await scan(dir, ['--format', 'json', '--preset', 'strict'])).stdout);
  assert.deepEqual(strict.summary, { error: 3, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  assert.equal(strict.findings.every((finding) => finding.severity === 'error'), true);

  const starter = await scan(dir, ['--preset', 'starter']);
  const starterReport = JSON.parse((await scan(dir, ['--preset', 'starter', '--format', 'json'])).stdout);
  assert.equal(starter.code, 0);
  assert.deepEqual(starterReport.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(starterReport.findings, [], 'the preset leaves neither a finding nor a count');
  assert.match(starter.stdout.replace(/\s+/g, ' '), /off by policy: .*Workflow permissions/, 'and names it');

  const ignored = JSON.parse((await scan(dir, ['--ignore', 'workflow-permissions', '--format', 'json'])).stdout);
  assert.deepEqual(ignored.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(ignored.findings, [], '--ignore leaves neither a finding nor a count');

  writeFileSync(
    join(dir, 'funky-secure.config.json'),
    `${JSON.stringify({ rules: { 'workflow-permissions': 'off' } }, null, 2)}\n`,
  );
  const off = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual(off.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(off.findings, [], 'a repository that turns the rule off counts nothing either');
});

/// `S4`, the remediation: the text a fail prints clears that fail on the disposable fixture, and it
/// clears the privilege with it.

test('obligation: each printed remediation clears its own finding and leaves no write-all behind', async (t) => {
  const dir = failingRepo(t);
  const before = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  const pick = (path) => before.findings.find((finding) => finding.path === path);
  const missing = pick('.github/workflows/ci.yml');
  const wide = pick('.github/workflows/wide.yml');
  const jobwide = pick('.github/workflows/jobwide.yml');

  assert.equal(
    missing.remediation.command,
    'add "permissions:" with "contents: read" at the workflow level, or declare it on the job that needs ' +
      'more than the workflow grants. Widening the workflow-level block for one job would grant that scope ' +
      'to every job',
  );
  assert.equal(wide.remediation.command, 'replace the workflow-level "permissions: write-all" with the exact scopes the workflows write');
  assert.equal(jobwide.remediation.command, 'replace "permissions: write-all" in job "release" with the exact scopes that job writes');

  const path = (name) => join(dir, '.github', 'workflows', name);
  const lines = readFileSync(path('ci.yml'), 'utf8').split('\n');
  const jobsAt = lines.indexOf('jobs:');
  writeFileSync(path('ci.yml'), [...lines.slice(0, jobsAt), 'permissions:', '  contents: read', ...lines.slice(jobsAt)].join('\n'));
  for (const name of ['wide.yml', 'jobwide.yml']) {
    const text = readFileSync(path(name), 'utf8');
    // The same declaration, written where it belongs: the replacement keeps its indentation, because
    // a job's `permissions:` key is nested and a top-level one is not.
    writeFileSync(path(name), text.replace(/^(\s*)permissions: write-all$/m, '$1permissions:\n$1  contents: read'));
  }

  const after = await scan(dir, ['--format', 'json', '--fail-on', 'warn']);
  const report = JSON.parse(after.stdout);
  assert.equal(after.code, 0, 'the cleared state no longer fails the run');
  assert.deepEqual(report.findings, [], 'the printed remediation did not clear its own finding');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' }, 'and it is a counted pass');
  for (const name of ['ci.yml', 'wide.yml', 'jobwide.yml']) {
    assert.equal(readFileSync(path(name), 'utf8').includes('write-all'), false, `${name} still grants every scope`);
  }
});

/// `S4`, the missing declaration (#407): the remediation names both shapes and why they are not
/// interchangeable — a workflow-level block cannot be widened for one job without granting that scope to
/// every job — and it names no job, so it cannot name one the file does not have.

test('obligation: the missing-declaration remediation names both shapes and never a job (#407)', async (t) => {
  // Jobs that do not all need the same scopes: `publish` needs more than `contents: read`, and the
  // workflow-level block that serves `notice` cannot be widened for `publish` alone.
  const dir = scratch(t);
  writeWorkflow(dir, [
    'name: release', 'on:', '  push:', 'jobs:',
    '  publish:', '    runs-on: ubuntu-latest', '    steps:', '      - run: npm publish',
    '  notice:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo ok',
  ]);
  const report = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  const missing = report.findings.find((finding) => finding.code === 'workflow-permissions-missing');
  assert.ok(missing !== undefined, 'the fixture is the missing-declaration fail');

  const fix = missing.remediation.command;
  assert.equal(missing.remediation.kind, 'manual', 'the fix is still a human step');
  // Neither shape replaces the other, so both are printed even when only one applies to this file.
  assert.match(fix, /permissions:/);
  assert.match(fix, /contents: read/);
  assert.match(fix, /workflow level/, 'the workflow-level block is the first shape');
  assert.match(fix, /job that needs more than the workflow grants/, 'the per-job block is the second shape');
  // The reason the two are not interchangeable, which is what makes the second shape a fix of its own.
  assert.match(fix, /grant that scope to every job/, 'a workflow-level widening reaches every job');
  // A job the file does not have cannot be named here, so no job is named at all.
  assert.equal(/\bjob\s+"/.test(fix), false, `the fix names a job: ${fix}`);
  for (const id of ['publish', 'notice']) assert.equal(fix.includes(id), false, `the fix named job ${id}`);

  // Deterministic, and independent of the workflow it is printed for: the one-job file gets the bytes
  // of the many-job file, so the sentence is a rule, not a guess about this repository.
  const single = scratch(t);
  writeWorkflow(single, ['name: solo', 'on:', '  push:', 'jobs:', '  release:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo ok']);
  const singleFix = JSON.parse((await scan(single, ['--format', 'json'])).stdout)
    .findings.find((finding) => finding.code === 'workflow-permissions-missing').remediation.command;
  assert.equal(singleFix, fix, 'the sentence does not change with the jobs it is printed beside');
  assert.equal(
    JSON.parse((await scan(dir, ['--format', 'json'])).stdout)
      .findings.find((finding) => finding.code === 'workflow-permissions-missing').remediation.command,
    fix,
    'the same bytes on a second run',
  );

  // Printed in the same field, in both formats.
  const human = await scan(dir);
  assert.ok(human.stdout.replace(/\s+/g, ' ').includes(fix), 'the human report prints the same remediation');

  // The second shape is a fix of its own, not a variant of the first: on the job that needs more it
  // clears the finding with no workflow-level grant, which is the only way to do it without granting
  // that scope to every job. This is the pre-existing behaviour the new sentence now names.
  const perJob = scratch(t);
  writeWorkflow(perJob, ['name: solo', 'on:', '  push:', 'jobs:', '  publish:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo ok']);
  assert.equal(
    JSON.parse((await scan(perJob, ['--only', 'workflow-permissions', '--format', 'json'])).stdout).findings[0].code,
    'workflow-permissions-missing',
  );
  const file = join(perJob, '.github', 'workflows', 'ci.yml');
  const lines = readFileSync(file, 'utf8').split('\n');
  const at = lines.indexOf('  publish:');
  writeFileSync(file, [...lines.slice(0, at + 1), '    permissions:', '      contents: write', ...lines.slice(at + 1)].join('\n'));
  const cleared = await scan(perJob, ['--only', 'workflow-permissions', '--format', 'json']);
  assert.deepEqual(
    JSON.parse(cleared.stdout).summary,
    { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
    'the per-job block alone clears the missing declaration, with no workflow-level grant to widen',
  );
  assert.equal(readFileSync(file, 'utf8').includes('\npermissions:'), false, 'and the grant stayed on the one job');
});

/// `S4`, the two formats: same count, path, line and message — never a code, which the human
/// renderer does not print for any rule.

test('obligation: both formats agree on count, path, line and message, and neither prints a code', async (t) => {
  for (const [shape, dir] of [['fail', failingRepo(t)], ['pass', passingRepo(t)], ['skip', scratch(t)]]) {
    const json = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
    const human = await scan(dir);
    const flat = human.stdout.replace(/\s+/g, ' ');

    assert.deepEqual(humanSummary(human.stdout), json.summary, `${shape}: the two formats count the same`);
    for (const finding of json.findings) {
      assert.ok(flat.includes(finding.message), `${shape}: no message ${JSON.stringify(finding.message)}`);
      if (finding.path !== undefined) assert.ok(flat.includes(finding.path), `${shape}: no path ${finding.path}`);
      if (finding.line !== undefined) assert.ok(flat.includes(`${finding.path}:${finding.line}`), `${shape}: no ${finding.path}:${finding.line}`);
      assert.equal(human.stdout.includes(finding.code), false, `${shape}: the human report printed the code ${finding.code}`);
    }
  }
});
