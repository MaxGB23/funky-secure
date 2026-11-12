import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GREEN,
  RED,
  UNKNOWN,
  decideVerdict,
  failingCount,
  parseArgs,
  pullRequestFrom,
  run,
  selectRun,
} from '../scripts/open-pr.js';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function capture() {
  return {
    text: '',
    write(chunk) {
      this.text += chunk;
      return true;
    },
  };
}

/**
 * A `gh` whose answers are written here and nowhere else. Call order decides which `run list` answer is
 * served: the first one is the snapshot taken before `gh pr ready`, every later one is the API after the
 * deciding event.
 */
function gh({ create = 'https://github.com/MaxGB23/funky-secure/pull/42\n', snapshot = [], runs = [], conclusion = 'success', jobs = null, watch = {} } = {}) {
  const calls = [];
  let lists = 0;

  const exec = (args) => {
    calls.push(args.join(' '));
    const [group, action] = args;

    if (group === 'pr' && action === 'create') return { ok: true, stdout: create, stderr: '' };
    if (group === 'pr' && action === 'ready') return { ok: true, stdout: '', stderr: '' };
    if (group === 'run' && action === 'list') {
      lists += 1;
      return { ok: true, stdout: JSON.stringify(lists === 1 ? snapshot : runs), stderr: '' };
    }
    if (group === 'run' && action === 'watch') {
      return { ok: watch.ok ?? true, timedOut: watch.timedOut === true, stdout: '', stderr: '' };
    }
    if (group === 'run' && action === 'view') {
      // The matrix travels with the answer: the verdict is read from the jobs, so a stub without them
      // is a run nobody can judge, and that is exactly what the gate refuses to call green.
      return {
        ok: true,
        stdout: JSON.stringify({
          status: 'completed',
          conclusion,
          jobs: (jobs ?? [{ name: 'test', conclusion }]).map((job) => ({ ...job })),
        }),
        stderr: '',
      };
    }

    return { ok: false, stdout: '', stderr: `unexpected gh ${args.join(' ')}` };
  };

  return { exec, calls };
}

