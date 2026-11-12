/**
 * Opens a pull request through the whole ritual, in one command, because the ritual has more steps
 * than the mistake and gets skipped.
 *
 * Five round trips were lost in one day to the same class of mistake: a pull request opened without its
 * label, so the `opened` run reads `PR_LABELS` empty; a `gh run rerun --failed` that replays the frozen
 * event payload and fails identically; a wait loop keyed on the branch, so it answers with an earlier
 * commit's run; and a branch pushed with a suite that does not parse. Every one of those is cheap to
 * prevent and easy to forget, so the order lives here instead: the suite, the policy, a labelled draft,
 * ready, and then the run of *this* commit.
 *
 * The decisions are pure functions and every `gh` invocation goes through one injected `exec`, so the
 * tests read a verdict without a network, a repository or a pull request.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run as runPolicy } from './check-pr-policy.js';
import { decideGate } from './wait-for-ci.js';

/** The three exits: the run passed, it failed, and nobody can say yet. `2` is never a failure. */
export const GREEN = 0;
export const RED = 1;
export const UNKNOWN = 2;

export const USAGE =
  'node scripts/open-pr.js --base main --title "<title>" --body-file <path> --label <type:...> ' +
  '[--head <branch>] [--repo <owner/name>] [--timeout <seconds>]';

const DEFAULT_TIMEOUT_SECONDS = 600;
const DEFAULT_INTERVAL_SECONDS = 15;
const RUN_FIELDS = 'databaseId,headSha,status,conclusion';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The command line as options and the reasons it cannot run, so a missing `--label` is one line
 * instead of a pull request created without it.
 *
 * @param {string[]} [argv]
 * @returns {{ options: { base: string, title: string|null, bodyFile: string|null, label: string|null, head: string|null, repo: string|null, timeout: number }, problems: string[] }}
 */
export function parseArgs(argv = []) {
  const options = {
    base: 'main',
    title: null,
    bodyFile: null,
    label: null,
    head: null,
    repo: null,
    timeout: DEFAULT_TIMEOUT_SECONDS,
  };
  const problems = [];
  const known = new Set(['base', 'title', 'body-file', 'label', 'head', 'repo', 'timeout']);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (!argument.startsWith('--')) {
      problems.push(`unexpected argument "${argument}"`);
      continue;
    }

    const name = argument.slice(2);
    if (!known.has(name)) {
      problems.push(`unknown option "--${name}"`);
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || String(value).startsWith('--')) {
      problems.push(`--${name} needs a value`);
      continue;
    }
    index += 1;

    if (name === 'timeout') {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        problems.push(`--timeout takes a positive number of seconds, not "${value}"`);
        continue;
      }
      options.timeout = seconds;
      continue;
    }

    if (name === 'body-file') options.bodyFile = String(value);
    else options[name] = String(value);
  }

  if (options.title === null) problems.push('--title is required');
  if (options.bodyFile === null) problems.push('--body-file is required');
  if (options.label === null) problems.push('--label is required: it travels in the creation');

  return { options, problems };
}

/**
 * What one conclusion means, in the only three answers worth printing. A run that was cancelled, timed
 * out or skipped is not a verdict on the code, so it is unknown rather than failed: collapsing the two
 * is what makes a green run look broken.
 *
 * @param {{ conclusion?: string|null } | null} run
 * @returns {{ code: number, state: 'passed'|'failed'|'unknown', reason: string }}
 */
export function decideVerdict(answer) {
  // The gate is the matrix, not the run's summary, and it is the same function `wait-for-ci` uses: a
  // run that says success while a job failed is exactly the reading that makes a red check look green,
  // and two copies of that rule is how two answers drift (I-64). This module keeps no rule of its own.
  return decideGate({ run: answer, jobs: answer?.jobs ?? [] });
}

/**
 * The run of one commit, never the newest run of the branch: `gh run list --branch` answers the newest
 * run first, and while the run for the new commit is still queued that answer belongs to the previous
 * one. `exclude` carries the runs that already existed before the deciding event, because a run that
 * finished before the pull request was ready cannot decide it.
 *
 * @param {Array<{ databaseId?: number|string, headSha?: string, conclusion?: string }>} runs
 * @param {string} sha
 * @param {Iterable<string|number>} [exclude]
 * @returns {{ databaseId?: number|string, headSha?: string, conclusion?: string } | null}
 */
export function selectRun(runs, sha, exclude = []) {
  if (!Array.isArray(runs)) return null;

  const skipped = new Set([...exclude].map(String));
  return runs.find((run) => run?.headSha === sha && !skipped.has(String(run.databaseId))) ?? null;
}

/**
 * The URL `gh pr create` prints and the number at its end. Both come from the creation itself, so the
 * steps that follow cannot act on a different pull request.
 *
 * @param {string} stdout
 * @returns {{ url: string, number: number } | null}
 */
export function pullRequestFrom(stdout) {
  const match = /https?:\/\/\S+\/pull\/(\d+)/.exec(typeof stdout === 'string' ? stdout : '');
  return match === null ? null : { url: match[0], number: Number(match[1]) };
}

