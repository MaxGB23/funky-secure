#!/usr/bin/env node
/**
 * The 403, measured, because a refusal is the only evidence that a read-only token is read-only here.
 *
 * `docs/validation.md` listed "that `permissions: contents: read` really produces a 403" as something
 * that needed a runner and a repository. It needs one query: a job that declares `contents: read` and
 * attempts a write is refused, and the refusal is the measurement. Two traps make a naive probe vacuous.
 *
 * The first is the exit code. `gh` fails on a 403, and so does a typo, a wrong endpoint and a missing
 * credential: a probe that asserts "non-zero" would pass on all four. This one asserts the status *and*
 * the envelope, because a 403 also arrives from a rate limit, and the message is what separates the
 * integration's permission denial from a throttle.
 *
 * The second is the context. A token issued to a run from a fork is read-only whatever the job declares,
 * so a green there would measure the platform's rule and not ours; the job in `ci.yml` is guarded to skip
 * that context instead of reporting it as a pass.
 *
 * The request is deliberately invalid even for a token that may write: the body carries no `content`.
 * A token with `contents: write` answers 422 — this probe then fails loudly instead of creating a commit
 * — and the read-back afterwards proves the path is still absent, so "measured" never means "and wrote".
 */
import { pathToFileURL } from 'node:url';

/** A path the repository does not hold, so a read-back of it distinguishes absent from written. */
export const PROBE_PATH = '.github/runtime-claims-probe';

/** GitHub's answer when the token's permissions do not reach the endpoint. */
export const DENIED_MESSAGE = 'Resource not accessible by integration';

/**
 * The contents endpoint for a `owner/repo`.
 * @param {string} repo
 * @returns {string}
 */
export function endpointFor(repo) {
  return `https://api.github.com/repos/${repo}/contents/${PROBE_PATH}`;
}

/**
 * The write attempt's body. It carries a message and nothing else: with no `content`, a token that may
 * write answers 422 instead of creating the file, which is what lets this probe ask the question without
 * being able to answer it destructively.
 * @returns {string}
 */
export function attemptBody() {
  return JSON.stringify({ message: 'runtime-claims probe: this path must never be created' });
}

/**
 * @param {string} body
 * @returns {string}
 */
function messageOf(body) {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.message === 'string' ? parsed.message : String(body);
  } catch {
    return String(body);
  }
}

/**
 * Judge the refused write.
 * @param {{ status: number, body: string }} attempt
 * @returns {{ ok: boolean, problems: Array<string> }}
 */
export function judgeAttempt({ status, body }) {
  const problems = [];

  if (status !== 403) {
    problems.push(`the write attempt answered ${status}, not 403`);
  }

  const message = messageOf(body);
  if (message !== DENIED_MESSAGE) {
    problems.push(`the refusal carried ${JSON.stringify(message)}, not the integration denial`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Judge the read-back that proves nothing was written.
 * @param {{ status: number }} readBack
 * @returns {{ ok: boolean, problems: Array<string> }}
 */
export function judgeReadBack({ status }) {
  if (status === 404) {
    return { ok: true, problems: [] };
  }

  return { ok: false, problems: [`the read-back answered ${status}, so the probe path is not proven absent`] };
}

/**
 * Ask both questions. The transport is a parameter so the suite can answer without a network.
 * @param {{ repo: string, token: string, fetchImpl?: typeof fetch }} input
 * @returns {Promise<{ ok: boolean, problems: Array<string> }>}
 */
export async function probe({ repo, token, fetchImpl = fetch }) {
  const url = endpointFor(repo);
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'funky-secure runtime-claims probe',
  };

  const attempt = await fetchImpl(url, { method: 'PUT', headers, body: attemptBody() });
  const text = await attempt.text();
  const readBack = await fetchImpl(url, { headers });

  const problems = [
    ...judgeAttempt({ status: attempt.status, body: text }).problems,
    ...judgeReadBack({ status: readBack.status }).problems,
  ];

  return { ok: problems.length === 0, problems };
}

async function main() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;

  if (!token || !repo) {
    console.error('probe-permissions: GH_TOKEN and GH_REPO are required');
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = await probe({ repo, token });
  } catch (error) {
    console.error(`probe-permissions: the request did not complete: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.ok) {
    console.log(`probe-permissions: ${repo} refused the write with 403 and the integration denial, and ${PROBE_PATH} is still absent`);
    return;
  }

  for (const problem of result.problems) {
    console.error(`probe-permissions: ${problem}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
