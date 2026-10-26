import test from 'node:test';
import assert from 'node:assert/strict';

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

test('reports a dependabot configuration as one pass carrying the signal, never a fail', () => {
  const findings = rule.detect(context({ botFiles: ['.github/dependabot.yml'] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'bot-config-present');
  assert.deepEqual(findings[0].evidence, { files: ['.github/dependabot.yml'] });
  assert.match(findings[0].message, /automated updates configured/);
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

test('fails pull_request_target with a PR-head checkout in the same job', () => {
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

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'pr-target-head-checkout');
  assert.equal(findings[0].path, '.github/workflows/pr-target.yml');
  assert.equal(findings[0].evidence.job, 'build');
  assert.equal(findings[0].line, 8);
  assert.deepEqual(findings[0].remediation, {
    kind: 'manual',
    command: 'edit .github/workflows/pr-target.yml:8 and drop the checkout of the pull request head',
  });
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
