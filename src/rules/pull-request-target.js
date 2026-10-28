/**
 * R11 — `pull-request-target`: does a workflow combine the `pull_request_target` trigger with a
 * checkout of the pull request head? (RFC 8.3, 16 F5 G3)
 *
 * `pull_request_target` runs in the context of the base repository — with its secrets — while the
 * code under review comes from the fork. That is safe exactly as long as the head is never checked
 * out, and it is the combination, not either half, that hands repository secrets to untrusted code.
 * So the trigger alone and a head checkout alone are both passes, and the pass names which of the
 * two was found.
 *
 * The trigger is read from the top-level `on:` key through the shared reader (`declaresTrigger`),
 * never by scanning the file for the token: a `run:` body that says "we do not use
 * pull_request_target" is not a declaration. Steps come from the structural reader, so a step
 * belongs to the job that runs it and a block scalar is never a step.
 */

import { declaresTrigger, parseWorkflow } from '../lib/workflows.js';

const DOC = 'docs/rules/pull-request-target.md';

/** The trigger this rule is about. */
const TRIGGER = 'pull_request_target';

/**
 * The expressions that name the head of the pull request. A checkout of any of them is a checkout
 * of code the base repository did not review.
 */
const HEAD_REFERENCES = [
  'github.event.pull_request.head.sha',
  'github.event.pull_request.head.ref',
  'github.head_ref',
];

/** The commands that check a ref out, matched against one shell command of a `run:` body. */
const CHECKOUT_COMMANDS = [/\bgit\s+checkout\b/, /\bgh\s+pr\s+checkout\b/];

/**
 * @param {string} code
 * @param {string} reason
 */
function skip(code, reason) {
  return { status: 'skip', code, message: `skipped: ${reason}`, probeUnavailable: true };
}

/** @param {string} text */
function namesHead(text) {
  return HEAD_REFERENCES.some((name) => text.includes(name));
}

/**
 * The shell commands of one `run:` body, with backslash continuations joined, so a `git checkout`
 * and the ref it checks out are read as one command and two unrelated lines are not.
 * @param {string} run
 * @returns {string[]}
 */
function commandsOf(run) {
  const commands = [];
  let pending = '';
  for (const line of run.split(/\r\n|\n|\r/)) {
    const text = line.trim();
    if (text === '' || text.startsWith('#')) continue;
    if (text.endsWith('\\')) {
      pending += `${text.slice(0, -1).trim()} `;
      continue;
    }
    commands.push(`${pending}${text}`.trim());
    pending = '';
  }
  if (pending !== '') commands.push(pending.trim());
  return commands;
}

/**
 * The checkout of the pull request head inside one step, or null when the step is neither an
 * `actions/checkout` of the head nor a `run:` command that checks it out.
 * @param {object} step a step from the structural reader
 * @returns {{ kind: 'uses' | 'run', expression: string } | null}
 */
function headCheckout(step) {
  if (typeof step.uses === 'string') {
    if (!step.uses.toLowerCase().startsWith('actions/checkout@')) return null;
    const ref = step.with?.ref;
    if (typeof ref !== 'string' || !namesHead(ref)) return null;
    return { kind: 'uses', expression: ref };
  }

  if (typeof step.run === 'string') {
    for (const command of commandsOf(step.run)) {
      if (!namesHead(command)) continue;
      if (!CHECKOUT_COMMANDS.some((pattern) => pattern.test(command))) continue;
      return { kind: 'run', expression: command };
    }
  }

  return null;
}

