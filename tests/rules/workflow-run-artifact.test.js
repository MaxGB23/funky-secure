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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