/**
 * How many tests failed, from the reporter's own summary. Both reporters this suite can emit are read:
 * the spec reporter writes `ℹ fail 2` and TAP writes `# fail 2`. A suite that died before it could
 * summarize answers `null`, which still refuses.
 *
 * @param {string} output
 * @returns {number | null}
 */
export function failingCount(output) {
  const match = /^(?:ℹ|#) fail (\d+)$/m.exec(typeof output === 'string' ? output : '');
  return match === null ? null : Number(match[1]);
}

/**
 * Polls for the run of one commit until it appears or the attempts run out. The bound is a count of
 * attempts rather than a clock, so a test drives it without waiting and a real wait still stops.
 *
 * @param {{ exec: Function, head: string, repo?: string|null, sha: string, exclude?: Array<string|number>, sleep: (ms: number) => Promise<void>, timeoutSeconds?: number, intervalSeconds?: number }} options
 * @returns {Promise<{ run: object | null, sha: string, spentSeconds: number }>}
 */
export async function findRun({
  exec,
  head,
  repo = null,
  sha,
  exclude = [],
  sleep,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  intervalSeconds = DEFAULT_INTERVAL_SECONDS,
}) {
  const interval = Math.max(1, intervalSeconds);
  const attempts = Math.max(0, Math.ceil(Math.max(1, timeoutSeconds) / interval));

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const run = selectRun(listRuns(exec, { head, repo }), sha, exclude);
    if (run !== null) return { run, sha, spentSeconds: attempt * interval };

    if (attempt < attempts) await sleep(interval * 1000);
  }

  return { run: null, sha, spentSeconds: attempts * interval };
}

/**
 * The command line, and the ritual it refuses to skip.
 *
 * @param {{ argv?: string[], exec?: Function, suite?: () => { ok: boolean, stdout: string }, resolveHead?: () => string, resolveSha?: () => string, sleep?: (ms: number) => Promise<void>, out?: { write: Function }, err?: { write: Function } }} [deps]
 * @returns {Promise<number>}
 */
