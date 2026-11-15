import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DENIED_MESSAGE,
  PROBE_PATH,
  attemptBody,
  endpointFor,
  judgeAttempt,
  judgeReadBack,
  probe,
} from '../scripts/probe-permissions.js';

/**
 * The envelope GitHub writes, spelled out. The fixture is deliberately not built from `DENIED_MESSAGE`:
 * a constant that drifted would then agree with itself and every test would pass, while the live probe
 * rejected the real 403. One test below pins the constant to this literal.
 */
const DENIED_LITERAL = 'Resource not accessible by integration';

const denied = (message = DENIED_LITERAL) => JSON.stringify({ message, documentation_url: 'https://docs.github.com' });

test('the denial the probe recognises is the envelope GitHub writes', () => {
  assert.equal(DENIED_MESSAGE, DENIED_LITERAL, 'the constant drifted from the envelope a real 403 carries');
});

test('a 403 carrying the integration denial is the measurement', () => {
  assert.deepEqual(judgeAttempt({ status: 403, body: denied() }), { ok: true, problems: [] });
});

test('a 403 from a rate limit is not the measurement', () => {
  const judged = judgeAttempt({ status: 403, body: denied('API rate limit exceeded for 1.2.3.4.') });

  assert.equal(judged.ok, false);
  assert.match(judged.problems.join(' '), /rate limit exceeded/);
});

test('a 403 whose body is not JSON names the body instead of passing', () => {
  const judged = judgeAttempt({ status: 403, body: '<html>403</html>' });

  assert.equal(judged.ok, false);
  assert.match(judged.problems.join(' '), /<html>/);
});

test('any status other than 403 is a failure that names the status', () => {
  for (const status of [200, 201, 401, 404, 422, 500]) {
    const judged = judgeAttempt({ status, body: denied() });

    assert.equal(judged.ok, false, `${status} passed`);
    assert.match(judged.problems.join(' '), new RegExp(`\\b${status}\\b`), `${status} was not named`);
  }
});

test('the read-back passes only when the probe path is still absent', () => {
  assert.deepEqual(judgeReadBack({ status: 404 }), { ok: true, problems: [] });

  for (const status of [200, 403, 500]) {
    const judged = judgeReadBack({ status });

    assert.equal(judged.ok, false, `${status} passed`);
    assert.match(judged.problems.join(' '), new RegExp(`\\b${status}\\b`));
  }
});

test('the write attempt cannot succeed even for a token that may write', () => {
  // A token with `contents: write` must answer 422 on this body, never create a commit: the probe is
  // meaningless if measuring the permission it expects to be absent changes the repository.
  assert.deepEqual(Object.keys(JSON.parse(attemptBody())), ['message']);
});

test('the endpoint is the contents API, for a path the repository does not hold', () => {
  assert.equal(endpointFor('MaxGB23/funky-secure'), `https://api.github.com/repos/MaxGB23/funky-secure/contents/${PROBE_PATH}`);
  assert.equal(PROBE_PATH, '.github/runtime-claims-probe');
});

test('a transport that throws is not a pass', async () => {
  await assert.rejects(
    () => probe({ repo: 'a/b', token: 't', fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); } }),
    /ENOTFOUND/,
  );
});

test('both requests carry a deadline, so a stalled connection cannot hold the job open', async () => {
  const signals = [];
  const answers = [
    { status: 403, body: denied() },
    { status: 404, body: JSON.stringify({ message: 'Not Found' }) },
  ];
  const fetchImpl = async (url, options) => {
    signals.push(options?.signal);
    const next = answers.shift();
    return { status: next.status, text: async () => next.body };
  };

  assert.deepEqual(await probe({ repo: 'a/b', token: 't', fetchImpl }), { ok: true, problems: [] });
  assert.equal(signals.length, 2, 'the probe made a different number of requests than the two it judges');
  for (const signal of signals) {
    assert.ok(signal instanceof AbortSignal, 'a request without a signal has no deadline');
  }
});

test('a refused write and an absent path are the only way probe() answers ok', async () => {
  const answers = [
    { status: 403, body: denied() },
    { status: 404, body: JSON.stringify({ message: 'Not Found' }) },
  ];
  const fetchImpl = async () => {
    const next = answers.shift();
    return { status: next.status, text: async () => next.body };
  };

  assert.deepEqual(await probe({ repo: 'a/b', token: 't', fetchImpl }), { ok: true, problems: [] });

  const written = [
    { status: 403, body: denied() },
    { status: 200, body: JSON.stringify({ name: 'runtime-claims-probe' }) },
  ];
  const writingFetch = async () => {
    const next = written.shift();
    return { status: next.status, text: async () => next.body };
  };

  const judged = await probe({ repo: 'a/b', token: 't', fetchImpl: writingFetch });
  assert.equal(judged.ok, false);
  assert.match(judged.problems.join(' '), /\b200\b/);
});