/** A body file in a fresh temporary directory, removed when the test ends. */
function bodyFile(t, text) {
  const directory = mkdtempSync(join(tmpdir(), 'open-pr-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const path = join(directory, 'body.md');
  writeFileSync(path, text);
  return path;
}

const BODY = 'Closes #7\n\n## Summary\n- the ritual in one command\n';

function argvFor(path) {
  return [
    '--base', 'main',
    '--head', 'feat/open-pr',
    '--title', 'the ritual in one command',
    '--body-file', path,
    '--label', 'type:docs',
    '--timeout', '30',
  ];
}

test('reads the whole ritual from the command line and names every part that is missing', () => {
  const { options, problems } = parseArgs([
    '--base', 'develop',
    '--head', 'docs/open-pr',
    '--title', 'the ritual in one command',
    '--body-file', 'body.md',
    '--label', 'type:docs',
    '--repo', 'MaxGB23/funky-secure',
    '--timeout', '90',
  ]);

  assert.deepEqual(problems, []);
  assert.deepEqual(options, {
    base: 'develop',
    head: 'docs/open-pr',
    title: 'the ritual in one command',
    bodyFile: 'body.md',
    label: 'type:docs',
    repo: 'MaxGB23/funky-secure',
    timeout: 90,
  });

  assert.equal(parseArgs([]).options.base, 'main', 'the base is a default, not a required option');
  assert.equal(parseArgs(['--base', 'main', '--label', 'type:docs']).problems.length, 2, 'title and body file');
  assert.match(parseArgs(['--head']).problems[0], /--head needs a value/);
  assert.match(parseArgs(['--lisence', 'MIT']).problems[0], /unknown option "--lisence"/);
  assert.match(parseArgs(['--timeout', 'soon']).problems[0], /--timeout takes a positive number of seconds/);
  assert.match(parseArgs(['main']).problems[0], /unexpected argument "main"/);
});

test('the gate is the matrix, and the summary is not', () => {
  const completed = (conclusion, jobs) => ({ status: 'completed', conclusion, jobs });

  assert.equal(decideVerdict(completed('success', [{ name: 'test', conclusion: 'success' }])).code, GREEN);
  // A skipped job is the guard working: `pr-policy` reads skipped on a push to main.
  assert.equal(decideVerdict(completed('success', [{ name: 'pr-policy', conclusion: 'skipped' }])).code, GREEN);
  // The reading that makes a red check look green, and the reason this module keeps no rule of its own.
  assert.equal(decideVerdict(completed('success', [{ name: 'test', conclusion: 'failure' }])).code, RED);
  assert.equal(decideVerdict(completed('failure', [{ name: 'test', conclusion: 'failure' }])).code, RED);
  // A run still going, and one that answers no job, are unknown rather than failures.
  assert.equal(decideVerdict({ status: 'in_progress', conclusion: null, jobs: [] }).code, UNKNOWN);
  assert.equal(decideVerdict(completed('success', [])).code, UNKNOWN);
  assert.equal(decideVerdict(null).code, UNKNOWN);
});

test('counts the failures the reporter summarized, in either reporter', () => {
  assert.equal(failingCount('ℹ tests 8\nℹ pass 6\nℹ fail 2\n'), 2, 'the spec reporter');
  assert.equal(failingCount('# pass 0\n# fail 3\n'), 3, 'TAP');
  assert.equal(failingCount('a suite that died before it summarized'), null);
  assert.equal(failingCount(undefined), null);
});

test('the run is chosen by its commit, not by being the newest of the branch', () => {
  const runs = [
    { databaseId: 11, headSha: 'ffffffffffffffffffffffffffffffffffffffff', conclusion: 'success' },
    { databaseId: 22, headSha: SHA, conclusion: 'success' },
    { databaseId: 7, headSha: SHA, conclusion: 'failure' },
  ];

  assert.equal(selectRun(runs, SHA).databaseId, 22, 'the newest run of this commit');
  assert.equal(selectRun(runs, SHA, ['22']).databaseId, 7, 'a run that already existed cannot decide it');
  assert.equal(selectRun(runs, SHA, ['22', '7']), null);
  assert.equal(selectRun(runs, 'not-a-sha'), null);
  assert.equal(selectRun(undefined, SHA), null, 'an unreadable answer is no run, not a crash');
});

test('the pull request number comes from the URL the creation printed', () => {
  assert.deepEqual(pullRequestFrom('https://github.com/MaxGB23/funky-secure/pull/42\n'), {
    url: 'https://github.com/MaxGB23/funky-secure/pull/42',
    number: 42,
  });
  assert.equal(pullRequestFrom('warning: something\n'), null);
});

test('a red suite refuses before anything is created and names the failing count', async () => {
  const out = capture();
  const err = capture();
  const { exec, calls } = gh();

  const code = await run({
    argv: argvFor('body.md'),
    suite: () => ({ ok: false, stdout: 'ℹ tests 8\nℹ pass 6\nℹ fail 2\n' }),
    exec,
    out,
    err,
  });

  assert.equal(code, RED);
  assert.match(err.text, /the suite is red \(2 failing tests\), so nothing was created/);
  assert.equal(calls.length, 0, 'no gh call, so no pull request');
  assert.equal(out.text, '');
});

test('a policy refusal refuses before anything is created and prints the policy message', async (t) => {
  const out = capture();
  const err = capture();
  const { exec, calls } = gh();
  const path = bodyFile(t, '## Summary\n- a body that links no issue\n');

  const code = await run({
    argv: argvFor(path),
    suite: () => ({ ok: true, stdout: 'ℹ fail 0\n' }),
    exec,
    out,
    err,
  });

  assert.equal(code, RED);
  assert.match(err.text, /^pr-policy: the body does not link an issue/m, 'the policy prints its own message');
  assert.match(err.text, /the policy refuses this pull request, so nothing was created/);
  assert.equal(calls.length, 0, 'a refused pull request is never created');
});

test('creates a labelled draft, marks it ready and returns the run of this commit', async (t) => {
  const out = capture();
  const err = capture();
  const { exec, calls } = gh({
    snapshot: [],
    runs: [
      { databaseId: 11, headSha: 'ffffffffffffffffffffffffffffffffffffffff', conclusion: 'success' },
      { databaseId: 22, headSha: SHA, conclusion: 'success' },
    ],
  });

  const code = await run({
    argv: argvFor(bodyFile(t, BODY)),
    suite: () => ({ ok: true, stdout: 'ℹ fail 0\n' }),
    exec,
    resolveSha: () => SHA,
    sleep: async () => {},
    out,
    err,
  });

  assert.equal(code, GREEN, err.text);
  assert.equal(err.text, '');

  const created = calls.find((call) => call.startsWith('pr create'));
  assert.ok(created, 'the pull request is created');
  assert.match(created, /--label type:docs/, 'the label travels in the creation, not after it');
  assert.match(created, /--draft/, 'a draft matches the workflow guard');
  assert.match(created, /--base main/);
  assert.match(created, /--head feat\/open-pr/);
  assert.match(created, /--body-file /);

  assert.ok(calls.includes('pr ready 42'), `ready runs against the created pull request: ${calls.join(' | ')}`);

  const watched = calls.find((call) => call.startsWith('run watch'));
  assert.match(watched, /^run watch 22 /, 'the run of this commit, never the newest run of the branch');
  assert.match(watched, /--exit-status/);
  assert.match(watched, /--interval 15/);

  assert.match(out.text, /https:\/\/github\.com\/MaxGB23\/funky-secure\/pull\/42/, 'the URL is printed');
  assert.match(out.text, /open-pr: run 22 {2}·/, 'the run id is printed');
  assert.match(out.text.trimEnd().split('\n').pop(), /passed$/);
  assert.match(out.text, /pull\/42 {2}· {2}passed/, 'the verdict is printed');
});

test('a run that finished before the pull request was ready cannot decide it', async (t) => {
  const out = capture();
  const err = capture();
  const stale = { databaseId: 9, headSha: SHA, conclusion: 'success' };
  const { exec, calls } = gh({ snapshot: [stale], runs: [stale] });

  const code = await run({
    argv: argvFor(bodyFile(t, BODY)),
    suite: () => ({ ok: true, stdout: 'ℹ fail 0\n' }),
    exec,
    resolveSha: () => SHA,
    sleep: async () => {},
    out,
    err,
  });

  assert.equal(code, UNKNOWN, 'the draft runs are not the deciding run');
  assert.equal(calls.filter((call) => call.startsWith('run watch')).length, 0, 'the stale run is never watched');
  assert.match(out.text, /no run of a1b2c3d4e5f60718293a4b5c6d7e8f9012345678 appeared within 30s; this is not a failure/);
});

test('a watch that runs out of time is unknown, never a failure', async (t) => {
  const out = capture();
  const err = capture();
  const { exec, calls } = gh({
    snapshot: [],
    runs: [{ databaseId: 22, headSha: SHA, status: 'in_progress', conclusion: null }],
    watch: { ok: false, timedOut: true },
  });

  const code = await run({
    argv: argvFor(bodyFile(t, BODY)),
    suite: () => ({ ok: true, stdout: 'ℹ fail 0\n' }),
    exec,
    resolveSha: () => SHA,
    sleep: async () => {},
    out,
    err,
  });

  assert.equal(code, UNKNOWN, 'a timeout is not a red check');
  assert.equal(calls.filter((call) => call.startsWith('run view')).length, 0, 'an unfinished run has no conclusion to read');
  assert.match(out.text, /unknown — the run did not conclude within 30s; this is not a failure/);
});

test('a run that concluded failure exits 1 and still names the pull request', async (t) => {
  const out = capture();
  const err = capture();
  const { exec } = gh({
    snapshot: [],
    runs: [{ databaseId: 22, headSha: SHA, conclusion: 'failure' }],
    watch: { ok: false },
    conclusion: 'failure',
  });

  const code = await run({
    argv: argvFor(bodyFile(t, BODY)),
    suite: () => ({ ok: true, stdout: 'ℹ fail 0\n' }),
    exec,
    resolveSha: () => SHA,
    sleep: async () => {},
    out,
    err,
  });

  assert.equal(code, RED);
  assert.match(out.text, /open-pr: run 22 {2}·/, 'the run id is printed');
  assert.match(out.text.trimEnd().split('\n').pop(), /failed$/);
  assert.match(out.text, /pull\/42 {2}· {2}failed/);
});

test('a cancelled run is not an acceptable conclusion, so the gate calls it a failure', async (t) => {
  const out = capture();
  const err = capture();
  const { exec } = gh({
    snapshot: [],
    runs: [{ databaseId: 22, headSha: SHA, conclusion: 'cancelled' }],
    watch: { ok: false },
    conclusion: 'cancelled',
  });

  const code = await run({
    argv: argvFor(bodyFile(t, BODY)),
    suite: () => ({ ok: true, stdout: 'ℹ fail 0\n' }),
    exec,
    resolveSha: () => SHA,
    sleep: async () => {},
    out,
    err,
  });

  // The gate is one rule, shared with `wait-for-ci`: only success, skipped and neutral are acceptable.
  // A cancelled run is none of them, so it settles as a failure a maintainer has to look at rather than
  // as an unknown that reads like "wait a bit more".
  assert.equal(code, RED);
});

test('an incomplete command line says what is missing instead of creating anything', async () => {
  const out = capture();
  const err = capture();
  const { exec, calls } = gh();

  const code = await run({ argv: ['--title', 'no label'], exec, out, err });

  assert.equal(code, UNKNOWN);
  assert.match(err.text, /--body-file is required/);
  assert.match(err.text, /--label is required/);
  assert.match(err.text, /open-pr: node scripts\/open-pr\.js --base main/);
  assert.equal(calls.length, 0);
});
