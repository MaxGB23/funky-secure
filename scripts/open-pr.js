/**
 * Opens a pull request through the whole ritual, in one command, because the ritual has more steps
 * than the mistake and gets skipped.
 *
 * Five round trips were lost in one day to the same class of mistake: a pull request opened without its
 * label, so the `opened` run reads `PR_LABELS` empty; a `gh run rerun --failed` that replays the frozen
 * event payload and fails identically; a wait loop keyed on the branch, so it answers with an earlier
 * commit's run; and a branch pushed with a suite that does not parse. Every one of those is cheap to
 * prevent and easy to forget, so the order lives here instead: the suite, the packed set, the policy,
 * the floor of the head commit, a labelled creation, and then the answer the set of runs past that floor
 * gives. A branch can be green and still publish the wrong file set, so what npm would pack is gated
 * before a pull request exists.
 *
 * The floor is what a snapshot of "runs that already existed" could not be. A run at or below it belongs
 * to an event fired before the creation and can never decide this pull request; the runs past it are the
 * candidates, they are polled until two consecutive reads agree, and any red candidate makes the answer
 * red because a real failure is never averaged away by a green sibling.
 *
 * A creation that fails is not yet a failure. A pull request for this head already existing is the second
 * run of one delivery, so that pull request is adopted and its runs decide, and the floor is dropped for
 * it: an adopted pull request is older than any floor a re-run can take, and a floor kept would hide
 * exactly the runs the adoption exists to report. The line says `adopted`, because a green that came
 * from a run this invocation did not create is only auditable when the output says so.
 *
 * The decisions are pure functions and every `gh` invocation goes through one injected `exec`, so the
 * tests read a verdict without a network, a repository or a pull request.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
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

  // Asking how it works is not a malformed command line: it answers 0 and creates nothing.
  if (argv.includes('--help') || argv.includes('-h')) return { options, problems, help: true };

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
 * The floor: the greatest run id of one commit, read **before** the pull request is created. Every run
 * at or below it belongs to an event fired before that read, so none of them can decide this pull
 * request. `0` when the commit has no run yet, which is the honest zero: an empty list is a
 * measurement, while a failed read is not and never reaches here.
 *
 * The decision is by commit, never by being the newest run of the branch: `gh run list --branch`
 * answers the newest run first, and while the run of the new commit is still queued, that answer
 * belongs to the previous one.
 *
 * @param {Array<{ databaseId?: number|string, headSha?: string }>} runs
 * @param {string} sha
 * @returns {number}
 */
export function floorOf(runs, sha) {
  if (!Array.isArray(runs)) return 0;

  let floor = 0;
  for (const run of runs) {
    if (run?.headSha !== sha) continue;
    const id = Number(run?.databaseId);
    if (Number.isFinite(id) && id > floor) floor = id;
  }

  return floor;
}

/**
 * The candidates: the runs of one commit past the floor. More than one is normal — a creation carrying
 * its label fires both `opened` and `labeled` — and every one of them has a say in the answer.
 *
 * @param {Array<{ databaseId?: number|string, headSha?: string }>} runs
 * @param {string} sha
 * @param {number} [floor]
 * @returns {Array<{ databaseId?: number|string, headSha?: string, status?: string, conclusion?: string }>}
 */
