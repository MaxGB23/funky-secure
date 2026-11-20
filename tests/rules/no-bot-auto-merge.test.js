import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { run } from '../../src/cli.js';
import rule from '../../src/rules/no-bot-auto-merge.js';

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

function context({ workflows = [], botFiles = [] } = {}) {
  return {
    scope: 'repo',
    cwd: '/repo',
    root: '/repo',
    env: {},
    configPath: null,
    machine: null,
    repo: repo({ workflows, botFiles }),
  };
}

function workflow(path, lines) {
  return { path, text: lines.join('\n') };
}

test('reports a dependabot configuration as the info finding the spec asks for', () => {
  const findings = rule.detect(context({ botFiles: ['.github/dependabot.yml'] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'bot-config-present');
  assert.deepEqual(findings[0].evidence, {
    files: ['.github/dependabot.yml'],
    botConfig: true,
  });
  assert.match(findings[0].message, /automated updates configured/);

  // The finding is a `fail` whose severity the state table lowers: the state is what makes it
  // information rather than a failure, and the rule declares exactly one.
  assert.deepEqual(rule.severityWhen, [
    {
      state: 'config-present',
      evidence: 'botConfig',
      is: true,
      severity: { baseline: 'info', strict: 'info' },
    },
  ]);
});

test('every other finding carries the selecting key, or the table would throw', () => {
  // `findingSeverity` fails closed when a finding omits the key its rule's table selects on, so the
  // merge-path findings and both skips carry `botConfig: false` (issue 518, judges JD-A-002 and
  // JD-B-002).
  const withMerge = rule.detect(
    context({
      botFiles: ['.github/dependabot.yml'],
      workflows: [
        workflow('.github/workflows/automerge.yml', [
          'name: automerge',
          'on: pull_request',
          'jobs:',
          '  dependabot:',
          '    runs-on: ubuntu-latest',
          "    if: github.actor == 'dependabot[bot]'",
          '    steps:',
          '      - run: gh pr merge --auto --squash',
        ]),
      ],
    }),
  );

  for (const finding of withMerge) {
    assert.equal(
      finding.evidence.botConfig,
      finding.code === 'bot-config-present',
      `${finding.code} carries botConfig: ${String(finding.evidence.botConfig)}`,
    );
  }

  for (const finding of rule.detect(context({}))) {
    assert.equal(finding.evidence.botConfig, false, `${finding.code} carries the key`);
  }
  for (const finding of rule.detect({ policy: {}, severity: () => 'error' })) {
    assert.equal(finding.evidence.botConfig, false, 'no-repo carries the key');
  }
});

test('fails gh pr merge --auto in a job that only runs for dependabot', () => {
  const findings = rule.detect(
    context({
      workflows: [
        workflow('.github/workflows/automerge.yml', [
          'name: automerge',
          'on: pull_request',
          'jobs:',
          '  dependabot:',
          '    runs-on: ubuntu-latest',
          "    if: github.actor == 'dependabot[bot]'",
          '    steps:',
          '      - run: gh pr merge --auto --squash',
        ]),
      ],
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'automerge-for-bot');
  assert.equal(findings[0].path, '.github/workflows/automerge.yml');
  assert.equal(findings[0].line, 8);
  assert.equal(findings[0].evidence.job, 'dependabot');
  assert.equal(findings[0].evidence.step, 0);
  assert.match(findings[0].evidence.run, /gh pr merge --auto/);
  assert.deepEqual(findings[0].remediation, {
    kind: 'manual',
    command: 'edit .github/workflows/automerge.yml:8 and delete the automatic merge step',
  });
});

test('fails a known automerge action in a job named for the bot', () => {
  const findings = rule.detect(
    context({
      workflows: [
        workflow('.github/workflows/renovate.yml', [
          'name: renovate',
          'on: pull_request',
          'jobs:',
          '  update:',
          '    name: renovate[bot] update',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: peter-evans/enable-pull-request-automerge@v3',
        ]),
      ],
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'automerge-for-bot');
  assert.equal(findings[0].evidence.job, 'update');
  assert.equal(findings[0].evidence.uses, 'peter-evans/enable-pull-request-automerge@v3');
  assert.equal(findings[0].line, 8);
  assert.deepEqual(findings[0].remediation, {
    kind: 'manual',
    command: 'edit .github/workflows/renovate.yml:8 and delete the automerge action step',
  });
});

test('passes the same merge command when the job is not restricted to a bot', () => {
  const findings = rule.detect(
    context({
      workflows: [
        workflow('.github/workflows/release.yml', [
          'name: release',
          'on: workflow_dispatch',
          'jobs:',
          '  release:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - run: gh pr merge --merge',
          '      - uses: pascalgn/automerge-action@v0.16.3',
        ]),
      ],
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'no-automerge-path');
  assert.match(findings[0].message, /merged by a person/);
});

test('does not answer the pull_request_target question: that hazard is R11, not this rule', () => {
  const findings = rule.detect(
    context({
      workflows: [
        workflow('.github/workflows/pr-target.yml', [
          'name: pr target',
          'on:',
          '  pull_request_target:',
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
          '        with:',
          '          ref: ${{ github.event.pull_request.head.sha }}',
        ]),
      ],
    }),
  );

  assert.ok(
    findings.every((finding) => finding.code !== 'pr-target-head-checkout'),
    'the head checkout under pull_request_target belongs to pull-request-target, and reporting it ' +
      'here was the duplicate issue 518 was filed for',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'no-automerge-path');
});

test('passes pull_request_target when no job checks out the PR head', () => {
  const findings = rule.detect(
    context({
      workflows: [
        workflow('.github/workflows/pr-target.yml', [
          'name: pr target',
          'on: pull_request_target',
          'jobs:',
          '  label:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea',
        ]),
      ],
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'no-automerge-path');
});

test('skips an unparseable workflow and never adds a false pass', () => {
  const findings = rule.detect(
    context({
      workflows: [
        workflow('.github/workflows/broken.yml', [
          'name: broken',
          'on: pull_request',
          'jobs:',
          '  build:',
          '    <<: *defaults',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - run: gh pr merge --auto',
        ]),
      ],
    }),
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

test('never passes the merge path when a workflow could not be parsed', () => {
  const findings = rule.detect(
    context({
      botFiles: ['.github/dependabot.yml'],
      workflows: [
        workflow('.github/workflows/broken.yml', [
          'name: broken',
          'on: pull_request',
          'jobs:',
          '  build:',
          '    <<: *defaults',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - run: gh pr merge --auto',
        ]),
      ],
    }),
  );

  assert.deepEqual(
    findings.map((finding) => `${finding.status}:${finding.code}`),
    ['skip:unparseable-workflow'],
    'the bot config must not stand in for a merge path this rule never read',
  );
});

/// The field loop (`odd/tasks/field-loop-every-rule.md`, T9): the four sides of `S3` and the three
/// obligations of `S4`, measured through the binary over repositories built at run time (`S5`). No
/// fixture family is committed, no clock, network or machine fact is read, and the rule answers from
/// the workflow files this file writes into a fresh temp directory — a host without pnpm answers
/// this block exactly as one with it does.

/** The pass side: a bot job that merges nothing, and a human job that merges. */
const CLEAN = [
  'name: ci',
  'on: pull_request',
  'jobs:',
  '  dependabot:',
  "    if: github.actor == 'dependabot[bot]'",
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo awaiting review',
  '  release:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: gh pr merge --merge',
].join('\n');

/** An automatic merge in a bot job, and an automerge action whose step starts on its `name:` line. */
const AUTOMERGE = [
  'name: automerge',
  'on: pull_request',
  'jobs:',
  '  dependabot:',
  '    runs-on: ubuntu-latest',
  "    if: github.actor == 'dependabot[bot]'",
  '    steps:',
  '      - run: gh pr merge --auto --squash',
  '      - run: echo reviewed',
  '  enable:',
  '    name: renovate[bot] enable',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - name: enable automerge',
  '        uses: pascalgn/automerge-action@v0.16.3',
].join('\n');

/** The trigger and the head checkout in one job, with a benign step after it. */
const PR_TARGET = [
  'name: pr target',
  'on:',
  '  pull_request_target:',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
  '        with:',
  '          ref: ${{ github.event.pull_request.head.sha }}',
  '      - run: echo reviewed',
].join('\n');

/** The reader cannot parse a merge key, so this file is a skip and never a guess. */
const UNPARSEABLE = [
  'name: broken',
  'on: pull_request',
  'jobs:',
  '  build:',
  '    <<: *defaults',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: gh pr merge --auto',
].join('\n');

/** One repository file set: both fail codes, and the one pass for the configuration signal. */
const FAILING = {
  '.github/dependabot.yml': 'version: 2\nupdates: []\n',
  '.github/workflows/automerge.yml': AUTOMERGE,
  '.github/workflows/pr-target.yml': PR_TARGET,
};

/**
 * The child environment, pinned: a runner's `CI` flag and whatever `npm_config_*` the surrounding
 * shell exports must never be the reason this file measures something else. The rule reads no pnpm
 * fact, so nothing here needs a resolver.
 */
function childEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== 'CI' && !name.startsWith('npm_config_'),
    ),
  );
}

/** A real repository in the OS temp directory: `files` written, nothing committed, git initialised. */
function checkout(t, files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-t9-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: dir, encoding: 'utf8' });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function capture() {
  return {
    text: '',
    isTTY: false,
    write(chunk) {
      this.text += chunk;
      return true;
    },
  };
}

/** One command of the binary over a real checkout, with the probes the tool ships. */
async function cli(dir, argv) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(argv, { cwd: dir, env: childEnv(), stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/** One `repo`-scope scan of this rule. */
function scan(dir, argv = []) {
  return cli(dir, ['scan', '--scope', 'repo', '--only', 'no-bot-auto-merge', ...argv]);
}

/** Apply the printed edit mechanically: delete the step starting at `line`, through its continuations. */
function deleteStepAt(dir, path, line) {
  const file = join(dir, path);
  const lines = readFileSync(file, 'utf8').split('\n');
  const start = line - 1;
  const indent = /^ */.exec(lines[start])[0].length;
  let end = start + 1;
  while (end < lines.length) {
    const body = lines[end];
    const deeper = /^ */.exec(body)[0].length;
    if (body.trim() === '') {
      end += 1;
      continue;
    }
    if (deeper < indent || (deeper === indent && body.trim().startsWith('- '))) break;
    end += 1;
  }
  lines.splice(start, end - start);
  writeFileSync(file, lines.join('\n'));
}

/// Side one: it fails, with its own codes, at the path and the line each finding names.

test('side one: a bot merge and a bot automerge action fail at their own lines', async (t) => {
  const dir = checkout(t, FAILING);

  const { code, stdout, stderr } = await scan(dir, ['--format', 'json']);
  assert.equal(stderr, '');
  assert.equal(code, 1, 'an error finding fails the default threshold');
  const report = JSON.parse(stdout);
  assert.deepEqual(report.summary, { error: 2, warn: 0, info: 1, pass: 0, skip: 0, verdict: 'fail' });
  assert.deepEqual(
    report.findings.map((finding) => [finding.status, finding.code, finding.path, finding.line]),
    [
      ['fail', 'bot-config-present', undefined, undefined],
      ['fail', 'automerge-for-bot', '.github/workflows/automerge.yml', 8],
      ['fail', 'automerge-for-bot', '.github/workflows/automerge.yml', 14],
    ],
  );
  assert.deepEqual(
    report.findings.map((finding) => finding.message),
    [
      'automated updates configured (.github/dependabot.yml); an update is merged by a person after reading the diff and running the gate',
      'job "dependabot" runs gh pr merge for a bot actor; an update is merged by a person after reading the diff and running the gate',
      'job "enable" runs an automerge action for a bot actor; an update is merged by a person after reading the diff and running the gate',
    ],
  );

  // The line is a line of that file: 8 is the `run:` of the merge step, and 14 is the step's own
  // `- name:` — the automerge action is one line below the line the finding names.
  const written = readFileSync(join(dir, '.github/workflows/automerge.yml'), 'utf8').split('\n');
  assert.equal(written[7], '      - run: gh pr merge --auto --squash');
  assert.equal(written[13], '      - name: enable automerge');
  assert.equal(written[14], '        uses: pascalgn/automerge-action@v0.16.3');
});

/// Side two: it passes, and the pass is counted rather than merely absent.

test('side two: the clean shape passes, and both bot config files are one counted pass', async (t) => {
  const dir = checkout(t, {
    '.github/dependabot.yml': 'version: 2\nupdates: []\n',
    '.github/renovate.json': '{ "extends": ["config:recommended"] }\n',
    '.github/workflows/ci.yml': CLEAN,
  });

  const { code, stdout } = await scan(dir, ['--format', 'json']);
  const report = JSON.parse(stdout);
  assert.equal(code, 0, 'an info finding never fails the default threshold');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 1, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(
    report.findings.map((finding) => [finding.status, finding.code, finding.severity]),
    [['fail', 'bot-config-present', 'info']],
    'the signal is the info finding the spec asks for, and it is listed',
  );

  const human = await scan(dir);
  assert.match(human.stdout, /^summary {2}0 errors · 0 warnings · 1 info · 0 passing · 0 skipped$/m);
  assert.match(human.stdout, /ℹ {2}Bot auto-merge/);

  // The page's sentence: the configuration signal is one finding for the set, never one per file.
  const [configuration] = rule.detect(
    context({ botFiles: ['.github/dependabot.yml', '.github/renovate.json'] }),
  );
  assert.equal(configuration.status, 'fail');
  assert.equal(configuration.code, 'bot-config-present');
  assert.deepEqual(configuration.evidence, {
    files: ['.github/dependabot.yml', '.github/renovate.json'],
    botConfig: true,
  });

  // The limit the page states: a checkout whose ref is computed from an environment variable is
  // neither of the two spellings, so the rule passes rather than guessing that it is not the head.
  const [computed] = rule.detect(
    context({
      workflows: [
        workflow('.github/workflows/pr-target.yml', [
          'name: pr target',
          'on:',
          '  pull_request_target:',
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
          '        with:',
          '          ref: ${{ env.PR_REF }}',
        ]),
      ],
    }),
  );
  assert.equal(computed.status, 'pass');
  assert.equal(computed.code, 'no-automerge-path');
});

test('one report carries the info signal and an error, which is what the state table would have thrown on', async (t) => {
  // The mechanism, not only the signal: `findingSeverity` selects per rule, so a repo with both a
  // bot configuration and a bot merge path makes the rule emit one finding of each severity in the
  // same report. A missing selecting key would throw here rather than in a reader's scan.
  const dir = checkout(t, {
    '.github/dependabot.yml': 'version: 2\nupdates: []\n',
    '.github/workflows/automerge.yml': [
      'name: automerge',
      'on: pull_request',
      'jobs:',
      '  dependabot:',
      '    runs-on: ubuntu-latest',
      "    if: github.actor == 'dependabot[bot]'",
      '    steps:',
      '      - run: gh pr merge --auto --squash',
    ].join('\n'),
  });

  const { code, stdout, stderr } = await scan(dir, ['--format', 'json']);
  assert.equal(stderr, '', 'the state table did not throw');
  assert.equal(code, 1, 'the error finding decides the exit code');
  const report = JSON.parse(stdout);
  assert.deepEqual(report.summary, { error: 1, warn: 0, info: 1, pass: 0, skip: 0, verdict: 'fail' });
  assert.deepEqual(
    report.findings.map((finding) => [finding.code, finding.severity]),
    [
      ['bot-config-present', 'info'],
      ['automerge-for-bot', 'error'],
    ],
  );
});

test('the threshold is the only thing between the info signal and the exit code', async (t) => {
  const dir = checkout(t, { '.github/dependabot.yml': 'version: 2\nupdates: []\n' });

  const byDefault = await scan(dir, ['--format', 'json']);
  assert.equal(byDefault.code, 0, 'info is under the default threshold');
  assert.equal(JSON.parse(byDefault.stdout).summary.info, 1);

  const atInfo = await scan(dir, ['--fail-on', 'info', '--format', 'json']);
  assert.equal(atInfo.code, 1, '--fail-on info makes the signal fail the run');
  assert.equal(JSON.parse(atInfo.stdout).summary.verdict, 'fail');

  const atError = await scan(dir, ['--fail-on', 'error', '--format', 'json']);
  assert.equal(atError.code, 0);
});

/// Side three: it skips for want of a fact, with every code it can emit reached by a run.

test('side three: an unparseable workflow and an excluded repository are the two skips', async (t) => {
  const broken = checkout(t, {
    '.github/dependabot.yml': 'version: 2\nupdates: []\n',
    '.github/workflows/broken.yml': UNPARSEABLE,
  });

  const { code, stdout } = await scan(broken, ['--format', 'json']);
  const report = JSON.parse(stdout);
  assert.equal(code, 0, 'a skip is not a failure');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  const [skipped] = report.findings;
  assert.equal(skipped.status, 'skip');
  assert.equal(skipped.code, 'unparseable-workflow');
  assert.equal(skipped.path, '.github/workflows/broken.yml');
  assert.equal(
    skipped.message,
    'skipped: unparseable workflow — merge key at line 5 is not supported',
    'the message names the fact the reader could not get, not the file alone',
  );
  assert.deepEqual(skipped.remediation, { kind: 'none' }, 'a skip hands nobody a command');

  const excluded = await cli(broken, [
    'scan', '--scope', 'machine', '--only', 'no-bot-auto-merge', '--format', 'json',
  ]);
  const [outOfScope] = JSON.parse(excluded.stdout).findings;
  assert.equal(excluded.code, 0);
  assert.deepEqual(
    [outOfScope.status, outOfScope.code, outOfScope.message],
    ['skip', 'no-repo', 'skipped: the repository was excluded by --scope machine'],
  );
});

/// Side four: off by policy — `starter` is the preset that turns it off, and it leaves no count.

test('side four: starter is the off switch, and a veto leaves neither a finding nor a count', async (t) => {
  const dir = checkout(t, FAILING);

  for (const preset of ['baseline', 'strict']) {
    const report = JSON.parse((await scan(dir, ['--preset', preset, '--format', 'json'])).stdout);
    assert.equal(report.summary.error, 2, `${preset}: the rule runs and its two findings survive`);
  }

  const off = await scan(dir, ['--preset', 'starter', '--format', 'json']);
  const report = JSON.parse(off.stdout);
  assert.equal(off.code, 0, 'a rule the policy turned off cannot fail the run');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings, [], 'off by policy leaves neither a finding nor a count');
  assert.match(
    (await scan(dir, ['--preset', 'starter'])).stdout.replace(/\s+/g, ' '),
    /off by policy: .*Bot auto-merge/,
    'the human report says who turned it off',
  );

  const ignored = JSON.parse(
    (await scan(dir, ['--ignore', 'no-bot-auto-merge', '--format', 'json'])).stdout,
  );
  assert.deepEqual(ignored.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(ignored.findings, []);
});

/// Obligation one of `S4`: the printed remediation is true — the line it names is the step to
/// delete, and deleting it clears the finding that printed it.

test('obligation: the printed edit, applied at the printed line, clears every finding', async (t) => {
  const dir = checkout(t, FAILING);

  const before = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.equal(before.summary.error, 2);

  // The configuration finding names no line: there is nothing to delete, so the loop walks the two
  // merge-path findings that do.
  const edits = before.findings.filter((finding) => finding.line !== undefined);
  assert.equal(edits.length, 2, 'the fixture has two editable findings');
  for (const finding of [...edits].sort((a, b) => b.line - a.line)) {
    assert.equal(finding.remediation.kind, 'manual', 'no command deletes a step from a workflow');
    const named = new RegExp(
      '^edit (.+):(\\d+) and delete the (?:automatic merge|automerge action) step$',
    ).exec(finding.remediation.command);
    assert.ok(named, `${finding.remediation.command} names no file and line to edit`);
    assert.equal(named[1], finding.path, 'the command names the file the finding names');
    assert.equal(Number(named[2]), finding.line, 'and the line the finding names');
    deleteStepAt(dir, named[1], Number(named[2]));
  }

  const after = await scan(dir, ['--format', 'json']);
  const report = JSON.parse(after.stdout);
  assert.equal(after.code, 0, 'the edit the finding printed clears the finding');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 1, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ['bot-config-present'],
    'deleting the merge steps leaves the configuration signal, which was never an error',
  );
});

/// Obligation two of `S4`: the two formats agree on count, path, line and message. The human
/// renderer never prints `finding.code`, so no code is compared here.

test('obligation: both formats count, locate and word every finding the same way', async (t) => {
  const shapes = [
    ['fail', FAILING],
    ['skip', { '.github/workflows/broken.yml': UNPARSEABLE }],
  ];

  for (const [shape, files] of shapes) {
    const dir = checkout(t, files);
    const json = await scan(dir, ['--format', 'json']);
    const human = await scan(dir);
    const report = JSON.parse(json.stdout);

    assert.equal(human.code, json.code, `${shape}: the same flags decide the same verdict`);
    const counts =
      /^summary {2}(\d+) errors? · (\d+) warnings? · (\d+) info · (\d+) passing · (\d+) skipped$/m.exec(
        human.stdout,
      );
    assert.ok(counts !== null, `${shape}: the human report printed no summary line:\n${human.stdout}`);
    assert.deepEqual(
      counts.slice(1).map(Number),
      [report.summary.error, report.summary.warn, report.summary.info, report.summary.pass, report.summary.skip],
      `${shape}: the two formats count the same`,
    );

    const flat = human.stdout.replace(/\s+/g, ' ');
    for (const finding of report.findings) {
      if (finding.path !== undefined) {
        assert.ok(flat.includes(finding.path), `${shape}: the human report does not name ${finding.path}`);
      }
      if (finding.line !== undefined) {
        assert.ok(
          flat.includes(`${finding.path}:${finding.line}`),
          `${shape}: the human report does not locate ${finding.path}:${finding.line}`,
        );
      }
      assert.ok(flat.includes(finding.message), `${shape}: the human report carries another message`);
      if (finding.remediation.command === undefined) {
        assert.deepEqual(finding.remediation, { kind: 'none' }, `${shape}: a finding with no command`);
      } else {
        assert.ok(flat.includes(finding.remediation.command), `${shape}: the human report carries another command`);
      }
      assert.equal(
        human.stdout.includes(finding.code),
        false,
        `${shape}: the human report printed the code ${finding.code}`,
      );
    }
  }
});

/// The measured set (8.2 R9, 0039): the configuration is read where the tool that owns it reads it,
/// and presence is the whole signal. Every case below drives the binary, because the rule test builds
/// its facts by hand and can see neither whether `repoFacts` finds a spelling nor whether it throws
/// over a manifest it could not parse.

/** The sentence every configuration finding ends with, so a message is compared whole. */
const RULE_SENTENCE = 'an update is merged by a person after reading the diff and running the gate';

test('side two: a root renovate.json is the info finding the .github spelling gives (0039)', async (t) => {
  const dir = checkout(t, {
    'package.json': JSON.stringify({ name: 'root' }),
    'renovate.json': '{ "automerge": true }\n',
  });

  const { code, stdout, stderr } = await scan(dir, ['--format', 'json']);
  assert.equal(stderr, '');
  assert.equal(code, 0, 'an info finding never fails the default threshold');
  const report = JSON.parse(stdout);
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 1, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings.map((finding) => [finding.code, finding.severity]), [
    ['bot-config-present', 'info'],
  ]);
  assert.equal(
    report.findings[0].message,
    `automated updates configured (renovate.json); ${RULE_SENTENCE}`,
    'the message names the file that was found',
  );
});

test('side two: the manifest key is named package.json#renovate, not package.json (0039)', async (t) => {
  const dir = checkout(t, {
    'package.json': JSON.stringify({ name: 'root', renovate: { extends: ['config:recommended'] } }),
  });

  const { code, stdout } = await scan(dir, ['--format', 'json']);
  assert.equal(code, 0);
  const [finding] = JSON.parse(stdout).findings;
  assert.equal(finding.code, 'bot-config-present');
  assert.deepEqual(finding.evidence.files, ['package.json#renovate']);
  assert.equal(
    finding.message,
    `automated updates configured (package.json#renovate); ${RULE_SENTENCE}`,
    'the manifest alone is not a configuration, so the message names the key that fired',
  );
});

test('side two: what the configuration file says never moves the finding (0039)', async (t) => {
  // The spec's sentence: v0.1 does not judge the tool, only the merge path. So a bare file, a file
  // that enables automerge and a file that disables the tool are one `info`, worded the same way.
  for (const text of ['', '{ "automerge": true }\n', '{ "enabled": false }\n']) {
    const dir = checkout(t, {
      'package.json': JSON.stringify({ name: 'root' }),
      'renovate.json': text,
    });

    const report = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);

    assert.deepEqual(
      report.findings.map((finding) => [finding.code, finding.severity, finding.message]),
      [['bot-config-present', 'info', `automated updates configured (renovate.json); ${RULE_SENTENCE}`]],
      `a file reading ${JSON.stringify(text)} is the same finding`,
    );
  }
});

test('side two: three configurations at once are one finding naming all three (0039)', async (t) => {
  const dir = checkout(t, {
    'package.json': JSON.stringify({ name: 'root', renovate: {} }),
    'renovate.json': '{}\n',
    '.gitlab/renovate.json5': '{}\n',
  });

  const { code, stdout } = await scan(dir, ['--format', 'json']);
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.findings.length, 1, 'one finding for the configuration as a whole, never one per file');
  const [finding] = report.findings;
  assert.equal(finding.code, 'bot-config-present');
  assert.deepEqual(finding.evidence.files, ['renovate.json', '.gitlab/renovate.json5', 'package.json#renovate']);
  assert.equal(
    finding.message,
    'automated updates configured (renovate.json, .gitlab/renovate.json5, package.json#renovate); ' +
      RULE_SENTENCE,
  );
});

test('side two: a repository with none of them carries an empty botFiles and passes (0039)', async (t) => {
  const dir = checkout(t, { 'package.json': JSON.stringify({ name: 'root' }), 'README.md': '# root\n' });

  const { code, stdout } = await scan(dir, ['--format', 'json']);
  const report = JSON.parse(stdout);
  assert.equal(code, 0);
  assert.deepEqual(
    report.summary,
    { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
    'the empty botFiles leaves one pass, so the rule ran and found nothing configured',
  );
  // The JSON document carries no passing finding (10.2), so the count is where the pass is read.
  assert.deepEqual(report.findings, []);
  assert.match((await scan(dir)).stdout, /^summary {2}0 errors · 0 warnings · 0 info · 1 passing · 0 skipped$/m);
});
