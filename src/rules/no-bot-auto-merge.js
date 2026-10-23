/**
 * R9 — `no-bot-auto-merge`: can a dependency update reach the default branch without a human
 * reading it? (RFC 8.2 R9, E6)
 *
 * Two independent signals. The configuration signal is evidence, never a failure: `info` is a
 * severity in the report contract, not a status, and v0.1 cannot lower one finding's severity
 * without changing the policy model, so it rides on a pass. The merge path is attributed through
 * the structural reader, so a step belongs to the job that runs it.
 */

import { parseWorkflow } from '../lib/workflows.js';

const BOT_ACTOR = /dependabot\[bot\]|renovate\[bot\]/i;

/** The automerge actions RFC 8.2 R9 names. */
const AUTOMERGE_ACTIONS = new Set([
  'peter-evans/enable-pull-request-automerge',
  'pascalgn/automerge-action',
  'alexwilson/enable-github-automerge-action',
  'reitermarkus/automerge',
]);

/** The rule, stated in the message whenever the answer is clean. */
const MERGE_RULE = 'an update is merged by a person after reading the diff and running the gate';

/**
 * @param {string} code
 * @param {string} reason
 */
function skip(code, reason) {
  return { status: 'skip', code, message: `skipped: ${reason}`, probeUnavailable: true };
}

/**
 * Cuts a trailing `# comment` that starts a word, so a quoted `#` survives.
 * @param {string} text
 * @returns {string}
 */
function stripComment(text) {
  const index = text.search(/\s#/);
  return index === -1 ? text : text.slice(0, index);
}

/**
 * Whether the workflow's top-level `on:` declaration names `pull_request_target`. The structural
 * reader models jobs and steps, not triggers, so the trigger is read from the one place YAML
 * defines it — a top-level key — and never from a scan for the token anywhere in the file.
 * @param {string} text
 * @returns {boolean}
 */
function declaresPullRequestTarget(text) {
  const lines = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = stripComment(lines[i]);
    if (line.trim() === '' || /^\s/.test(line)) continue;
    const match = /^(?:on|'on'|"on")\s*:(.*)$/.exec(line.trimEnd());
    if (match === null) continue;

    const value = stripComment(match[1]).trim();
    if (value !== '') {
      if (value.includes('pull_request_target')) return true;
      continue;
    }

    for (let j = i + 1; j < lines.length; j += 1) {
      const body = stripComment(lines[j]);
      if (body.trim() === '') continue;
      if (!/^\s/.test(body)) break;
      if (body.includes('pull_request_target')) return true;
    }
  }
  return false;
}

/** @param {object} job a job from the structural reader */
function mentionsBot(job) {
  return BOT_ACTOR.test(job.name ?? '') || BOT_ACTOR.test(job.condition ?? '');
}

/** @param {object} job a job from the structural reader */
function mentionsPullRequestTarget(job) {
  return /pull_request_target/.test(job.name ?? '') || /pull_request_target/.test(job.condition ?? '');
}

/**
 * `gh pr merge` with `--auto` or `--merge`, anywhere in a run body.
 * @param {string | null} run
 * @returns {boolean}
 */
function mergesWithGh(run) {
  if (typeof run !== 'string') return false;
  if (!/gh\s+pr\s+merge/.test(run)) return false;
  return /(?:^|[\s;|&])--(?:auto|merge)(?=$|[\s;|&])/m.test(run);
}

/**
 * A `uses` value that runs a known automerge action, whatever ref it is pinned to.
 * @param {string | null} uses
 * @returns {boolean}
 */
function automergeAction(uses) {
  if (typeof uses !== 'string' || uses === '') return false;
  const at = uses.indexOf('@');
  const name = (at === -1 ? uses : uses.slice(0, at)).toLowerCase();
  return AUTOMERGE_ACTIONS.has(name);
}

/**
 * Every value of a step that can carry a checkout reference.
 * @param {object} step a step from the structural reader
 * @returns {string[]}
 */
function stepTexts(step) {
  return [step.uses ?? '', step.run ?? '', ...Object.values(step.with ?? {})];
}

/**
 * Whether the step checks out the pull request head, the other half of the
 * `pull_request_target` hazard.
 * @param {object} step a step from the structural reader
 * @returns {boolean}
 */
function checksOutHead(step) {
  return stepTexts(step).some(
    (text) =>
      text.includes('github.event.pull_request.head.sha') || text.includes('refs/pull/'),
  );
}

