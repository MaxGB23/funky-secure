import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseWorkflow } from '../src/lib/workflows.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @param {...string} parts */
function fixture(...parts) {
  return readFileSync(join(HERE, 'fixtures', ...parts), 'utf8');
}

test('parses the real steps of a mixed workflow and ignores block-scalar and with-map decoys', () => {
  const result = parseWorkflow(fixture('workflows/mixed.yml'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.jobs.map((job) => job.id), ['build', 'lint']);

  const build = result.jobs[0];
  assert.equal(build.name, 'build');
  assert.equal(build.condition, "github.actor == 'dependabot[bot]'");
  assert.deepEqual(build.permissions, { contents: 'read' });
  assert.deepEqual(
    build.steps.map((step) => [step.line, step.uses]),
    [
      [19, 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'],
      [21, 'pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda'],
      [25, 'actions/cache@6849a6489940f00c2f30c0fb92c6274307ccb58a'],
      [28, null],
      [35, null],
      [38, null],
      [42, 'actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea'],
      [48, 'actions/upload-artifact@b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882'],
      [49, 'docker://alpine:3.20'],
      [50, 'docker://ghcr.io/owner/image@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'],
      [51, './.github/actions/local'],
    ],
  );
  assert.deepEqual(build.steps.map((step) => step.index), build.steps.map((_, index) => index));

  assert.equal(build.steps[0].name, 'checkout');
  assert.equal(build.steps[2].name, 'cache');
  assert.equal(build.steps[5].with.uses, 'not-an-action/ref@v9');
  assert.equal(build.steps[5].name, 'with-uses-key');
  assert.equal(build.steps[5].run, 'echo with');
  assert.equal(build.steps[7].name, 'flow');

  const lint = result.jobs[1];
  assert.equal(lint.condition, "${{ github.actor == 'renovate[bot]' && github.event_name == 'pull_request' }}");
  assert.equal(lint.steps.length, 1);
  assert.equal(lint.steps[0].run, 'pnpm lint');
});

test('keeps the trailing comment of a uses value in raw and strips it from uses', () => {
  const result = parseWorkflow(fixture('workflows/mixed.yml'));
  const build = result.jobs[0];
  assert.equal(
    build.steps[1].raw,
    'pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda # v4.1.0',
  );
  assert.equal(build.steps[2].raw, '"actions/cache@6849a6489940f00c2f30c0fb92c6274307ccb58a" # v4.2.1');
  assert.equal(
    build.steps[0].raw,
    'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
  );
});

test('keeps block-scalar bodies as values, never as steps', () => {
  const build = parseWorkflow(fixture('workflows/mixed.yml')).jobs[0];
  assert.equal(build.steps[3].run.includes('uses: heredoc/decoy@deadbeef'), true);
  assert.equal(build.steps[3].run.includes('- not-a-step'), true);
  assert.equal(build.steps[3].run.includes('name: also-not-a-step'), true);
  assert.equal(build.steps[4].run.includes('echo folded'), true);
  assert.equal(build.steps[6].with.script.includes('uses: decoy@v1'), true);

  const seen = build.steps.map((step) => step.uses ?? '').join('\n');
  assert.equal(seen.includes('decoy'), false);
  assert.equal(seen.includes('not-an-action'), false);
});

test('reads a with-map that follows a step whose first key is on the dash line', () => {
  const build = parseWorkflow(fixture('workflows/mixed.yml')).jobs[0];
  assert.deepEqual(build.steps[1].with, { version: '12.3.4', run_install: 'false' });
});

test('reads a bare dash step followed by an indented map', () => {
  const result = parseWorkflow(fixture('workflows/bare-dash.yml'));
  assert.equal(result.ok, true);
  assert.equal(result.jobs.length, 1);
  const steps = result.jobs[0].steps;
  assert.deepEqual(
    steps.map((step) => [step.line, step.uses, step.run]),
    [
      [9, 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683', null],
      [10, 'pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda', null],
      [15, null, 'pnpm test'],
    ],
  );
  assert.equal(steps[1].name, 'bare dash');
  assert.equal(steps[1].raw, 'pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda # v4.1.0');
  assert.deepEqual(steps[1].with, { version: '12.3.4' });
});

test('finds every step of this repository\'s own workflow with its line', () => {
  const result = parseWorkflow(fixture('workflows/self.yml'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.jobs.map((job) => job.id), ['test']);
  assert.deepEqual(
    result.jobs[0].steps.map((step) => [step.line, step.uses]),
    [
      [15, 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262'],
      [16, 'pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa'],
      [20, 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'],
      [24, null],
      [25, null],
      [26, null],
    ],
  );
  assert.equal(result.jobs[0].steps[5].name, 'self-scan');
  assert.equal(result.jobs[0].steps[5].run, 'node bin/funky-secure.js scan --scope repo --fail-on warn');
});

test('refuses a workflow with an anchor and names the line', () => {
  const result = parseWorkflow(fixture('workflows/unparseable.yml'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unparseable-workflow');
  assert.match(result.detail, /line 5/);
});

test('refuses tab indentation and names the line', () => {
  const result = parseWorkflow('jobs:\n\ttest:\n');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unparseable-workflow');
  assert.match(result.detail, /line 2/);
});

test('refuses a job declared as a flow map, which it cannot attribute', () => {
  const result = parseWorkflow('jobs:\n  test: { runs-on: ubuntu-latest }\n');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unparseable-workflow');
  assert.match(result.detail, /line 2/);
});

test('refuses a uses value written as a block scalar instead of guessing a reference', () => {
  const text = [
    'jobs:',
    '  test:',
    '    steps:',
    '      - uses: >-',
    '          actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
    '',
  ].join('\n');
  const result = parseWorkflow(text);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unparseable-workflow');
  assert.match(result.detail, /line 4/);
});

test('reads a trailing comment after a key instead of treating it as the value', () => {
  const text = [
    'jobs:',
    '  test:',
    '    steps: # the step list',
    '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
    '        with: # inputs',
    '          fetch-depth: 0 # full history',
    '',
  ].join('\n');
  const result = parseWorkflow(text);
  assert.equal(result.ok, true);
  assert.equal(result.jobs[0].steps.length, 1);
  assert.equal(result.jobs[0].steps[0].uses, 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683');
  assert.equal(
    result.jobs[0].steps[0].raw,
    'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
  );
  assert.deepEqual(result.jobs[0].steps[0].with, { 'fetch-depth': '0' });
});
