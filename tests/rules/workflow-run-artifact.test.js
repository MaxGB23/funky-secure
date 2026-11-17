/**
 * `workflow-run-artifact` (RFC 0035, spec 8.2 R13).
 *
 * The pair issue #153 measured is the fixture: `pr-build.yml` is an unprivileged `pull_request`
 * workflow that uploads an artifact, and `label.yml` is a `workflow_run` workflow with
 * `contents: write` that downloads it by `github.event.workflow_run.id`. The other cases remove one
 * leg of that pair at a time, because each leg is what a reader edits to clear the finding, and a
 * rule that cannot say which leg it read is a rule that guessed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '../../src/cli.js';
import rule from '../../src/rules/workflow-run-artifact.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @param {...string} parts */
function fixture(...parts) {
  return readFileSync(join(HERE, '..', 'fixtures', ...parts), 'utf8');
}

/** Issue #153's two files, unmodified, as the repository carries them. */
const PR_BUILD = fixture('workflows', 'workflow-run-pair', 'pr-build.yml');
const LABEL = fixture('workflows', 'workflow-run-pair', 'label.yml');

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
    policy: { preset: 'baseline', failOn: 'error' },
    severity: () => 'error',
  };
}

/** @param {string} text @param {string} name */
function workflow(text, name = 'label.yml') {
  return { path: `.github/workflows/${name}`, text };
}

/**
 * The 1-based line a workflow writes `needle` on, so a test never restates a line number the fixture
 * already decides.
 * @param {string} text @param {string} needle
 */
function lineOf(text, needle) {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  assert.notEqual(index, -1, `the fixture never writes ${needle}`);
  return index + 1;
}

const RUN_ID = '${{ github.event.workflow_run.id }}';
const PRODUCER = workflow(PR_BUILD, 'pr-build.yml');

test('fails on issue #153 pair, at the step that downloads the artifact', () => {
  const findings = rule.detect(context({ workflows: [PRODUCER, workflow(LABEL)] }));

  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'workflow-run-artifact');
  assert.equal(finding.path, '.github/workflows/label.yml');
  assert.equal(finding.line, lineOf(LABEL, 'actions/download-artifact@'));

  // The evidence is what a reader needs to find the other half of the pair.
  assert.equal(finding.evidence.job, 'label');
  assert.equal(finding.evidence.producerPath, '.github/workflows/pr-build.yml');
  assert.equal(finding.evidence.producerName, 'pr build');
  assert.equal(finding.evidence.producerTrigger, 'pull_request');
  assert.equal(finding.evidence.downloadKind, 'uses');
  assert.match(finding.evidence.download, /^actions\/download-artifact@/);
  assert.deepEqual(finding.evidence.scopes, ['contents', 'pull-requests']);

  assert.match(finding.message, /pr build/);
  assert.match(finding.message, /pull_request/);
  assert.match(finding.message, /artifact/);
  assert.equal(finding.remediation.kind, 'manual');
  assert.match(finding.remediation.command, /artifact/);
});

