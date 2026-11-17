import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../../src/cli.js';
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

/// The four sides of `S3` and the three obligations of `S4`, driven through the binary over
/// repositories built at runtime (`S5`). No fixture family is committed; every path is a `mkdtempSync`
/// directory, and the child environment is scrubbed of `CI` and every `npm_config_*`. This rule reads
/// files only — no pnpm probe answers any side — so nothing here depends on the machine.

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
  return cli(dir, ['scan', '--scope', 'repo', '--only', 'ci-no-safety-overrides', ...argv]);
}

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-ci-flags-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeWorkflow(dir, lines, name = 'ci.yml') {
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dir, '.github', 'workflows', name), `${lines.join('\n')}\n`);
}

/** Both codes twice — a workflow step and an `.npmrc` key each — plus the quoted sentence. */
function failingRepo(t) {
  const dir = scratch(t);
  writeWorkflow(dir, [
    'name: ci', // 1
    'on:', // 2
    '  push:', // 3
    '    branches: [main]', // 4
    'jobs:', // 5
    '  build:', // 6
    '    runs-on: ubuntu-latest', // 7
    '    steps:', // 8
    '      - run: pnpm install --no-frozen-lockfile', // 9
    '      - run: pnpm install --ignore-scripts=false', // 10
    '      - run: echo "--frozen-lockfile=false" # --ignore-scripts=false', // 11
  ]);
  writeFileSync(join(dir, '.npmrc'), 'frozen-lockfile=false\n# ignore-scripts=false\nignore-scripts=false\n');
  return dir;
}