export default {
  id: 'pull-request-target',
  title: 'A pull_request_target workflow does not check the pull request head out',
  label: 'pull_request_target',
  scope: ['repo'],
  targets: ['ci'],
  friction: 1,
  severity: { baseline: 'error', strict: 'error' },
  question:
    'Does a workflow combine the pull_request_target trigger with a checkout of the pull request head?',
  detection:
    'Every workflow through the structural reader. The trigger is read only from the top-level on: ' +
    'key, as a value, a flow collection or a block key, so a token in a run: body, a comment or a ' +
    "job if: is not a declaration. In a workflow that declares pull_request_target, each step is " +
    'checked for a checkout of the head: an actions/checkout step whose with.ref is ' +
    'github.event.pull_request.head.sha, github.event.pull_request.head.ref or github.head_ref ' +
    '(pull-request-target-checkout), or a run: command that checks one of them out with git checkout ' +
    'or gh pr checkout. Each offending step is one fail at the step line. The trigger without a head ' +
    'checkout is one pass (pull-request-target-without-head-checkout); workflows that never declare ' +
    'the trigger are one pass (no-pull-request-target); no workflow at all skips (no-ci) and an ' +
    'unparseable workflow skips (unparseable-workflow) without a pass on top.',
  evidence:
    'The job, the step index, the kind (uses or run) and the raw expression that checks the head ' +
    'out, at the step line. A run: step reports the command that carries the expression.',
  remediation:
    'Manual, printed as the choice to make: remove the pull_request_target trigger, or remove the ' +
    'step that checks the pull request head out, so the workflow never runs fork code with this ' +
    "repository's secrets. The tool never edits a workflow.",
  limits:
    'Proves that a declared workflow event and a declared step name the combination; it does not ' +
    'read whether the job has secrets, does not evaluate permissions:, does not resolve the ' +
    'expression (whether that ref is the fork head at run time is not decided here), and does not ' +
    'decide whether the checked-out code is built or executed. A workflow the reader cannot ' +
    'attribute is skipped per file; the rule never guesses from a line scan.',
  docs: DOC,

  /**
   * @param {object} ctx the resolved context of `src/lib/targets.js`
   * @returns {Array<object>} findings
   */
  detect(ctx) {
    const repo = ctx.repo;
    if (!repo) return [skip('no-repo', 'no repository facts were collected')];

    const workflows = repo.workflows ?? [];
    if (workflows.length === 0) {
      return [skip('no-ci', 'there is no .github/workflows directory, so no workflow can declare a trigger')];
    }

    const findings = [];
    let declares = false;
    let unreadable = false;

    for (const file of workflows) {
      const parsed = parseWorkflow(file.text);
      if (!parsed.ok) {
        unreadable = true;
        findings.push({
          status: 'skip',
          code: 'unparseable-workflow',
          path: file.path,
          message: `skipped: unparseable workflow — ${parsed.detail}`,
          evidence: { reason: parsed.reason },
        });
        continue;
      }

      if (!declaresTrigger(file.text, TRIGGER)) continue;
      declares = true;

      for (const job of parsed.jobs) {
        for (const step of job.steps) {
          const checkout = headCheckout(step);
          if (checkout === null) continue;
          findings.push({
            status: 'fail',
            code: 'pull-request-target-checkout',
            path: file.path,
            line: step.line,
            message:
              `job "${job.id}" checks out the pull request head under pull_request_target; ` +
              "the workflow runs in the base repository's context, so fork code runs with its secrets",
            evidence: {
              job: job.id,
              step: step.index,
              kind: checkout.kind,
              expression: checkout.expression,
            },
            remediation: {
              kind: 'manual',
              command: 'remove the pull_request_target trigger, or the step that checks out the pull request head',
            },
          });
        }
      }
    }

    const failed = findings.some((finding) => finding.status === 'fail');
    if (failed || unreadable) return findings;

    findings.push(
      declares
        ? {
            status: 'pass',
            code: 'pull-request-target-without-head-checkout',
            message:
              'a workflow declares pull_request_target but no step checks the pull request head ' +
              'out, so no fork code runs with the base repository context',
          }
        : {
            status: 'pass',
            code: 'no-pull-request-target',
            message:
              'no workflow declares the pull_request_target trigger, so no workflow runs fork code ' +
              'with the base repository context',
          },
    );

    return findings;
  },
};