test('reads the run-id expression as the download, without an actions/download-artifact step', () => {
  const consumer = `name: label
on:
  workflow_run:
    workflows: ["pr build"]
    types: [completed]
permissions: { contents: write }
jobs:
  label:
    runs-on: ubuntu-24.04
    steps:
      - uses: my-org/fetch-run@${'a'.repeat(40)}
        with:
          run-id: ${RUN_ID}
`;
  const findings = rule.detect(context({ workflows: [PRODUCER, workflow(consumer)] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].evidence.downloadKind, 'run-id');
  assert.equal(findings[0].evidence.download, RUN_ID);
  assert.equal(findings[0].line, lineOf(consumer, 'my-org/fetch-run@'));
});

test('reads a write at job level, and a job that narrows the workflow grant holds none', () => {
  const consumer = (permissions) => `name: label
on:
  workflow_run:
    workflows: ["pr build"]
    types: [completed]
permissions: { contents: read }
jobs:
  label:
    runs-on: ubuntu-24.04
${permissions}
    steps:
      - uses: actions/download-artifact@${'b'.repeat(40)}
        with:
          run-id: ${RUN_ID}
`;
  const narrowed = rule.detect(
    context({ workflows: [PRODUCER, workflow(consumer('    permissions: { contents: read }'))] }),
  );
  assert.equal(narrowed[0].status, 'pass');
  assert.equal(narrowed[0].code, 'no-write-permission');

  const granted = rule.detect(
    context({ workflows: [PRODUCER, workflow(consumer('    permissions: { issues: write }'))] }),
  );
  assert.equal(granted[0].status, 'fail');
  assert.deepEqual(granted[0].evidence.scopes, ['issues']);
});

test('passes when the consumer downloads nothing', () => {
  const noDownload = `name: label
on:
  workflow_run:
    workflows: ["pr build"]
    types: [completed]
permissions: { contents: write, pull-requests: write }
jobs:
  label:
    runs-on: ubuntu-24.04
    steps:
      - run: gh pr comment 7 -F out.txt
`;
  const findings = rule.detect(context({ workflows: [PRODUCER, workflow(noDownload)] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'workflow-run-without-artifact');
});

test('passes when the artifact step holds no write scope', () => {
  const readOnly = LABEL.replace(
    'permissions: { contents: write, actions: read, pull-requests: write }',
    'permissions: { contents: read, actions: read }',
  );
  assert.notEqual(readOnly, LABEL, 'the fixture no longer carries the write it is about');

  const findings = rule.detect(context({ workflows: [PRODUCER, workflow(readOnly)] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'no-write-permission');
  assert.match(findings[0].message, /write/);
});

test('passes when the resolved producer declares push instead of pull_request', () => {
  const producer = PR_BUILD.replace('on: pull_request', 'on: push');
  assert.notEqual(producer, PR_BUILD, 'the fixture no longer declares pull_request');

  const findings = rule.detect(
    context({ workflows: [workflow(producer, 'pr-build.yml'), workflow(LABEL)] }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'trusted-producer');
  assert.match(findings[0].message, /push|does not/);
});

test('skips when no workflow carries the name the trigger names', () => {
  const producer = PR_BUILD.replace('name: pr build', 'name: build the pull request');

  const findings = rule.detect(
    context({ workflows: [workflow(producer, 'pr-build.yml'), workflow(LABEL)] }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'skip');
  assert.equal(findings[0].code, 'producer-unresolved-name');
  assert.match(findings[0].message, /pr build/);
  assert.equal(findings[0].path, '.github/workflows/label.yml');
});

/// GitHub matches `on.workflow_run.workflows` by `name:` across the whole repository, so a name two
/// files carry names no producer at all. Resolving one of them would make the answer depend on which
/// file sorts first, and resolving the trusted one turns a real escalation green.

/** A producer file under the given trigger, named `build` like the consumer below. */
function producerFile(trigger, name) {
  const lines = ['name: build', `on: ${trigger}`];
  lines.push('jobs:', '  build:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: npm test', '');
  return workflow(lines.join('\n'), name);
}

const DUPLICATE_CONSUMER = `name: build
on:
  workflow_run:
    workflows: ["build"]
    types: [completed]
permissions: { contents: write }
jobs:
  label:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@${'d'.repeat(40)}
        with:
          run-id: ${RUN_ID}
`;

test('a workflow name more than one file carries is unresolved, never the first in path order', () => {
  const consumer = workflow(DUPLICATE_CONSUMER, 'label.yml');
  const push = producerFile('push', 'a-build.yml');
  const pull = producerFile('pull_request', 'z-build.yml');

  // Two files carry the name, so the rule cannot say which one produced the artifact.
  const pair = rule.detect(context({ workflows: [consumer, pull] }));
  assert.equal(pair.length, 1);
  assert.equal(pair[0].status, 'skip');
  assert.equal(pair[0].code, 'producer-unresolved-name');
  assert.match(pair[0].message, /more than one workflow/);

  // Three files, two of them producers, answer the same whichever order the collector hands them in,
  // and the message names them in path order.
  const forwards = rule.detect(context({ workflows: [consumer, push, pull] }));
  const backwards = rule.detect(context({ workflows: [consumer, pull, push] }));
  for (const findings of [forwards, backwards]) {
    assert.equal(findings.length, 1);
    assert.equal(findings[0].status, 'skip');
    assert.equal(findings[0].code, 'producer-unresolved-name');
  }
  assert.equal(forwards[0].message, backwards[0].message);
  const first = forwards[0].message.indexOf('a-build.yml');
  const second = forwards[0].message.indexOf('z-build.yml');
  assert.notEqual(first, -1, 'the message names the files that share the name');
  assert.ok(second > first, 'the message names them in path order');
});

test('skips a trigger block the reader does not model instead of guessing at its names', () => {
  const flow = `name: label
on: {workflow_run: {}}
permissions: { contents: write }
jobs:
  label:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@${'c'.repeat(40)}
`;
  const findings = rule.detect(context({ workflows: [PRODUCER, workflow(flow)] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'skip');
  assert.equal(findings[0].code, 'producer-unresolved-trigger');
});

test('skips a producer list the reader reports as null, and one the trigger does not name', () => {
  const unreadable = LABEL.replace('workflows: ["pr build"]', 'workflows: { name: pr build }');
  assert.notEqual(unreadable, LABEL, 'the fixture no longer carries a list of names');
  const byNull = rule.detect(context({ workflows: [PRODUCER, workflow(unreadable)] }));
  assert.equal(byNull[0].status, 'skip');
  assert.equal(byNull[0].code, 'producer-unresolved-config');

  const unnamed = LABEL.replace('    workflows: ["pr build"]\n', '');
  assert.notEqual(unnamed, LABEL, 'the fixture still names a producer');
  const byAbsence = rule.detect(context({ workflows: [PRODUCER, workflow(unnamed)] }));
  assert.equal(byAbsence[0].status, 'skip');
  assert.equal(byAbsence[0].code, 'producer-unresolved-config');
});

test('passes a repository that never declares workflow_run', () => {
  const findings = rule.detect(context({ workflows: [PRODUCER] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'no-workflow-run');
});

test('skips instead of passing when the fact it would read is absent', () => {
  assert.equal(rule.detect({ policy: {}, severity: () => 'error' })[0].code, 'no-repo');
  assert.equal(rule.detect(context({}))[0].code, 'no-ci');

  const unparseable = rule.detect(context({ workflows: [workflow('jobs: [oops\n')] }));
  assert.equal(unparseable[0].status, 'skip');
  assert.equal(unparseable[0].code, 'unparseable-workflow');
});

/// The write the finding rests on is any permission whose value is `write`, not three of them. The
/// first real-repository measurement found the narrower test answering `pass / no-write-permission`
/// over `vercel/next.js`, which builds a fork's tarballs on `pull_request` and uploads them to a
/// storage service under `id-token: write` minted for that run.

/** A consumer whose governing declaration is the argument, shaped like the pair it must fail on. */
function consumerWith(permissions, name = 'label.yml') {
  return workflow(
    `name: label
on:
  workflow_run:
    workflows: ["pr build"]
    types: [completed]
${permissions}
jobs:
  label:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@${'e'.repeat(40)}
        with:
          run-id: ${RUN_ID}
`,
    name,
  );
}

test('names every write scope the governing declaration holds, in catalog order', () => {
  const findings = rule.detect(
    context({
      workflows: [
        PRODUCER,
        consumerWith(
          'permissions: { contents: read, actions: read, checks: write, issues: write, pull-requests: write }',
        ),
      ],
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.deepEqual(findings[0].evidence.scopes, ['checks', 'issues', 'pull-requests']);
  assert.match(findings[0].message, /checks: write, issues: write, pull-requests: write/);
  assert.doesNotMatch(findings[0].message, /contents/);
});

test('fails on an id-token: write consumer, and the message names that scope', () => {
  const findings = rule.detect(
    context({
      workflows: [PRODUCER, consumerWith('permissions: { actions: read, contents: read, id-token: write }')],
    }),
  );

  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'workflow-run-artifact');
  assert.notEqual(finding.code, 'no-write-permission');
  assert.deepEqual(finding.evidence.scopes, ['id-token']);
  assert.match(finding.message, /id-token: write/);
  assert.doesNotMatch(finding.message, /no write scope/);
});

test('fails on a consumer that holds checks: write alone, and names it', () => {
  const findings = rule.detect(
    context({ workflows: [PRODUCER, consumerWith('permissions: { checks: write }')] }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.deepEqual(findings[0].evidence.scopes, ['checks']);
  assert.match(findings[0].message, /checks: write/);
});

test('a read-only declaration is still no-write-permission, and the message claims no scope', () => {
  const findings = rule.detect(
    context({
      workflows: [
        PRODUCER,
        consumerWith('permissions: { actions: read, checks: read, contents: read, id-token: read }'),
      ],
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'no-write-permission');
  assert.match(findings[0].message, /grants no write scope/);
  assert.doesNotMatch(findings[0].message, /id-token|checks:/);
});

test('a job-level contents: read over a workflow-level write-all still holds no write', () => {
  const consumer = `name: label
on:
  workflow_run:
    workflows: ["pr build"]
    types: [completed]
permissions: write-all
jobs:
  label:
    runs-on: ubuntu-24.04
    permissions: { contents: read }
    steps:
      - uses: actions/download-artifact@${'f'.repeat(40)}
        with:
          run-id: ${RUN_ID}
`;
  const findings = rule.detect(context({ workflows: [PRODUCER, workflow(consumer)] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'no-write-permission');
});

/// The four repositories the first real measurement read, in `tests/fixtures/workflows/real/`. Every
/// consumer file is the repository's own bytes, because the consumer is what the finding is about; the
/// two producers too large to vendor (pnpm's 1222-line benchmark workflow, next's 827-line deploy
/// workflow) are elided to the name and the trigger R13 resolves them by, and each says so at the top
/// with its blob sha. A fixture that drifts from its repository shows up here, not in a release note.

test('fails on the pair pnpm, node and next each carry, as the repository writes it', () => {
  const pairs = [
    {
      repository: 'pnpm/pnpm',
      files: ['pacquet-integrated-benchmark.yml', 'pacquet-integrated-benchmark-comment.yml'],
      consumer: 'pacquet-integrated-benchmark-comment.yml',
      producer: 'pacquet-integrated-benchmark.yml',
      download: 'actions/download-artifact@',
      scopes: ['checks', 'issues', 'pull-requests'],
    },
    {
      repository: 'nodejs/node',
      files: ['nix-changes.yml', 'nix-changes-comment.yml'],
      consumer: 'nix-changes-comment.yml',
      producer: 'nix-changes.yml',
      download: 'actions/download-artifact@',
      scopes: ['pull-requests', 'statuses'],
    },
    {
      repository: 'vercel/next.js',
      files: ['build_and_deploy.yml', 'upload_preview_tarballs.yml'],
      consumer: 'upload_preview_tarballs.yml',
      producer: 'build_and_deploy.yml',
      download: 'actions/download-artifact@',
      scopes: ['id-token'],
    },
  ];

  for (const pair of pairs) {
    const workflows = pair.files.map((name) =>
      workflow(fixture('workflows', 'real', name), name),
    );
    const findings = rule.detect(context({ workflows }));

    assert.equal(findings.length, 1, `${pair.repository} is one finding and not ${findings.length}`);
    const [finding] = findings;
    assert.equal(finding.status, 'fail', `${pair.repository} answered ${finding.status} / ${finding.code}`);
    assert.equal(finding.code, 'workflow-run-artifact');
    assert.equal(finding.path, `.github/workflows/${pair.consumer}`);
    const text = fixture('workflows', 'real', pair.consumer).split('\n');
    const start = finding.line - 1;
    // The finding is reported at the first line of the step, which a reader edits; its `uses` is the
    // line directly below it here, and the fixture decides it rather than this test.
    assert.match(text[start], /^\s*- /, `${pair.repository}: the finding is not at a step's first line`);
    const step = text.slice(start, start + 9).join('\n');
    assert.ok(step.includes(pair.download), `${pair.repository}: the step at the line does not download`);
    assert.equal(finding.evidence.producerPath, `.github/workflows/${pair.producer}`);
    assert.deepEqual(finding.evidence.scopes, pair.scopes);
    for (const scope of pair.scopes) {
      assert.match(finding.message, new RegExp(`${scope}: write`));
    }
  }
});

test('the catalog entry declares its identity, severity and page', () => {
  assert.equal(rule.id, 'workflow-run-artifact');
  assert.equal(rule.label, 'Workflow run artifact');
  assert.equal(rule.scope.includes('repo'), true);
  assert.deepEqual(rule.targets, ['ci']);
  assert.deepEqual(rule.severity, { baseline: 'error', strict: 'error' });
  assert.equal(rule.friction, 1);
  assert.equal(rule.docs, 'docs/rules/workflow-run-artifact.md');
  assert.equal(typeof rule.detect, 'function');
  assert.doesNotMatch(`${rule.title} ${rule.question} ${rule.detection}`, /[^\x20-\x7e\n]/);
});

/// The four sides of `S3` and the three obligations of `S4`, driven through the binary over
/// repositories built at run time (`S5`). The failing side is issue #153's pair: the bytes are the
/// fixture this repository carries, the directory is fresh. Nothing here needs a probe — the rule
/// reads files — so no side depends on the machine, and the child environment is scrubbed of `CI`
/// and every `npm_config_*` regardless.

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
  return cli(dir, ['scan', '--scope', 'repo', '--only', 'workflow-run-artifact', ...argv]);
}

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-workflow-run-artifact-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A repository whose `.github/workflows` holds exactly `files`, or no directory at all for `null`. */
function repoWith(t, files) {
  const dir = scratch(t);
  if (files !== null) {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, '.github', 'workflows', name), text);
    }
  }
  return dir;
}

/** Issue #153's pair, as the two files a repository carries. */
function pair(t, lab = LABEL, pr = PR_BUILD) {
  return repoWith(t, { 'pr-build.yml': pr, 'label.yml': lab });
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

/** The 1-based lines `needle` is written on, so a test never restates what the fixture decides. */
function linesOf(text, needle) {
  const found = text
    .split('\n')
    .map((line, index) => (line.includes(needle) ? index + 1 : 0))
    .filter((line) => line !== 0);
  assert.notEqual(found.length, 0, `the fixture never writes ${needle}`);
  return found;
}

/** The lines `after` no longer carries, as a multiset difference: exactly what an edit removed. */
function removed(before, after) {
  const pool = new Map();
  for (const line of after.split('\n')) pool.set(line, (pool.get(line) ?? 0) + 1);
  const gone = [];
  for (const line of before.split('\n')) {
    const left = pool.get(line) ?? 0;
    if (left > 0) pool.set(line, left - 1);
    else gone.push(line);
  }
  return gone;
}

/// Side one: it fails, at the step line the finding names, once per downloading step.

test('side one: issue #153 pair fails at the step line, one finding per downloading step', async (t) => {
  const dir = pair(t);
  const path = join(dir, '.github', 'workflows', 'label.yml');
  const before = readFileSync(path, 'utf8');

  const json = await scan(dir, ['--format', 'json']);
  assert.equal(json.stderr, '');
  assert.equal(json.code, 1, 'an error above the default `error` threshold is a failing run');
  const report = JSON.parse(json.stdout);
  assert.deepEqual(report.summary, { error: 1, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  assert.deepEqual(projection(report), [
    ['fail', 'workflow-run-artifact', 'ci', '.github/workflows/label.yml', linesOf(LABEL, 'actions/download-artifact@')[0]],
  ]);

  const [finding] = report.findings;
  assert.equal(finding.severity, 'error');
  assert.equal(
    finding.message,
    'job "label" downloads an artifact produced by "pr build", which declares pull_request, and the job holds contents: write, pull-requests: write: bytes a fork can write reach this repository\'s write token',
  );
  assert.deepEqual(finding.evidence, {
    job: 'label',
    step: 0,
    producerPath: '.github/workflows/pr-build.yml',
    producerName: 'pr build',
    producerTrigger: 'pull_request',
    downloadKind: 'uses',
    download: 'actions/download-artifact@65a9edc1b2d3e4f5061728394a5b6c7d8e9f0a1b',
    scopes: ['contents', 'pull-requests'],
  });
  assert.equal(readFileSync(path, 'utf8'), before, 'a scan is read-only');

  // A second download in the same job is a second finding, at its own step line.
  const twice = LABEL.replace(
    '      - run: gh pr comment',
    `      - uses: actions/download-artifact@${'a'.repeat(40)}\n      - run: gh pr comment`,
  );
  const two = JSON.parse((await scan(pair(t, twice), ['--format', 'json'])).stdout);
  assert.deepEqual(
    two.findings.map((entry) => entry.line).sort((a, b) => a - b),
    linesOf(twice, 'actions/download-artifact@'),
  );
});

/// Side two: it passes, and the pass is a count in both formats rather than an absent row.

test('side two: the t3-create-t3-app shape is one counted pass, not an absent finding', async (t) => {
  // The shape `t3-create-t3-app` carries: a `workflow_run` consumer that lists the run's artifacts
  // through the API inside a `script:`, so no step's `uses` or `with.run-id` is a download the reader
  // models. Measured on the clone, `scan --scope repo --only workflow-run-artifact --format json`
  // answers `summary.pass = 1`, `findings: []`, exit 0 — the pass is the count, and the code behind
  // it (`workflow-run-without-artifact`) is printed by neither format.
  const consumer = `name: Write Beta Release comment
on:
  workflow_run:
    workflows: ["Release - Beta"]
    types:
      - completed
jobs:
  comment:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@${'a'.repeat(40)}
        with:
          script: |
            github.rest.actions.listWorkflowRunArtifacts({ run_id: context.payload.workflow_run.id })
`;
  const producer = `name: Release - Beta
on:
  pull_request:
    types: [labeled]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: npm publish
`;
  const readOnly = LABEL.replace(
    'permissions: { contents: write, actions: read, pull-requests: write }',
    'permissions: { contents: read, actions: read }',
  );
  assert.notEqual(readOnly, LABEL, 'the fixture no longer carries the write it is about');

  const shapes = [
    ['t3-create-t3-app', { 'prerelease.yml': producer, 'prerelease-comment.yml': consumer }],
    ['a read-only download', { 'pr-build.yml': PR_BUILD, 'label.yml': readOnly }],
  ];
  for (const [name, files] of shapes) {
    const dir = repoWith(t, files);
    const json = await scan(dir, ['--format', 'json']);
    const report = JSON.parse(json.stdout);
    const human = await scan(dir);
    assert.equal(json.code, 0, `${name} is not a failing run`);
    assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' }, `${name} is not one counted pass`);
    assert.deepEqual(report.findings, [], `${name} is a pass, so it is never a row`);
    assert.deepEqual(humanSummary(human.stdout), report.summary, `${name}: the pass is counted in both formats`);
    assert.match(human.stdout, /all 1 rule pass/);
    // The pass code and message reach neither format, so parity for a pass is its count alone.
    for (const code of ['workflow-run-without-artifact', 'no-workflow-run', 'no-write-permission', 'trusted-producer']) {
      assert.equal(`${json.stdout}${human.stdout}`.includes(code), false, `${name}: neither format prints the pass code ${code}`);
    }
  }
});

/// Side three: every skip code this rule can emit, each reached by a run, with its fact named.

test('side three: every skip code names its fact, and no skip is ever counted as a pass', async (t) => {
  const PAIR = { 'pr-build.yml': PR_BUILD, 'label.yml': LABEL };
  const push = PR_BUILD.replace('on: pull_request', 'on:\n  push:');
  const naming = (list) => LABEL.replace('workflows: ["pr build"]', `workflows: ${list}`);
  const named = (trigger) => `name: build\non: ${trigger}\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`;
  const under = (text) => ({ ...PAIR, 'label.yml': text });
  const config = 'skipped: the workflow_run trigger names no workflow in a form the reader can read, so the producer cannot be resolved';

  const cases = [
    ['no-ci', null, 'no-ci', undefined, 'skipped: there is no workflow file, so no workflow can declare a trigger'],
    // Issue #390: the directory exists and holds no workflow file, and that is the same fact, so the
    // skip is the same one — the sentence names the file, which is true in both shapes.
    ['no-ci with an empty workflows directory', {}, 'no-ci', undefined, 'skipped: there is no workflow file, so no workflow can declare a trigger'],
    ['unparseable-workflow', { 'bad.yml': 'jobs: [oops\n' }, 'unparseable-workflow', '.github/workflows/bad.yml', 'skipped: unparseable workflow: "jobs" at line 1 is not a block map'],
    ['a listed name no workflow carries, beside one that resolves', { ...PAIR, 'pr-build.yml': push, 'label.yml': naming('["pr build", "ghost"]') }, 'producer-unresolved-name', '.github/workflows/label.yml', 'skipped: no workflow in the repository carries the name "ghost" the workflow_run trigger names, so the producer cannot be resolved'],
    ['a name two workflows carry', { ...under(naming('["build"]')), 'a-build.yml': named('push'), 'z-build.yml': named('pull_request') }, 'producer-unresolved-name', '.github/workflows/label.yml', 'skipped: the workflow_run trigger names "build", which more than one workflow carries (.github/workflows/a-build.yml, .github/workflows/z-build.yml), so the producer cannot be resolved'],
    ['a trigger block the reader does not model', under(LABEL.replace('on:\n  workflow_run:\n    workflows: ["pr build"]\n    types: [completed]', 'on: {workflow_run: {}}')), 'producer-unresolved-trigger', '.github/workflows/label.yml', 'skipped: the on: block is a flow collection, a form the reader does not model, so the workflows this trigger names cannot be read and the producer cannot be resolved'],
    ['a producer list the reader reports as null', under(naming('{ name: pr build }')), 'producer-unresolved-config', '.github/workflows/label.yml', config],
    ['a trigger that names no workflow', under(LABEL.replace('    workflows: ["pr build"]\n', '')), 'producer-unresolved-config', '.github/workflows/label.yml', config],
  ];

  for (const [name, repoFiles, code, path, message] of cases) {
    const skipped = await scan(repoWith(t, repoFiles), ['--format', 'json']);
    const report = JSON.parse(skipped.stdout);
    assert.equal(skipped.code, 0, `${name}: a skip is not a failure`);
    assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' }, `${name}: one skipped, never a pass`);
    const [finding] = report.findings;
    assert.equal(report.findings.length, 1, `${name}: one skip and nothing else`);
    assert.deepEqual(
      [finding.status, finding.code, finding.path, finding.message, finding.remediation],
      ['skip', code, path, message, { kind: 'none' }],
      `${name}: the code, the location, the fact and the absence of a remediation`,
    );
  }

  const noRepo = JSON.parse((await cli(scratch(t), ['scan', '--scope', 'machine', '--only', 'workflow-run-artifact', '--format', 'json'])).stdout);
  assert.deepEqual(noRepo.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  assert.deepEqual(
    [noRepo.findings[0].code, noRepo.findings[0].message],
    ['no-repo', 'skipped: the repository was excluded by --scope machine'],
  );
});

/// Side four: off by policy — the preset that turns it off, and the flags and config that veto it,
/// each leaving neither a finding nor a count.

test('side four: starter turns the rule off, and --ignore and the config veto it, none leaving a count', async (t) => {
  const dir = pair(t);
  const ZERO = { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' };

  const baseline = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual(baseline.summary, { ...ZERO, error: 1, verdict: 'fail' });
  const strict = JSON.parse((await scan(dir, ['--preset', 'strict', '--format', 'json'])).stdout);
  assert.deepEqual(strict.summary, { ...ZERO, error: 1, verdict: 'fail' }, 'strict does not demote it');
  assert.deepEqual(baseline.findings.map((entry) => entry.severity), strict.findings.map((entry) => entry.severity));

  // The two mechanisms separately: the preset that decides it silently, and the veto a command line or
  // a repository states. Each is run before the next is set up, so no run sees two of them.
  for (const [name, argv] of [
    ['the starter preset', ['--preset', 'starter']],
    ['--ignore', ['--ignore', 'workflow-run-artifact']],
    ['the repository config', []],
  ]) {
    if (name === 'the repository config') {
      writeFileSync(join(dir, 'funky-secure.config.json'), `${JSON.stringify({ rules: { 'workflow-run-artifact': 'off' } }, null, 2)}\n`);
    }
    const human = await scan(dir, argv);
    const report = JSON.parse((await scan(dir, [...argv, '--format', 'json'])).stdout);
    assert.equal(human.code, 0, `${name}: the veto fails no run`);
    assert.deepEqual(report.summary, ZERO, `${name}: the veto leaves neither a finding nor a count`);
    assert.deepEqual(report.findings, [], name);
    assert.deepEqual(humanSummary(human.stdout), ZERO, `${name}: both formats count the same`);
    if (name === 'the starter preset') {
      assert.match(human.stdout.replace(/\s+/g, ' '), /off by policy: .*Workflow run artifact/, 'the preset that decided it is named');
    }
  }

  // An `--only` list that names another rule never reaches this one: no row of this rule at all, and
  // the summary carries only what the named rule answered.
  const other = JSON.parse((await cli(dir, ['scan', '--scope', 'repo', '--only', 'workflow-permissions', '--format', 'json'])).stdout);
  assert.deepEqual(other.findings.filter((entry) => entry.rule === 'workflow-run-artifact'), []);
});

/// `S5`, the promise the page makes about an unresolved producer: a name that resolves to nothing is
/// a skip with its own code. Measured before this test was written: a trigger naming `"pr build"`
/// (resolving, no `pull_request`) and `"ghost"` (resolving to nothing) answered
/// `pass / trusted-producer` with the sentence "every producer the workflow_run trigger names
/// resolves", which is false about `ghost`.

test('a trigger naming a workflow no file carries never passes on the strength of its resolvable sibling', async (t) => {
  const mixed = LABEL.replace('workflows: ["pr build"]', 'workflows: ["pr build", "ghost"]');
  assert.notEqual(mixed, LABEL, 'the fixture no longer carries the producer list');

  const trusted = await scan(pair(t, mixed, PR_BUILD.replace('on: pull_request', 'on:\n  push:')), ['--format', 'json']);
  const report = JSON.parse(trusted.stdout);
  assert.deepEqual(
    report.summary,
    { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' },
    'a name that resolves to nothing is a skip, never a pass',
  );
  assert.equal(report.findings[0].code, 'producer-unresolved-name');
  assert.equal(
    report.findings[0].message,
    'skipped: no workflow in the repository carries the name "ghost" the workflow_run trigger names, so the producer cannot be resolved',
    'the sentence names the name that did not resolve, not the one that did',
  );

  // And the finding the same trigger really carries is still a finding: the skip preempts the
  // `trusted-producer` pass only, because the legs before it never read the producer.
  const untrusted = JSON.parse((await scan(pair(t, mixed), ['--format', 'json'])).stdout);
  assert.deepEqual(untrusted.summary, { error: 1, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  assert.equal(untrusted.findings[0].code, 'workflow-run-artifact');

  // A consumer that holds no write scope reached its answer without resolving the producer, so it is
  // still `no-write-permission`: the pass claims nothing about the trigger, and the skip would hide it.
  const readOnly = mixed.replace(
    'permissions: { contents: write, actions: read, pull-requests: write }',
    'permissions: { contents: read, actions: read }',
  );
  assert.notEqual(readOnly, mixed, 'the fixture no longer carries the write it is about');
  const narrowed = JSON.parse((await scan(pair(t, readOnly, PR_BUILD.replace('on: pull_request', 'on:\n  push:')), ['--format', 'json'])).stdout);
  assert.deepEqual(narrowed.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(narrowed.findings, []);
});

/// `S4`, the remediation: it is `manual`, so there is no command to run — the obligation is that both
/// routes it prints clear the finding, and that neither discards anything the author wrote.

test('obligation: both printed routes clear the finding and change nothing else the author wrote', async (t) => {
  const dir = pair(t);
  const path = join(dir, '.github', 'workflows', 'label.yml');
  const producerPath = join(dir, '.github', 'workflows', 'pr-build.yml');
  const before = readFileSync(path, 'utf8');
  const producerBefore = readFileSync(producerPath, 'utf8');

  const [finding] = JSON.parse((await scan(dir, ['--format', 'json'])).stdout).findings;
  assert.deepEqual(finding.remediation, {
    kind: 'manual',
    command:
      'split the workflow so the job that holds the write token never consumes the artifact, or keep '
      + 'the artifact out of the write path and read the run through the API instead',
  });

  // Route one: the write moves to a job that never consumes the artifact, and the read stays where it
  // is. The only line the edit discards is the declaration the message names; every step survives.
  const DECLARATION = 'permissions: { contents: write, actions: read, pull-requests: write }';
  assert.ok(before.includes(DECLARATION), 'the fixture no longer carries the declaration it is about');
  writeFileSync(
    path,
    `${before.replace(DECLARATION, 'permissions: { contents: read, actions: read }')}`
      + '  publish:\n    runs-on: ubuntu-24.04\n    permissions: { contents: write, pull-requests: write }\n'
      + '    steps:\n      - run: gh pr edit 7 --add-label ready\n',
  );

  const split = await scan(dir, ['--format', 'json']);
  assert.equal(split.code, 0, 'the cleared state no longer fails the run');
  assert.deepEqual(
    JSON.parse(split.stdout).summary,
    { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
    'the printed route did not clear its own finding',
  );
  assert.deepEqual(removed(before, readFileSync(path, 'utf8')), [DECLARATION], 'the split discarded the declaration and nothing else');
  const splitText = readFileSync(path, 'utf8');
  for (const needle of ['actions/download-artifact@', 'run-id:', 'gh pr comment']) {
    assert.ok(splitText.split('\n').includes(before.split('\n').find((line) => line.includes(needle))), `the split lost the line carrying ${needle}`);
  }
  assert.equal(readFileSync(producerPath, 'utf8'), producerBefore, 'the other half of the pair was not touched');

  // Route two, on a fresh copy: the artifact leaves the write path and the run is read through the
  // API. Nothing else moves — in particular the write declaration route two does not need to narrow.
  const second = pair(t);
  const secondPath = join(second, '.github', 'workflows', 'label.yml');
  const secondBefore = readFileSync(secondPath, 'utf8');
  const lines = secondBefore.split('\n');
  const at = lines.findIndex((line) => line.includes('actions/download-artifact@'));
  assert.equal(at + 1, finding.line, 'the finding is reported at the step it tells the reader to edit');
  const stepLines = lines.slice(at, at + 4);
  assert.match(stepLines[3], /github-token/, 'the step is four lines here, and the fixture decides it');
  const migrated = [
    ...lines.slice(0, at),
    '      - run: gh api "repos/${{ github.repository }}/actions/runs/${{ github.event.workflow_run.id }}"',
    ...lines.slice(at + 4),
  ].join('\n');
  writeFileSync(secondPath, migrated);

  const moved = await scan(second, ['--format', 'json']);
  assert.equal(moved.code, 0);
  assert.deepEqual(JSON.parse(moved.stdout).summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(removed(secondBefore, migrated), stepLines, 'the edit removed exactly the step the finding named');
  assert.ok(migrated.includes(DECLARATION), 'route two keeps the declaration it does not need to narrow');
  assert.ok(migrated.includes('gh pr comment'), 'and the step that reads what it re-derived');
});

/// `S4`, the two formats: same count, path, line and message — never a code, which the human renderer
/// prints for no rule — and a pass, which neither format prints as a row, is compared by its count.

test('obligation: both formats agree on count, path, line and message, and print no code', async (t) => {
  const consumer = 'name: label\non:\n  workflow_run:\n    workflows: ["pr build"]\n    types: [completed]\njobs:\n  label:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo nothing downloaded\n';
  const shapes = [
    ['fail', () => pair(t)],
    ['pass', () => repoWith(t, { 'pr-build.yml': PR_BUILD, 'label.yml': consumer })],
    ['skip', () => repoWith(t, null)],
  ];

  for (const [shape, build] of shapes) {
    const dir = build();
    const json = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
    const human = await scan(dir);
    const flat = human.stdout.replace(/\s+/g, ' ');

    assert.deepEqual(humanSummary(human.stdout), json.summary, `${shape}: the two formats count the same`);
    for (const finding of json.findings) {
      assert.ok(flat.includes(finding.message.replace(/\s+/g, ' ')), `${shape}: the human report lost the message ${JSON.stringify(finding.message)}`);
      if (finding.path !== undefined) assert.ok(flat.includes(finding.path), `${shape}: the human report lost the path ${finding.path}`);
      if (finding.line !== undefined) {
        assert.ok(flat.includes(`${finding.path}:${finding.line}`), `${shape}: the human report lost ${finding.path}:${finding.line}`);
      }
      assert.equal(human.stdout.includes(finding.code), false, `${shape}: the human report printed the code ${finding.code}`);
    }
    if (shape === 'pass') {
      assert.deepEqual([json.findings.length, json.summary.pass], [0, 1], 'a pass has no row to compare, so parity is its count');
    }
  }
});