/** Everything pnpm's CI defaults already do, plus the quoted sentence and the commented key. */
function passingRepo(t) {
  const dir = scratch(t);
  writeWorkflow(dir, [
    'name: ci', 'on: push', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:',
    '      - run: pnpm install',
    '      - run: pnpm install --frozen-lockfile',
    '      - run: pnpm install --ignore-scripts',
    '      - run: echo "--no-frozen-lockfile"',
    '      - run: echo hi # --no-frozen-lockfile',
  ]);
  writeFileSync(join(dir, '.npmrc'), '# frozen-lockfile=false\nauto-install-peers=true\n');
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

test('side one: both codes fail at the named line, and the quoted sentence is not a command', async (t) => {
  const dir = failingRepo(t);
  const workflowPath = join(dir, '.github', 'workflows', 'ci.yml');
  const workflowBefore = readFileSync(workflowPath, 'utf8');
  const npmrcBefore = readFileSync(join(dir, '.npmrc'), 'utf8');

  const { code, stdout, stderr } = await scan(dir, ['--format', 'json', '--fail-on', 'warn']);
  assert.equal(stderr, '');
  assert.equal(code, 1, 'four warnings above a `warn` threshold is a failing run');
  const report = JSON.parse(stdout);

  assert.deepEqual(report.summary, { error: 0, warn: 4, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  assert.deepEqual(projection(report), [
    ['fail', 'ci-frozen-lockfile-disabled', 'ci', '.github/workflows/ci.yml', 9],
    ['fail', 'ci-frozen-lockfile-disabled', 'repo-root', '.npmrc', 1],
    ['fail', 'ci-lifecycle-scripts-enabled', 'ci', '.github/workflows/ci.yml', 10],
    ['fail', 'ci-lifecycle-scripts-enabled', 'repo-root', '.npmrc', 3],
  ]);
  assert.deepEqual(
    report.findings.map((finding) => [finding.line, finding.message]).sort((a, b) => a[0] - b[0]),
    [
      [1, '.npmrc sets frozen-lockfile=false; pnpm freezes the lockfile in CI by default'],
      [3, '.npmrc sets ignore-scripts=false; the install runs dependency lifecycle scripts, which are off by default'],
      [9, 'job "build" runs --no-frozen-lockfile; the frozen lockfile is what makes the install reproducible from the commit'],
      [10, 'job "build" runs --ignore-scripts=false; dependency lifecycle scripts run arbitrary code at install time'],
    ],
  );
  const frozenStep = report.findings.find((finding) => finding.line === 9);
  assert.deepEqual(frozenStep.evidence, {
    job: 'build',
    step: 0,
    flag: '--no-frozen-lockfile',
    command: 'pnpm install --no-frozen-lockfile',
  });
  assert.deepEqual(frozenStep.remediation, { kind: 'manual', command: 'run: pnpm install --frozen-lockfile' });

  assert.equal(readFileSync(workflowPath, 'utf8'), workflowBefore, 'a scan is read-only');
  assert.equal(readFileSync(join(dir, '.npmrc'), 'utf8'), npmrcBefore, 'a scan is read-only');
});

/// Side two: it passes, and the pass is counted rather than merely absent.

test('side two: the defaults leave one counted pass, not an absence', async (t) => {
  const dir = passingRepo(t);
  const json = await scan(dir, ['--format', 'json']);
  const report = JSON.parse(json.stdout);

  assert.equal(json.code, 0);
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings, []);
  const human = await scan(dir);
  assert.deepEqual(humanSummary(human.stdout), report.summary, 'the pass is counted in both formats');
  assert.equal(/^ {2}– {2}/m.test(human.stdout), false, 'a pass is not a skip in disguise');
});

/// The sentence the page states about the count, measured.

test('the page count: a word repeated in one step is one finding, at the step line', async (t) => {
  const dir = scratch(t);
  writeWorkflow(dir, [
    'name: ci', 'on: push', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:',
    '      - run: pnpm install --no-frozen-lockfile --no-frozen-lockfile',
    '      - run: |',
    '          pnpm install',
    '          pnpm add x --no-frozen-lockfile',
  ]);
  const report = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);

  assert.deepEqual(
    report.findings.map((finding) => [finding.code, finding.line, finding.evidence.command]),
    [
      ['ci-frozen-lockfile-disabled', 7, 'pnpm install --no-frozen-lockfile --no-frozen-lockfile'],
      ['ci-frozen-lockfile-disabled', 8, 'pnpm add x --no-frozen-lockfile'],
    ],
  );
});

/// Side three: it skips for want of a fact, with the code and the fact in the message, and no skip is
/// ever a pass.

test('side three: no-ci, unparseable-workflow and no-repo name their fact, and none is a pass', async (t) => {
  const empty = scratch(t);
  const json = await scan(empty, ['--format', 'json']);
  const report = JSON.parse(json.stdout);

  assert.equal(json.code, 0, 'a skip is not a failure');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  assert.deepEqual(
    report.findings.map((finding) => [finding.status, finding.code, finding.message, finding.remediation]),
    [['skip', 'no-ci', 'skipped: there is no workflow and no root .npmrc, so no CI install fact exists', { kind: 'none' }]],
  );
  const human = await scan(empty);
  assert.match(human.stdout, /^summary {2}0 errors · 0 warnings · 0 info · 0 passing · 1 skipped$/m);
  assert.match(human.stdout, /1 rule not verified: ci-no-safety-overrides/);

  const broken = scratch(t);
  writeWorkflow(broken, ['jobs: [oops']);
  const brokenReport = JSON.parse((await scan(broken, ['--format', 'json'])).stdout);
  assert.deepEqual(brokenReport.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  assert.equal(brokenReport.findings[0].code, 'unparseable-workflow');
  assert.equal(brokenReport.findings[0].path, '.github/workflows/ci.yml');
  assert.match(brokenReport.findings[0].message, /^skipped: unparseable workflow — /);

  const mixed = scratch(t);
  writeWorkflow(mixed, ['jobs: [oops'], 'bad.yml');
  writeWorkflow(mixed, ['name: ci', 'on: push', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:', '      - run: pnpm install'], 'good.yml');
  assert.deepEqual(
    JSON.parse((await scan(mixed, ['--format', 'json'])).stdout).summary,
    { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' },
    'the rule never adds a pass on top of a skipped file',
  );

  const noRepo = JSON.parse(
    (await cli(empty, ['scan', '--scope', 'machine', '--only', 'ci-no-safety-overrides', '--format', 'json'])).stdout,
  );
  assert.equal(noRepo.findings[0].code, 'no-repo');
  assert.equal(noRepo.findings[0].message, 'skipped: the repository was excluded by --scope machine');
  assert.deepEqual(noRepo.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
});

/// Side four: off by policy — the preset and the veto leave neither a finding nor a count.

test('side four: starter turns the rule off, and no veto leaves a finding or a count', async (t) => {
  const dir = failingRepo(t);

  const baseline = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual([baseline.summary.warn, baseline.findings.length], [4, 4]);
  assert.equal(baseline.findings.every((finding) => finding.severity === 'warn'), true);

  const strict = JSON.parse((await scan(dir, ['--format', 'json', '--preset', 'strict'])).stdout);
  assert.deepEqual(strict.summary, { error: 4, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  assert.equal(strict.findings.every((finding) => finding.severity === 'error'), true);

  const starter = await scan(dir, ['--preset', 'starter']);
  const starterReport = JSON.parse((await scan(dir, ['--preset', 'starter', '--format', 'json'])).stdout);
  assert.equal(starter.code, 0);
  assert.deepEqual(starterReport.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(starterReport.findings, [], 'the preset leaves neither a finding nor a count');
  assert.match(starter.stdout.replace(/\s+/g, ' '), /off by policy: .*CI install flags/, 'and names it');

  const ignored = JSON.parse((await scan(dir, ['--ignore', 'ci-no-safety-overrides', '--format', 'json'])).stdout);
  assert.deepEqual(ignored.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(ignored.findings, [], '--ignore leaves neither a finding nor a count');

  writeFileSync(
    join(dir, 'funky-secure.config.json'),
    `${JSON.stringify({ rules: { 'ci-no-safety-overrides': 'off' } }, null, 2)}\n`,
  );
  const off = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual(off.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(off.findings, [], 'a repository that turns the rule off counts nothing either');
});

/// `S4`, the remediation: the text a fail prints clears that fail on the disposable fixture.

test('obligation: the printed remediation clears its own finding', async (t) => {
  const dir = failingRepo(t);
  const before = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  const pick = (target, code) => before.findings.find((finding) => finding.target === target && finding.code === code);

  const workflowFrozen = pick('ci', 'ci-frozen-lockfile-disabled');
  const workflowScripts = pick('ci', 'ci-lifecycle-scripts-enabled');
  assert.equal(workflowFrozen.remediation.command, 'run: pnpm install --frozen-lockfile');
  assert.equal(workflowScripts.remediation.command, 'run: pnpm install --ignore-scripts');

  const workflowPath = join(dir, '.github', 'workflows', 'ci.yml');
  writeFileSync(workflowPath, readFileSync(workflowPath, 'utf8')
    .replace('run: pnpm install --no-frozen-lockfile', workflowFrozen.remediation.command)
    .replace('run: pnpm install --ignore-scripts=false', workflowScripts.remediation.command));

  const npmrcFindings = before.findings.filter((finding) => finding.target === 'repo-root');
  for (const finding of npmrcFindings) {
    assert.equal(finding.remediation.command, `delete the ${finding.evidence.key} key from .npmrc`);
  }
  const npmrcPath = join(dir, '.npmrc');
  writeFileSync(npmrcPath, readFileSync(npmrcPath, 'utf8').split('\n')
    .filter((line) => !npmrcFindings.some((finding) => line.startsWith(`${finding.evidence.key}=`)))
    .join('\n'));

  const after = await scan(dir, ['--format', 'json', '--fail-on', 'warn']);
  const report = JSON.parse(after.stdout);
  assert.equal(after.code, 0, 'the cleared state no longer fails the run');
  assert.deepEqual(report.findings, [], 'the printed remediation did not clear its own finding');
  assert.deepEqual(
    report.summary,
    { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
    'and it is a counted pass',
  );
});

/// `S4`, the shape of the printed edit: the offending word moves and the rest of the body stays.
/// The page used to print a whole `run:` body, so a compound step lost its other commands (#383).

/** The words of a text, so a test can say that only one of them moved. */
function wordCounts(text) {
  const counts = new Map();
  for (const word of text.split(/\s+/)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

/** The words `after` dropped and gained relative to `before`, in document order. */
function wordDiff(before, after) {
  const from = wordCounts(before);
  const to = wordCounts(after);
  const removed = [];
  const added = [];
  for (const [word, count] of from) for (let i = 0; i < count - (to.get(word) ?? 0); i += 1) removed.push(word);
  for (const [word, count] of to) for (let i = 0; i < count - (from.get(word) ?? 0); i += 1) added.push(word);
  return { removed, added };
}

/** One step of one workflow, in a scratch repository, and the body it runs. */
function oneStep(t, stepLines) {
  const dir = scratch(t);
  writeWorkflow(dir, [
    'name: ci', 'on: push', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:', ...stepLines,
  ]);
  return { dir, path: join(dir, '.github', 'workflows', 'ci.yml') };
}

/** The body of the one step of a written workflow, as the file now spells it. */
function stepBody(path) {
  const match = /^\s*- run: (.*)$/m.exec(readFileSync(path, 'utf8'));
  assert.ok(match !== null, 'the fixture no longer carries a single-line `run:` step');
  return match[1];
}

test('a compound step keeps its other commands: the printed text is the edited body', async (t) => {
  const body = 'pnpm install --no-frozen-lockfile && pnpm build';
  const { dir, path } = oneStep(t, [`      - run: ${body}`]);
  const before = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  const [finding] = before.findings;

  assert.equal(finding.evidence.command, body, 'the evidence is the whole body, as written');
  assert.deepEqual(finding.remediation, {
    kind: 'manual',
    command: 'run: pnpm install --frozen-lockfile && pnpm build',
  });

  const human = await scan(dir);
  assert.ok(
    human.stdout.replace(/\s+/g, ' ').includes('run: pnpm install --frozen-lockfile && pnpm build'),
    'the human report prints the same edit',
  );

  const printed = finding.remediation.command;
  assert.ok(printed.startsWith('run: '), 'the printed text is the step to put in place');
  writeFileSync(path, readFileSync(path, 'utf8').replace(`- run: ${body}`, `- ${printed}`));

  const applied = stepBody(path);
  assert.deepEqual(wordDiff(body, applied), {
    removed: ['--no-frozen-lockfile'],
    added: ['--frozen-lockfile'],
  }, 'only the flag moved, so no other command of the step was dropped');
  assert.equal(applied, 'pnpm install --frozen-lockfile && pnpm build');

  const after = await scan(dir, ['--format', 'json', '--fail-on', 'warn']);
  assert.equal(after.code, 0, 'the printed edit clears the finding');
  assert.deepEqual(JSON.parse(after.stdout).summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
});

test('every spelling of both codes moves one word of a compound step and keeps the rest', async (t) => {
  const cases = [
    ['pnpm install --no-frozen-lockfile && pnpm build', 'run: pnpm install --frozen-lockfile && pnpm build', 'ci-frozen-lockfile-disabled'],
    ['pnpm install --frozen-lockfile=false && pnpm build', 'run: pnpm install --frozen-lockfile && pnpm build', 'ci-frozen-lockfile-disabled'],
    ['pnpm install --ignore-scripts=false && pnpm test', 'run: pnpm install --ignore-scripts && pnpm test', 'ci-lifecycle-scripts-enabled'],
    ['pnpm install --enable-pre-post-scripts && pnpm test', 'run: pnpm install --ignore-scripts && pnpm test', 'ci-lifecycle-scripts-enabled'],
    ['pnpm install --enable-pre-post-scripts=true && pnpm test', 'run: pnpm install --ignore-scripts && pnpm test', 'ci-lifecycle-scripts-enabled'],
  ];

  for (const [body, printed, code] of cases) {
    const { dir, path } = oneStep(t, [`      - run: ${body}`]);
    const [finding] = JSON.parse((await scan(dir, ['--format', 'json'])).stdout).findings;

    assert.equal(finding.code, code, body);
    assert.equal(finding.remediation.command, printed, body);

    writeFileSync(path, readFileSync(path, 'utf8').replace(`- run: ${body}`, `- ${printed}`));
    assert.equal(stepBody(path), printed.slice('run: '.length), body);
    assert.deepEqual(JSON.parse((await scan(dir, ['--format', 'json'])).stdout).findings, [], `${body} cleared`);
  }
});

test('the edit is word-level: a word repeated in the step moves every time, prose stays as written', async (t) => {
  const repeated = 'pnpm install --no-frozen-lockfile --no-frozen-lockfile';
  const one = oneStep(t, [`      - run: ${repeated}`]);
  const [finding] = JSON.parse((await scan(one.dir, ['--format', 'json'])).stdout).findings;
  assert.equal(finding.remediation.command, 'run: pnpm install --frozen-lockfile --frozen-lockfile');
  writeFileSync(one.path, readFileSync(one.path, 'utf8').replace(`- run: ${repeated}`, `- ${finding.remediation.command}`));
  assert.deepEqual(JSON.parse((await scan(one.dir, ['--format', 'json'])).stdout).findings, [], 'one finding, so one edit for both words');

  const prose = 'pnpm install --no-frozen-lockfile && echo "--no-frozen-lockfile"';
  const two = oneStep(t, [`      - run: ${prose}`]);
  const [quoted] = JSON.parse((await scan(two.dir, ['--format', 'json'])).stdout).findings;
  assert.equal(
    quoted.remediation.command,
    'run: pnpm install --frozen-lockfile && echo "--no-frozen-lockfile"',
    'a quoted sentence is not a command, so the edit leaves it alone',
  );
});

test('a body the rule cannot rewrite is printed as a sentence naming the edit, never as a replacement', async (t) => {
  const sentence =
    'edit the step by hand: replace --ignore-scripts=false with --ignore-scripts, ' +
    'keeping the rest of the run: body as written';

  // The flag is not in the body as written: the word carries a quote, so the flag never appears as a
  // whole word and pointing the reader at one would be a guess.
  const quoted = oneStep(t, ['      - run: pnpm install --ignore-scripts="false" && pnpm build']);
  const [fromQuoted] = JSON.parse((await scan(quoted.dir, ['--format', 'json'])).stdout).findings;
  assert.equal(fromQuoted.code, 'ci-lifecycle-scripts-enabled', 'the quoted word is still a finding');
  assert.deepEqual(fromQuoted.remediation, { kind: 'manual', command: sentence });
  assert.equal(fromQuoted.remediation.command.startsWith('run: '), false, 'never printed as a replacement');

  // A multi-line body: one printed line cannot carry the other commands, so the body stays whole.
  const block = oneStep(t, [
    '      - run: |',
    '          pnpm install --no-frozen-lockfile',
    '          pnpm build',
  ]);
  const [fromBlock] = JSON.parse((await scan(block.dir, ['--format', 'json'])).stdout).findings;
  assert.equal(fromBlock.code, 'ci-frozen-lockfile-disabled');
  assert.deepEqual(fromBlock.remediation, {
    kind: 'manual',
    command:
      'edit the step by hand: replace --no-frozen-lockfile with --frozen-lockfile, ' +
      'keeping the rest of the run: body as written',
  });
  assert.equal(fromBlock.remediation.command.startsWith('run: '), false);

  // Neither sentence is applied by the tool, and the sentence discards nothing: the body it names is
  // the body the file still carries.
  assert.equal(
    readFileSync(block.path, 'utf8').includes('          pnpm build'),
    true,
    'a scan is read-only and the step keeps both commands',
  );
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

/// `S6`, the re-run from a different directory: the page says repository-root, and a checkout is the
/// case where the invocation directory and the root differ.

test('the page says repository-root: the same findings are read from a subdirectory of a checkout', async (t) => {
  const dir = scratch(t);
  execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: dir, encoding: 'utf8' });
  writeWorkflow(dir, ['name: ci', 'on: push', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:', '      - run: pnpm install --no-frozen-lockfile']);
  writeFileSync(join(dir, '.npmrc'), 'ignore-scripts=false\n');
  mkdirSync(join(dir, 'src'));

  const report = JSON.parse((await scan(join(dir, 'src'), ['--format', 'json'])).stdout);
  assert.deepEqual(projection(report), [
    ['fail', 'ci-frozen-lockfile-disabled', 'ci', '.github/workflows/ci.yml', 7],
    ['fail', 'ci-lifecycle-scripts-enabled', 'repo-root', '.npmrc', 1],
  ]);
});