export async function run(deps = {}) {
  const argv = deps.argv ?? process.argv.slice(2);
  const out = deps.out ?? process.stdout;
  const err = deps.err ?? process.stderr;
  const exec = deps.exec ?? defaultExec;
  const suite = deps.suite ?? defaultSuite;
  const resolveHead = deps.resolveHead ?? defaultResolveHead;
  const resolveSha = deps.resolveSha ?? defaultResolveSha;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const { options, problems } = parseArgs(argv);
  if (problems.length > 0) {
    for (const problem of problems) err.write(`open-pr: ${problem}\n`);
    err.write(`open-pr: ${USAGE}\n`);
    err.write('open-pr: nothing was created\n');
    return UNKNOWN;
  }

  // The head branch is resolved once and passed everywhere else, so the policy check, the creation and
  // the run lookup cannot disagree about which branch this is.
  const head = options.head ?? resolveHead();
  if (typeof head !== 'string' || head === '') {
    err.write('open-pr: the head branch is unknown (detached HEAD): pass --head <branch>\n');
    return UNKNOWN;
  }

  // 1. The suite. A branch that does not parse is cheaper to fix here than in a run nobody watches.
  const tested = suite();
  if (!tested.ok) {
    const count = failingCount(tested.stdout);
    const named = count === null ? '' : ` (${count} failing test${count === 1 ? '' : 's'})`;
    err.write(`open-pr: refusing: the suite is red${named}, so nothing was created\n`);
    err.write('open-pr: run node --test and fix it first\n');
    return RED;
  }
  out.write('open-pr: suite green\n');

  // 2. The policy, through the same function CI runs: its message is the failure message, and a
  // reminder here would be a second description of the rule that can drift from the first.
  let body;
  try {
    body = readFileSync(options.bodyFile, 'utf8');
  } catch (error) {
    err.write(`open-pr: cannot read --body-file ${options.bodyFile}: ${error.message}\n`);
    return UNKNOWN;
  }

  const refused = runPolicy({ PR_BODY: body, PR_LABELS: options.label, PR_HEAD_REF: head }, out, err);
  if (refused !== 0) {
    err.write('open-pr: refusing: the policy refuses this pull request, so nothing was created\n');
    return RED;
  }

  // 3. The label travels in the creation itself, which is the whole point: the `opened` run then reads
  // `PR_LABELS` filled, and a label attached afterwards never achieves that.
  const created = exec(
    withRepo(options.repo, [
      'pr',
      'create',
      '--draft',
      '--label',
      options.label,
      '--base',
      options.base,
      '--head',
      head,
      '--title',
      options.title,
      '--body-file',
      options.bodyFile,
    ]),
  );

  const pullRequest = pullRequestFrom(created?.stdout);
  if (created?.ok !== true || pullRequest === null) {
    err.write('open-pr: gh pr create failed\n');
    for (const chunk of [created?.stdout, created?.stderr]) {
      if (typeof chunk === 'string' && chunk.trim() !== '') err.write(`${chunk.trim()}\n`);
    }
    return RED;
  }
  out.write(`open-pr: ${pullRequest.url}\n`);

  // The runs that exist before `gh pr ready` belong to the events of the draft, and the
  // `ready_for_review` run is the one that decides. Their ids are snapshotted instead of their times,
  // because this clock is not the API's clock.
  const before = listRuns(exec, { head, repo: options.repo }).map((entry) => String(entry?.databaseId));

  // 4. This fires the event that decides.
  const ready = exec(withRepo(options.repo, ['pr', 'ready', String(pullRequest.number)]));
  if (ready?.ok !== true) {
    err.write(`open-pr: gh pr ready ${pullRequest.number} failed: the deciding run never fired\n`);
    return RED;
  }

  // 5. The run of this commit, polled until it exists. A wait that prints nothing is indistinguishable
  // from a hang, so the line is written before the first poll and not after the last.
  const sha = resolveSha();
  out.write(`open-pr: waiting for the run of ${sha} (up to ${options.timeout}s)\n`);

  const found = await findRun({
    exec,
    head,
    repo: options.repo,
    sha,
    exclude: before,
    sleep,
    timeoutSeconds: options.timeout,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
  });

  if (found.run === null) {
    out.write(
      `open-pr: unknown — no run of ${sha} appeared within ${options.timeout}s; this is not a failure\n`,
    );
    return UNKNOWN;
  }

  const id = String(found.run.databaseId);

  // 6. The watch is bounded, because a command that never returns is how the wait it replaces got
  // skipped in the first place.
  const remaining = Math.max(1, Math.round(options.timeout - found.spentSeconds));
  const watched = exec(
    withRepo(options.repo, [
      'run',
      'watch',
      id,
      '--exit-status',
      '--interval',
      String(DEFAULT_INTERVAL_SECONDS),
    ]),
    { timeoutMs: remaining * 1000 },
  );

  if (watched?.timedOut === true) {
    out.write(`open-pr: run ${id}\n`);
    out.write(`open-pr: unknown — the run did not conclude within ${remaining}s; this is not a failure\n`);
    return UNKNOWN;
  }

  // The watch says whether it is over; the run's own answer says what it was, and the verdict comes
  // from the matrix inside that answer. A cancelled run is not a failed one, and a summary is not a
  // gate.
  const viewed = exec(
    withRepo(options.repo, ['run', 'view', id, '--json', 'status,conclusion,jobs']),
  );
  const answer = parseJson(viewed?.stdout);
  if (answer === null) {
    out.write(`open-pr: run ${id}\n`);
    out.write('open-pr: unknown — the run concluded but its conclusion could not be read\n');
    return UNKNOWN;
  }

  // The matrix travels with the verdict, because a verdict nobody can audit is the reading this
  // script exists to replace. The id travels too, so a failure names the run it is about.
  const verdict = decideVerdict({ ...answer, databaseId: id });
  for (const line of verdict.lines ?? []) out.write(`${line}\n`);
  const reason = verdict.code === RED ? ` — ${verdict.reason}` : '';
  out.write(`open-pr: run ${id}  ·  ${verdict.state}${reason}\n`);
  out.write(`open-pr: ${pullRequest.url}  ·  ${verdict.state}\n`);
  return verdict.code;
}

/**
 * Runs `gh` and reports what it answered, including whether it ran out of time instead of answering.
 *
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [options]
 * @returns {{ ok: boolean, stdout: string, stderr: string, timedOut: boolean }}
 */
function defaultExec(args, { timeoutMs } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: timeoutMs });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    // A kill leaves no status, which is the only evidence that the bound was reached rather than the
    // command finishing with an answer.
    timedOut: result.status === null,
  };
}

/**
 * The suite, in the repository root, with both streams kept because the failing count is read from the
 * reporter's summary.
 *
 * @returns {{ ok: boolean, stdout: string }}
 */
function defaultSuite() {
  const result = spawnSync(process.execPath, ['--test'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: result.status === 0, stdout: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** @returns {string} the branch this checkout is on, or the empty string on a detached HEAD */
function defaultResolveHead() {
  const result = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

/** @returns {string} the commit this branch points at, the one the run must belong to */
function defaultResolveSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

/**
 * @param {string|null} repo
 * @param {string[]} args
 * @returns {string[]} the same arguments, addressed to `--repo` when one was named
 */
function withRepo(repo, args) {
  return repo === null ? args : [...args, '--repo', repo];
}

/**
 * @param {(args: string[], options?: object) => { ok: boolean, stdout?: string }} exec
 * @param {{ head: string, repo?: string|null }} target
 * @returns {Array<object>} the runs of that branch, newest first, or none when the API cannot answer
 */
function listRuns(exec, { head, repo = null }) {
  const answer = exec(withRepo(repo, ['run', 'list', '--branch', head, '--json', RUN_FIELDS]));
  if (answer?.ok !== true) return [];

  const runs = parseJson(answer.stdout);
  return Array.isArray(runs) ? runs : [];
}

/**
 * @param {string} text
 * @returns {any | null}
 */
function parseJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await run();
  process.exitCode = code;
}
