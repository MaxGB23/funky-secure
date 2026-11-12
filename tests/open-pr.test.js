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
  floorOf,
  parseArgs,
  pullRequestFrom,
  run,
  runsPastFloor,
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
 * served: the first one is the floor read before the creation, every later one is a poll of that same
 * question after the deciding event.
 */
function gh({ create = 'https://github.com/MaxGB23/funky-secure/pull/42\n', snapshot = [], runs = [], conclusion = 'success', jobs = null, watch = {} } = {}) {
  const calls = [];
  let lists = 0;

  const exec = (args) => {
    calls.push(args.join(' '));
    const [group, action] = args;

    if (group === 'pr' && action === 'create') return { ok: true, stdout: create, stderr: '' };
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

function argvFor(path, timeout = 30) {
  return [
    '--base', 'main',
    '--head', 'feat/open-pr',
    '--title', 'the ritual in one command',
    '--body-file', path,
    '--label', 'type:docs',
    '--timeout', String(timeout),
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
  const ids = (list) => list.map((entry) => entry.databaseId);

  assert.equal(floorOf(runs, SHA), 22, 'the floor is the newest run of this commit, not of the branch');
  assert.deepEqual(ids(runsPastFloor(runs, SHA, 22)), [], 'a run at or below the floor cannot decide it');
  assert.deepEqual(ids(runsPastFloor(runs, SHA, 7)), [22], 'and a run past the floor is the candidate');
  assert.deepEqual(ids(runsPastFloor(runs, SHA, 0)), [22, 7], 'with no floor, every run of the commit');
  assert.equal(floorOf(runs, 'not-a-sha'), 0, 'a commit with no run has no floor');
  assert.equal(floorOf(undefined, SHA), 0, 'an unreadable answer is no run, not a crash');
  assert.deepEqual(runsPastFloor(undefined, SHA, 0), [], 'and it selects nothing instead of throwing');
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

test('creates a labelled pull request, and the run of this commit decides it', async (t) => {
  const out = capture();
  const err = capture();
  const queued = runOf(21, { status: 'in_progress', conclusion: null });
  const { exec, calls } = ghFloor({
    floor: [
      { databaseId: 11, headSha: 'ffffffffffffffffffffffffffffffffffffffff', status: 'completed', conclusion: 'success' },
    ],
    polls: [[queued], [queued]],
    views: { 21: { status: 'completed', conclusion: 'success', jobs: [{ name: 'test', conclusion: 'success' }] } },
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
  assert.doesNotMatch(created, /--draft/, 'the creation is the only event, so no second one is fired');
  assert.match(created, /--base main/);
  assert.match(created, /--head feat\/open-pr/);
  assert.match(created, /--body-file /);

  assert.equal(calls.filter((call) => call.startsWith('pr ready')).length, 0, 'there is no second event to fire');

  const floorRead = calls.findIndex((call) => call.startsWith('run list'));
  assert.ok(floorRead !== -1 && floorRead < calls.indexOf(created), 'the floor is read before the creation');

  const watched = calls.find((call) => call.startsWith('run watch'));
  assert.match(watched, /^run watch 21 /, 'the run of this commit, never the newest run of the branch');
  assert.match(watched, /--exit-status/);
  assert.match(watched, /--interval 15/);

  assert.match(out.text, /https:\/\/github\.com\/MaxGB23\/funky-secure\/pull\/42/, 'the URL is printed');
  assert.match(out.text, /open-pr: run 21 {2}·/, 'the run id is printed');
  assert.match(out.text.trimEnd().split('\n').pop(), /passed$/);
  assert.match(out.text, /^ {2}test: success$/m, 'the matrix is printed, so the verdict can be audited');
  assert.match(out.text, /pull\/42 {2}· {2}passed/, 'the verdict is printed');
});

test('a run that existed before the pull request was created cannot decide it', async (t) => {
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

  assert.equal(code, UNKNOWN, 'a green run of an earlier event is not this pull request\'s answer');
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

test('a cancelled run with a green matrix is unknown, never a failure', async (t) => {
  const out = capture();
  const err = capture();
  const { exec } = gh({
    snapshot: [],
    runs: [{ databaseId: 22, headSha: SHA, conclusion: 'cancelled' }],
    // The matrix is green and the summary is not: that disagreement is the whole point of the case.
    jobs: [{ name: 'test (ubuntu-24.04, 22)', conclusion: 'success' }],
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

  // The matrix is the gate and its jobs are green; the summary disagreeing with it is the stale field
  // this tool exists to survive. Answering 1 here would say "it broke" about something that did not.
  assert.equal(code, UNKNOWN);
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

test('the suite is bounded, so a hung test cannot hold the ritual open', async () => {
  const { suiteOptions } = await import('../scripts/open-pr.js');
  const options = suiteOptions();

  // `node --test` on a test that opens a server and never closes it does not fail: it hangs. This
  // script exists so a turn is never lost to a wait that cannot end, and its own suite is a child.
  assert.equal(typeof options.timeout, 'number');
  assert.ok(options.timeout > 0, 'an unbounded suite is the eight-minute turn again');
  assert.equal(options.encoding, 'utf8');
});

test('--help says how to use it and touches nothing', async () => {
  const out = capture();
  const err = capture();
  const { exec, calls } = gh();

  const code = await run({ argv: ['--help'], exec, out, err, sleep: async () => {} });

  assert.equal(code, 0, 'asking how it works is not a failure');
  assert.match(out.text, /--body-file/, 'the options are named');
  assert.match(out.text, /--label/, 'including the one that travels in the creation');
  assert.equal(calls.length, 0, 'a question must not create anything');
  assert.equal(err.text, '');
});

const PR_URL = 'https://github.com/MaxGB23/funky-secure/pull/42\n';

function completedGreen() {
  return {
    status: 'completed',
    conclusion: 'success',
    jobs: [{ name: 'test (ubuntu-24.04, 22)', conclusion: 'success' }],
  };
}

const runOf = (id, extra = {}) => ({
  databaseId: id,
  headSha: SHA,
  status: 'completed',
  conclusion: 'success',
  ...extra,
});

/**
 * A `gh` for the design that replaces the snapshot: the floor is read **before** the creation, so the
 * first `run list` is the floor and every later one is a poll. Each candidate answers its own matrix,
 * because the verdict stops being about one run and starts being about a set of them.
 */
function ghFloor({ floor = [], polls = [[]], views = {}, watch = {}, createOk = true } = {}) {
  const calls = [];
  let reads = 0;

  const exec = (args) => {
    calls.push(args.join(' '));
    const [group, action] = args;

    if (group === 'pr' && action === 'create') {
      return createOk
        ? { ok: true, stdout: PR_URL, stderr: '' }
        : { ok: false, stdout: '', stderr: 'a pull request for branch "feat/open-pr" already exists' };
    }
    if (group === 'run' && action === 'list') {
      const answer = reads === 0 ? floor : polls[Math.min(reads - 1, polls.length - 1)];
      reads += 1;
      return { ok: true, stdout: JSON.stringify(answer), stderr: '' };
    }
    if (group === 'run' && action === 'watch') {
      return { ok: watch.ok ?? true, timedOut: watch.timedOut === true, stdout: '', stderr: '' };
    }
    if (group === 'run' && action === 'view') {
      return { ok: true, stdout: JSON.stringify(views[String(args[2])] ?? completedGreen()), stderr: '' };
    }

    return { ok: false, stdout: '', stderr: `unexpected gh ${args.join(' ')}` };
  };

  return { exec, calls };
}

/** One `run()` with the suite green and no waiting, whatever `gh` answers. */
async function runWith(t, exec, body = BODY, timeout = 30) {
  const out = capture();
  const err = capture();
  const code = await run({
    argv: argvFor(bodyFile(t, body), timeout),
    suite: () => ({ ok: true, stdout: 'ℹ fail 0\n' }),
    exec,
    resolveSha: () => SHA,
    sleep: async () => {},
    out,
    err,
  });
  return { code, out: out.text, err: err.text };
}

test('a run at or below the floor can never decide the pull request', async (t) => {
  const stale = runOf(9);
  const { exec, calls } = ghFloor({ floor: [stale], polls: [[stale]] });

  const { code, out } = await runWith(t, exec);

  assert.equal(code, UNKNOWN, 'the run of an earlier event is not the run of this one');
  assert.equal(calls.filter((call) => call.startsWith('run watch')).length, 0, 'it is never watched');
  assert.match(out, /appeared within 30s; this is not a failure/);
});

test('two runs of the same commit that agree are green, and both ids are printed', async (t) => {
  const first = runOf(21);
  const second = runOf(22);
  const { exec, calls } = ghFloor({ polls: [[first, second], [first, second]] });

  const { code, out } = await runWith(t, exec);

  assert.equal(code, GREEN);
  assert.match(out, /open-pr: run 21/, 'the first id travels with the verdict');
  assert.match(out, /open-pr: run 22/, 'and so does the second');
  assert.match(out.trimEnd().split('\n').pop(), /passed$/);
  const viewed = (id) => calls.some((call) => call.startsWith(`run view ${id} `));
  assert.ok(viewed(21), 'the first matrix is read');
  assert.ok(viewed(22), 'the second matrix is read');
});

test('a red sibling is never averaged away by a green one', async (t) => {
  const first = runOf(21);
  const second = runOf(22);
  const { exec } = ghFloor({
    polls: [[first, second], [first, second]],
    views: {
      22: { status: 'completed', conclusion: 'failure', jobs: [{ name: 'test', conclusion: 'failure' }] },
    },
  });

  const { code, out } = await runWith(t, exec);

  assert.equal(code, RED, 'one red run decides the answer, whatever its sibling says');
  assert.match(out.trimEnd().split('\n').pop(), /failed$/);
});

test('two runs with no red and no agreement are unknown', async (t) => {
  const first = runOf(21);
  const second = runOf(22);
  const { exec } = ghFloor({
    polls: [[first, second], [first, second]],
    views: { 22: { status: 'in_progress', conclusion: null, jobs: [] } },
  });

  const { code } = await runWith(t, exec);

  assert.equal(code, UNKNOWN, 'a set that does not agree is not a verdict');
});

test('a set that grew and then held still is decided from the set, not abandoned at the growth', async (t) => {
  // The shape of every real pull request: `opened` and `labeled` register one poll apart, so the first
  // pair of reads disagrees. That is a third read owed, not a refusal — refusing there answers 2 always.
  const first = runOf(21);
  const second = runOf(22);
  const { exec, calls } = ghFloor({ polls: [[first], [first, second]] });

  const { code, out } = await runWith(t, exec);

  assert.equal(code, GREEN, 'the stabilised set is the answer');
  assert.match(out, /open-pr: run 21/, 'every id of the stabilised set travels with the verdict');
  assert.match(out, /open-pr: run 22/);
  assert.match(out.trimEnd().split('\n').pop(), /passed$/);
  assert.equal(calls.filter((call) => call.startsWith('run view')).length, 2, 'and both matrices are read');
});

test('a set still changing when the budget runs out is unknown and names every id it saw', async (t) => {
  const grown = [[runOf(21)], [runOf(21), runOf(22)], [runOf(21), runOf(22)], [runOf(21), runOf(22), runOf(23)]];
  const { exec, calls } = ghFloor({ polls: grown });

  // 15s is one attempt of the 15s interval: two read-pairs, and the set is still different at the end.
  const { code, out } = await runWith(t, exec, BODY, 15);

  assert.equal(code, UNKNOWN, 'a set that never held still is a question, not an answer');
  assert.match(out, /still changing \(21, 22, 23\); this is not a failure/);
  assert.equal(calls.filter((call) => call.startsWith('run watch')).length, 0, 'nothing is watched while the set moves');
  assert.equal(calls.filter((call) => call.startsWith('run view')).length, 0, 'and nothing is judged');
});

test('two reads separated by an empty read are not consecutive agreement', async (t) => {
  // The set is seen, then the API answers nothing, then the same set again. The empty read is never half
  // of a pair, so the two sightings of 21 are not agreement and the answer is not taken from them. The
  // fourth read is empty again, so the budget ends with the set never having held still.
  const { exec, calls } = ghFloor({ polls: [[runOf(21)], [], [runOf(21)], []] });

  const { code, out } = await runWith(t, exec, BODY, 15);

  assert.equal(code, UNKNOWN, 'a set and an empty answer do not agree with each other');
  assert.match(out, /still changing \(21\); this is not a failure/);
  assert.equal(
    calls.filter((call) => call.startsWith('run list')).length,
    5,
    'the set was read again after the empty read, and still nothing agreed',
  );
  assert.equal(calls.filter((call) => call.startsWith('run watch')).length, 0, 'and nothing is watched');
  assert.equal(calls.filter((call) => call.startsWith('run view')).length, 0, 'and nothing is judged');
});

test('a floor that cannot be read refuses before anything is created', async (t) => {
  const calls = [];
  const exec = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'run' && args[1] === 'list') {
      return { ok: false, stdout: '', stderr: 'HTTP 401: Bad credentials' };
    }
    return { ok: true, stdout: PR_URL, stderr: '' };
  };

  const { code, err } = await runWith(t, exec);

  assert.equal(code, UNKNOWN, 'a floor nobody could read is not zero');
  assert.equal(calls.filter((call) => call.startsWith('pr create')).length, 0, 'nothing is created on an unknown floor');
  assert.match(err, /Bad credentials/, 'the failure names itself');
});

test('the pull request is created ready, and `pr ready` is never issued', async (t) => {
  const only = runOf(21);
  const { exec, calls } = ghFloor({ polls: [[only], [only]] });

  const { code } = await runWith(t, exec);

  assert.equal(code, GREEN);
  const created = calls.find((call) => call.startsWith('pr create'));
  assert.ok(created, 'the pull request is created');
  assert.doesNotMatch(created, /--draft/, 'a draft fires a second event for the same commit');
  assert.match(created, /--label type:docs/, 'the label still travels in the creation');
  assert.equal(calls.filter((call) => call.startsWith('pr ready')).length, 0, 'there is no second event to fire');
});