export function runsPastFloor(runs, sha, floor = 0) {
  if (!Array.isArray(runs)) return [];

  const reading = Number(floor);
  const threshold = Number.isFinite(reading) ? reading : 0;

  return runs.filter((run) => {
    const id = Number(run?.databaseId);
    return run?.headSha === sha && Number.isFinite(id) && id > threshold;
  });
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
 * The pull request of one head, from `gh pr list --head <head> --json number,url`. The answer is a list
 * whether the head has one pull request or none, and a row without a number or a URL is not one the
 * ritual can act on.
 *
 * @param {string} stdout
 * @returns {{ url: string, number: number } | null}
 */
export function pullRequestFromList(stdout) {
  const rows = parseJson(stdout);
  if (!Array.isArray(rows)) return null;

  const row = rows.find(
    (entry) => Number.isFinite(Number(entry?.number)) && typeof entry?.url === 'string',
  );
  return row === undefined ? null : { url: row.url, number: Number(row.number) };
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
 * The candidate set, once it stops moving. Each attempt reads twice and compares those two reads, so
 * consecutiveness is a property of the shape and not of a variable that has to be cleared: an empty
 * read is never half of an agreement, because it is never compared with the read before it.
 *
 * An empty read resets by construction and the attempt sleeps. A non-empty set that differs between its
 * two reads grew while it was read, so a third read is owed, not a refusal — `opened` and `labeled`
 * arrive one poll apart on every real pull request, and refusing at the first growth would answer `2`
 * on all of them. The budget, not the first disagreement, decides when to stop looking.
 *
 * The bound is a count of attempts rather than a clock, so a test drives it without waiting and a real
 * wait still stops.
 *
 * @param {{ exec: Function, head: string, repo?: string|null, sha: string, floor: number, sleep: (ms: number) => Promise<void>, timeoutSeconds?: number, intervalSeconds?: number }} options
 * @returns {Promise<{ runs: Array<object> | null, spentSeconds: number, grown: string[] }>} the set that
 * held still, or nothing and every id seen on the way, in the order it was first seen.
 */
async function waitForCandidates({
  exec,
  head,
  repo = null,
  sha,
  floor,
  sleep,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  intervalSeconds = DEFAULT_INTERVAL_SECONDS,
}) {
  const interval = Math.max(1, intervalSeconds);
  const attempts = Math.max(0, Math.ceil(Math.max(1, timeoutSeconds) / interval));

  const grown = [];
  // Every poll is bounded by what is left of the budget, not by the whole of it: four calls that may
  // each spend the full --timeout add up to four times it. A child with no ceiling does not fail, it
  // hangs.
  const poll = (timeoutMs) => {
    const answer = readRuns(exec, { head, repo, timeoutMs });
    return answer.runs === null ? [] : runsPastFloor(answer.runs, sha, floor);
  };
  const remember = (candidates) => {
    for (const run of candidates) {
      const id = String(run.databaseId);
      if (!grown.includes(id)) grown.push(id);
    }
    return candidates.map((run) => String(run.databaseId));
  };

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const budget = () => Math.max(1, Math.ceil(timeoutSeconds - attempt * interval)) * 1000;
    const first = remember(poll(budget()));

    if (first.length > 0) {
      // Read immediately after the first, so the two are consecutive by construction.
      const candidates = poll(budget());
      if (sameIds(first, remember(candidates))) {
        return { runs: candidates, spentSeconds: attempt * interval, grown };
      }
    }

    if (attempt < attempts) await sleep(interval * 1000);
  }

  return { runs: null, spentSeconds: attempts * interval, grown };
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {boolean} the two reads name the same ids, in the same order
 */
function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * The command line, and the ritual it refuses to skip.
 *
 * @param {{ argv?: string[], exec?: Function, suite?: () => { ok: boolean, stdout: string }, pack?: () => { ok: boolean, timedOut?: boolean, stdout?: string, problem?: string } | null, resolveHead?: () => string, resolveSha?: () => string, resolveRemote?: (options: object) => { ok: boolean, sha?: string|null, problem?: string }, now?: () => number, sleep?: (ms: number) => Promise<void>, out?: { write: Function }, err?: { write: Function } }} [deps]
 * @returns {Promise<number>}
 */
export async function run(deps = {}) {
  const argv = deps.argv ?? process.argv.slice(2);
  const out = deps.out ?? process.stdout;
  const err = deps.err ?? process.stderr;
  const exec = deps.exec ?? defaultExec;
  const suite = deps.suite ?? defaultSuite;
  const pack = deps.pack ?? defaultPack;
  const resolveHead = deps.resolveHead ?? defaultResolveHead;
  const resolveSha = deps.resolveSha ?? defaultResolveSha;
  const resolveRemote = deps.resolveRemote ?? defaultResolveRemote;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const { options, problems, help } = parseArgs(argv);
  if (help === true) {
    out.write(`open-pr: ${USAGE}\n`);
    return 0;
  }

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

  // 2. The packed set, through `npm run pack:check`, the guard that reads what npm would actually
  // publish. A branch can be green and still publish a tarball that leaks a scratch note or ships less
  // than the `files` contract promised, and that mistake is found after publication if it is found at
  // all. Every step below this one comes after it, so a refusal here means nothing was created.
  const packed = pack();
  // A gate killed at its ceiling did not fail: it never answered, and nothing about the packed set is
  // known. Saying red would report a check as broken when it was never made.
  if (packed?.timedOut === true) {
    out.write(
      `open-pr: unknown — the packed-set gate did not answer within its ceiling of ${PACK_TIMEOUT_MS / 1000}s, ` +
        'so nothing was created and its verdict is unknown; this is not a failure\n',
    );
    return UNKNOWN;
  }
  // A gate that could not start did not answer either, and it is not evidence about the packed set.
  if (typeof packed?.problem === 'string') {
    out.write(`open-pr: unknown — ${packed.problem}, so nothing was created; this is not a failure\n`);
    return UNKNOWN;
  }
  if (packed !== null && packed.ok !== true) {
    err.write('open-pr: refusing: the packed-set gate is red, so nothing was created\n');
    // The gate's own words: "the packed set is not the files contract" names nothing without the path
    // that broke it, and the gate is the one place that knows which path it was.
    if (typeof packed.stdout === 'string' && packed.stdout.trim() !== '') {
      err.write(`${packed.stdout.trim()}\n`);
    }
    err.write('open-pr: run npm run pack:check and fix it first\n');
    return RED;
  }
  if (packed !== null) out.write(`open-pr: packed set green — ${packedFinding(packed.stdout)}\n`);

  // 3. The policy, through the same function CI runs: its message is the failure message, and a
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

  // 4. The floor, read before the creation. A floor nobody could read is not zero: creating on top of
  // an unknown floor is how a run of an earlier event gets to decide this pull request. So a read that
  // cannot answer refuses here, before anything exists, and names itself with what `gh` printed.
  const sha = resolveSha();

  // 4a. The remote branch, read before anything exists. The creation builds the pull request from it,
  // so a commit that was never pushed makes step 6 ask about a commit the pull request does not
  // contain: the runs would answer for other content, and the wait would sit out its whole budget on a
  // question that has no answer. Measured on #241, whose head was the previous commit while this tree
  // was one ahead: ten minutes, then `unknown`, both true and both useless.
  const remote = resolveRemote({ head, timeoutMs: LOCAL_GIT_TIMEOUT_MS });
  if (remote?.ok !== true) {
    err.write(
      `open-pr: refusing: ${remote?.problem ?? 'the remote branch could not be read'}; the remote branch is unknown, so nothing was created\n`,
    );
    out.write('open-pr: unknown — nothing was created so its verdict is unknown; this is not a failure\n');
    return UNKNOWN;
  }
  if (remote.sha === null) {
    err.write(`open-pr: refusing: the remote has no branch ${head}, so there is nothing to create from\n`);
    out.write('open-pr: unknown — nothing was created so its verdict is unknown; this is not a failure\n');
    return UNKNOWN;
  }
  if (remote.sha !== sha) {
    err.write(
      `open-pr: refusing: the remote branch ${head} is at ${remote.sha}, your HEAD is ${sha}: push it and run this again\n`,
    );
    out.write('open-pr: unknown — nothing was created so its verdict is unknown; this is not a failure\n');
    return UNKNOWN;
  }
  // 4b. One budget, taken once. Before this the number `--timeout` names was spent by every child in
  // turn — 600 for the floor, 600 for the creation, 600 for the wait and 600 for each `run view` — so a
  // declared ten minutes could hold the ritual open for forty. Every child now reads what is left, and
  // the floor of one second keeps the last attempt possible instead of making it zero.
  const deadline = now() + options.timeout * 1000;
  const remainingMs = () => Math.max(1_000, deadline - now());
  const remainingSeconds = () => Math.max(1, Math.round(remainingMs() / 1000));

  const floorAnswer = readRuns(exec, {
    head,
    repo: options.repo,
    timeoutMs: remainingMs(),
  });
  if (floorAnswer.runs === null) {
    err.write(`open-pr: refusing: ${floorAnswer.problem}; the floor is unknown, so nothing was created\n`);
    return UNKNOWN;
  }
  const floor = floorOf(floorAnswer.runs, sha);

  // 5. The label travels in the creation itself, which is the whole point: the `opened` run then reads
  // `PR_LABELS` filled, and a label attached afterwards never achieves that. The creation is also the
  // only event: no draft, so there is no `pr ready` to fire a second run for the same commit.
  const created = exec(
    withRepo(options.repo, [
      'pr',
      'create',
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
    { timeoutMs: remainingMs() },
  );

  // 5a. A creation that fails is not yet a failure. A pull request for this head already existing is the
  // second run of one delivery — the first got as far as the creation — and adopting it is the difference
  // between reporting its runs and making the reader look up `gh pr list` by hand. "There is none" and
  // "nobody could tell" are different answers, and only the first is a red.
  let pullRequest = pullRequestFrom(created?.stdout);
  let adopted = false;
  if (created?.ok !== true || pullRequest === null) {
    const open = readOpenPullRequest(exec, { head, repo: options.repo, timeoutMs: remainingMs() });
    if (open.pullRequest !== null) {
      pullRequest = open.pullRequest;
      adopted = true;
    } else if (open.problem !== null) {
      err.write(
        `open-pr: unknown — the creation failed and ${open.problem}, so whether a pull request exists is unknown; check gh pr list --head ${head}\n`,
      );
      return UNKNOWN;
    } else {
      err.write('open-pr: gh pr create failed\n');
      for (const chunk of [created?.stdout, created?.stderr]) {
        if (typeof chunk === 'string' && chunk.trim() !== '') err.write(`${chunk.trim()}\n`);
      }
      return RED;
    }
  }
  // The adoption is said out loud: a green that came from a run this invocation did not create is only
  // auditable when the output says which pull request it was and that nothing was created.
  out.write(
    adopted
      ? `open-pr: adopted ${pullRequest.url} — a pull request for ${head} already existed, so none was created\n`
      : `open-pr: ${pullRequest.url}\n`,
  );

  // 6. The runs of this commit past the floor, polled until the set stops moving. A wait that prints
  // nothing is indistinguishable from a hang, so the line is written before the first poll.
  const waitSeconds = remainingSeconds();
  out.write(`open-pr: waiting for the runs of ${sha} (up to ${waitSeconds}s)\n`);

  const found = await waitForCandidates({
    exec,
    head,
    repo: options.repo,
    sha,
    // An adopted pull request is identified by its head and never by the floor: its runs were fired
    // before any floor this invocation could take, so the floor would hide exactly the runs the
    // adoption exists to report.
    floor: adopted ? 0 : floor,
    sleep,
    timeoutSeconds: waitSeconds,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
  });

  if (found.runs === null) {
    if (found.grown.length > 0) {
      out.write(
        `open-pr: unknown — the set of runs of ${sha} was still changing (${found.grown.join(', ')}); this is not a failure\n`,
      );
    } else {
      out.write(
        `open-pr: unknown — no run of ${sha} appeared within ${waitSeconds}s; this is not a failure\n`,
      );
    }
    return UNKNOWN;
  }

  // 7. Every candidate answers for itself. A watch is bounded by what is left of the budget, because a
  // command that never returns is how the wait it replaces got skipped in the first place. A ceiling
  // reached is a fact about the wait, not about the run: the candidate is undecided so far, never the
  // answer, because another candidate may already be red and this run may have concluded while the wait
  // ran out. So the loop carries on and the read below decides, for every candidate, always.
  const judged = [];
  for (const candidate of found.runs) {
    const id = String(candidate.databaseId);
    let ceiling = false;

    if (candidate.status !== 'completed') {
      const watchBudget = remainingMs();
      const watched = exec(
        withRepo(options.repo, [
          'run',
          'watch',
          id,
          '--exit-status',
          '--interval',
          String(DEFAULT_INTERVAL_SECONDS),
        ]),
        { timeoutMs: watchBudget },
      );
      ceiling = watched?.timedOut === true;
    }

    // The watch says whether it stopped waiting; the run's own answer says what it was, and the verdict
    // comes from the matrix inside that answer. A cancelled run is not a failed one, and a summary is
    // not a gate.
    const viewed = exec(
      withRepo(options.repo, ['run', 'view', id, '--json', 'status,conclusion,jobs']),
      { timeoutMs: remainingMs() },
    );
    const answer = parseJson(viewed?.stdout);
    if (answer === null) {
      out.write(`open-pr: run ${id}  ·  unknown\n`);
      out.write('open-pr: unknown — the run concluded but its conclusion could not be read\n');
      judged.push({ id, code: UNKNOWN, state: 'unknown', lines: [], reason: 'unreadable' });
      continue;
    }

    // The matrix travels with the verdict, because a verdict nobody can audit is the reading this
    // script exists to replace. The id travels too: more than one run can decide, and a failure names
    // the run it is about.
    const verdict = decideVerdict({ ...answer, databaseId: id });
    const reason = verdict.code === RED ? ` — ${verdict.reason}` : '';
    out.write(`open-pr: run ${id}  ·  ${verdict.state}${reason}\n`);
    if (verdict.code === UNKNOWN && ceiling) {
      out.write(
        `open-pr: unknown — the run did not conclude within ${waitSeconds}s; this is not a failure\n`,
      );
    }
    for (const line of verdict.lines ?? []) out.write(`${line}\n`);
    judged.push({ id, ...verdict });
  }

  // 8. The set, combined. Any red candidate makes the whole answer red — a green sibling never averages
  // a real failure away, and neither does a wait that gave up — and agreement that is not green is not
  // a verdict either, so each candidate that stayed undecided is named.
  const red = judged.find((entry) => entry.code === RED) ?? null;
  const allGreen = judged.length > 0 && judged.every((entry) => entry.code === GREEN);

  if (red === null && !allGreen) {
    const undecided = judged.filter((entry) => entry.code !== GREEN).map((entry) => entry.id);
    const named =
      undecided.length === 1
        ? `run ${undecided[0]} stayed undecided`
        : `runs ${undecided.join(', ')} stayed undecided`;
    out.write(`open-pr: unknown — ${named}; this is not a failure\n`);
  }

  const code = red !== null ? RED : allGreen ? GREEN : UNKNOWN;
  const state = red !== null ? 'failed' : allGreen ? 'passed' : 'unknown';

  out.write(`open-pr: ${pullRequest.url}  ·  ${state}\n`);
  return code;
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
/** A suite that runs longer than this is not slow: a test is holding the event loop open. */
const SUITE_TIMEOUT_MS = 900_000;

/**
 * How the suite child is started. The timeout is the point: `node --test` on a test that opens a
 * server and never closes it does not fail, it hangs, and this script exists so no turn is lost to a
 * wait that cannot end — including the wait for its own suite.
 *
 * @returns {{ cwd: string, encoding: 'utf8', maxBuffer: number, timeout: number }}
 */
export function suiteOptions() {
  return { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: SUITE_TIMEOUT_MS };
}

function defaultSuite() {
  const result = spawnSync(process.execPath, ['--test'], suiteOptions());
  return { ok: result.status === 0, stdout: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** A packed-set gate that runs longer than this is not slow: `npm pack` is stuck on a cache or a lock. */
const PACK_TIMEOUT_MS = 120_000;

/**
 * How the packed-set child is started. Its ceiling is its own, next to the suite's and for the same
 * reason: `npm pack` on a cold cache or behind a held lock can wait, and a step that can wait forever is
 * the step that gets skipped. `extra` is merged over the defaults so a caller can narrow or add to it.
 *
 * @param {object} [extra]
 * @returns {{ cwd: string, encoding: 'utf8', maxBuffer: number, timeout: number }}
 */
export function packOptions(extra = {}) {
  return { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: PACK_TIMEOUT_MS, ...extra };
}

/**
 * npm's CLI resolved through the directories on `PATH`, as a file this interpreter can run.
 *
 * The other two sources are not enough on their own: `npm_execpath` exists only when npm started this
 * process, and the bundled CLI exists only where npm ships with the interpreter — which is not how npm
 * is installed on most Unix systems. There `npm` on `PATH` is a symlink to `npm-cli.js`, so resolving
 * the link gives a script rather than a shell shim. The probes are injected so the search is testable
 * on a machine that has neither case.
 *
 * @param {{ env?: object, exists?: Function, real?: Function }} [probe]
 * @returns {string[]}
 */
export function npmOnPath({
  env = process.env,
  exists = existsSync,
  real = (path) => realpathSync.native(path),
} = {}) {
  const found = [];

  for (const directory of String(env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (directory === '') continue;
    for (const name of ['npm', 'npm-cli.js', 'npm.cmd']) {
      const candidate = join(directory, name);
      if (!exists(candidate)) continue;

      let target;
      try {
        target = real(candidate);
      } catch {
        continue; // a dangling link is not a candidate
      }
      if (typeof target !== 'string' || !target.endsWith('.js') || !exists(target)) continue;
      if (!found.includes(target)) found.push(target);
    }
  }

  return found;
}

/**
 * npm's own CLI entry point, run by this interpreter: `npm` is a `.cmd` shim on Windows and is not
 * spawnable without a shell, which would buy quoting bugs for a command with no arguments.
 *
 * @returns {string | null}
 */
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ...npmOnPath(),
  ].filter((value) => typeof value === 'string' && existsSync(value));

  return candidates[0] ?? null;
}

/**
 * The packed-set gate as the child `npm run pack:check` runs, in the repository root. Both streams are
 * kept, because a red gate's output is forwarded as the reason and its exit is what the refusal reads.
 *
 * @returns {{ ok: boolean, stdout: string, timedOut: boolean, problem?: string }}
 */
function defaultPack() {
  const cli = npmCli();
  if (cli === null) {
    return {
      ok: false,
      stdout: '',
      timedOut: false,
      problem: 'npm could not be found, so the packed-set gate could not start',
    };
  }

  const result = spawnSync(process.execPath, [cli, 'run', 'pack:check'], packOptions());
  return {
    ok: result.status === 0,
    stdout: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    // A kill leaves no status, which is the only evidence that the bound was reached rather than npm
    // answering with a refusal.
    timedOut: result.status === null,
  };
}

/**
 * The one line naming what a green gate found, taken from the gate rather than written again here: npm
 * prints its own banner on stdout, so the gate's line is picked out by its prefix and not by position.
 *
 * @param {string} stdout
 * @returns {string}
 */
function packedFinding(stdout) {
  const prefix = 'pack-guard:';
  const lines = String(stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix));

  return lines.length === 0 ? 'the packed set answered green' : lines[0].slice(prefix.length).trim();
}

/** A local git call that takes longer than this is not slow: it is stuck on a lock. */
const LOCAL_GIT_TIMEOUT_MS = 30_000;

/** @returns {string} the branch this checkout is on, or the empty string on a detached HEAD */
function defaultResolveHead() {
  const result = spawnSync('git', ['branch', '--show-current'], {
    encoding: 'utf8',
    timeout: LOCAL_GIT_TIMEOUT_MS,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

/** @returns {string} the commit this branch points at, the one the run must belong to */
function defaultResolveSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: LOCAL_GIT_TIMEOUT_MS,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

/**
 * The commit the branch on the remote actually has. `gh pr create` builds the pull request from that
 * branch, so that commit is the only one whose runs say anything about the pull request. `resolveSha`
 * answers about the tree in front of us instead, and the two agree only after a push.
 *
 * @param {{ head?: string, timeoutMs?: number }} [options]
 * @returns {{ ok: boolean, sha?: string|null, problem?: string }} `sha` is null when the remote has no
 * such branch. A read that cannot answer is a failure and not an empty answer: an unreadable remote is
 * not evidence that the two commits are the same one.
 */
function defaultResolveRemote({ head = '', timeoutMs = LOCAL_GIT_TIMEOUT_MS } = {}) {
  const result = spawnSync('git', ['ls-remote', 'origin', `refs/heads/${head}`], {
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (result.status !== 0) {
    const said = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    return { ok: false, problem: said === '' ? 'git ls-remote did not answer' : said };
  }
  const line = String(result.stdout ?? '').trim();
  if (line === '') return { ok: true, sha: null };
  return { ok: true, sha: line.split(/\s+/)[0] };
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
 * @param {(args: string[], options?: object) => { ok: boolean, stdout?: string, stderr?: string }} exec
 * @param {{ head: string, repo?: string|null }} target
 * @returns {{ runs: Array<object> | null, problem: string | null }} the runs of that branch, or why the
 * API could not answer. An answer that is not a list is a failure and not an empty list: a floor read
 * from a broken answer is a floor nobody read.
 */
function readRuns(exec, { head, repo = null, timeoutMs }) {
  const answer = exec(withRepo(repo, ['run', 'list', '--branch', head, '--json', RUN_FIELDS]), {
    timeoutMs,
  });
  if (answer?.ok !== true) return { runs: null, problem: describe('gh run list', answer) };

  const runs = parseJson(answer.stdout);
  if (!Array.isArray(runs)) return { runs: null, problem: 'gh run list printed something that is not JSON' };

  return { runs, problem: null };
}

/**
 * @param {(args: string[], options?: object) => { ok: boolean, stdout?: string, stderr?: string }} exec
 * @param {{ head: string, repo?: string|null, timeoutMs?: number }} target
 * @returns {{ pullRequest: { url: string, number: number } | null, problem: string | null }} the pull
 * request of that head, or why the API could not answer. "There is none" and "nobody could tell" are
 * different answers, and collapsing them is how an unreadable API becomes the claim that no pull request
 * exists. An answer that is not a list of rows is a failure and not an empty list, for the reason
 * `readRuns` gives.
 */
function readOpenPullRequest(exec, { head, repo = null, timeoutMs }) {
  const answer = exec(withRepo(repo, ['pr', 'list', '--head', head, '--json', 'number,url']), {
    timeoutMs,
  });
  if (answer?.ok !== true) return { pullRequest: null, problem: describe('gh pr list', answer) };
  if (!Array.isArray(parseJson(answer.stdout))) {
    return { pullRequest: null, problem: 'gh pr list printed something that is not JSON' };
  }

  return { pullRequest: pullRequestFromList(answer.stdout), problem: null };
}

/**
 * One line naming what a `gh` call could not do, taken from what it printed. A failure that says only
 * "not ok" leaves the reader to guess between a missing run, a missing login and a broken network.
 *
 * @param {string} step
 * @param {{ stderr?: string } | undefined} answer
 * @returns {string}
 */
function describe(step, answer) {
  const detail = String(answer?.stderr ?? '').trim().split('\n')[0];
  return detail === '' ? `${step} failed` : `${step} failed: ${detail}`;
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