export default {
  id: 'no-bot-auto-merge',
  title: 'No dependency update is merged automatically',
  scope: ['repo'],
  targets: ['ci'],
  friction: 0,
  severity: { baseline: 'error', strict: 'error' },
  question: 'Can a dependency update reach the default branch without a human reading it?',
  detection:
    'Two independent signals. Configuration: .github/dependabot.yml or .github/renovate.json ' +
    'present is one pass carrying the file list, never a failure. Merge path, through the ' +
    'structural reader: gh pr merge with --auto or --merge, or a known automerge action, in a job ' +
    'whose if/name names dependabot[bot] or renovate[bot] (automerge-for-bot); and ' +
    'pull_request_target in a job that also checks out the PR head (pr-target-head-checkout). ' +
    'An unparseable workflow skips.',
  evidence:
    'For automerge-for-bot: the job, the step index and the offending run or uses. For ' +
    'pr-target-head-checkout: the job and the line of the checkout step. For the configuration ' +
    'signal: the bot files found.',
  remediation:
    'None. There is nothing to write: removing an automation is a review decision. The message ' +
    'states the rule — an update is merged by a person after reading the diff and running the gate.',
  limits:
    'Only the four listed automerge actions are recognized, and the bot condition is matched ' +
    'textually in the job if/name. Whether a human actually read the diff is not observable: the ' +
    'rule proves no automation path is declared. A workflow the reader cannot attribute is skipped ' +
    'per file; the rule never guesses from a line scan.',
  docs: 'docs/rules/no-bot-auto-merge.md',

  /**
   * @param {object} ctx the resolved context of `src/lib/targets.js`
   * @returns {Array<object>} findings
   */
  detect(ctx) {
    const repo = ctx.repo;
    if (!repo) return [skip('no-repo', 'no repository facts were collected')];

    const botFiles = repo.botFiles ?? [];
    const findings = [];

    for (const file of repo.workflows ?? []) {
      const parsed = parseWorkflow(file.text);
      if (!parsed.ok) {
        findings.push({
          status: 'skip',
          code: 'unparseable-workflow',
          path: file.path,
          message: `skipped: unparseable workflow — ${parsed.detail}`,
          evidence: { reason: parsed.reason },
        });
        continue;
      }

      const trigger = declaresPullRequestTarget(file.text);

      for (const job of parsed.jobs) {
        if (mentionsBot(job)) {
          for (const step of job.steps) {
            if (mergesWithGh(step.run)) {
              findings.push({
                status: 'fail',
                code: 'automerge-for-bot',
                path: file.path,
                line: step.line,
                message: `job "${job.id}" runs gh pr merge for a bot actor; ${MERGE_RULE}`,
                evidence: { job: job.id, step: step.index, run: step.run },
                remediation: { kind: 'none' },
              });
              continue;
            }
            if (automergeAction(step.uses)) {
              findings.push({
                status: 'fail',
                code: 'automerge-for-bot',
                path: file.path,
                line: step.line,
                message: `job "${job.id}" runs an automerge action for a bot actor; ${MERGE_RULE}`,
                evidence: { job: job.id, step: step.index, uses: step.uses },
                remediation: { kind: 'none' },
              });
            }
          }
        }

        if (!trigger && !mentionsPullRequestTarget(job)) continue;
        const checkout = job.steps.find(checksOutHead);
        if (checkout === undefined) continue;
        findings.push({
          status: 'fail',
          code: 'pr-target-head-checkout',
          path: file.path,
          line: checkout.line,
          message: `job "${job.id}" runs on pull_request_target and checks out the pull request head; repository secrets are exposed to untrusted code`,
          evidence: { job: job.id, line: checkout.line },
          remediation: { kind: 'none' },
        });
      }
    }

    if (botFiles.length > 0) {
      findings.push({
        status: 'pass',
        code: 'bot-config-present',
        target: 'repo-root',
        message: `automated updates configured (${botFiles.join(', ')}); the merge path is checked below`,
        evidence: { files: [...botFiles] },
        remediation: { kind: 'none' },
      });
    } else if (findings.length === 0) {
      findings.push({
        status: 'pass',
        code: 'no-automerge-path',
        message: `no automated update config and no bot merge path; ${MERGE_RULE}`,
      });
    }

    return findings;
  },
};
