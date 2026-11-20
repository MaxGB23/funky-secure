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

import { repoSkipMessage } from '../lib/scope.js';
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

/**
 * A pull request number as the workflow writes it: a literal, or an expression that names one. It is
 * matched as written and never evaluated, so a number that arrives as an expression is still a
 * literal reference for this rule.
 */
const PR_NUMBER = String.raw`(?:\d+|\$\{\{[^}]*\}\})`;

/**
 * The reference a pull request number addresses: `refs/pull/<number>/head`,
 * `refs/pull/<number>/merge`, and the `pull/<number>/head` refspec a fetch names. `pull/` with a
 * word boundary covers the `refs/`-prefixed and the bare form without matching a longer token.
 */
const PULL_HEAD_REFERENCE = new RegExp(String.raw`\bpull/${PR_NUMBER}\/(?:head|merge)\b`);

/** `gh pr checkout <number>`, which reaches the head by number rather than by expression. */
const PR_NUMBER_CHECKOUT = new RegExp(String.raw`\bgh\s+pr\s+checkout\s+${PR_NUMBER}`);

/** A `git fetch` that brings a pull request head into `FETCH_HEAD`. */
const PULL_HEAD_FETCH = new RegExp(String.raw`\bgit\s+fetch\b.*\bpull/${PR_NUMBER}\/(?:head|merge)\b`);

/**
 * The checkout that reads what that fetch left in `FETCH_HEAD`: the commands that turn a fetched ref
 * into a working tree. `git merge` is here because merging `FETCH_HEAD` runs the fetched commit's own
 * hooks and merges, which is as much a read of untrusted code as a checkout is.
 */
const FETCH_HEAD_CHECKOUT =
  /\bgit\s+(?:checkout|switch|merge|restore)\b.*\bFETCH_HEAD\b|\bgit\s+reset\s+--hard\b.*\bFETCH_HEAD\b/;

/**
 * The commands that check a ref out, matched against one shell command of a `run:` body. The list is
 * the verbs a workflow actually uses: `git checkout`, `git switch`, `git worktree add`, a hard reset
 * onto the ref, `git restore --source` and `gh pr checkout`. Naming the head without one of these is
 * not a checkout — `run: echo "${{ github.event.pull_request.head.sha }}"` reports the commit under
 * review and reads nothing.
 */
const CHECKOUT_COMMANDS = [
  /\bgit\s+checkout\b/,
  /\bgh\s+pr\s+checkout\b/,
  /\bgit\s+switch\b/,
  /\bgit\s+worktree\s+add\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+restore\b.*--source/,
];

/**
 * @param {string} code
 * @param {string} reason
 */
function skip(code, reason) {
  return { status: 'skip', code, message: `skipped: ${reason}`, probeUnavailable: true };
}

/** @param {string} text */
function namesHead(text) {
  return (
    HEAD_REFERENCES.some((name) => text.includes(name)) ||
    PULL_HEAD_REFERENCE.test(text) ||
    PR_NUMBER_CHECKOUT.test(text)
  );
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
 * The checkout of the pull request head inside one step, or null when the step neither receives the
 * head in a `with:` value nor runs a command that checks it out.
 * @param {object} step a step from the structural reader
 * @returns {{ kind: 'uses' | 'run', expression: string } | null}
 */
function headCheckout(step) {
  // Any action, not only `actions/checkout`: a third-party or local composite action that receives
  // the head in a `with:` value puts the same untrusted tree in the same working directory, and the
  // name of the action is not what makes the combination dangerous.
  if (typeof step.uses === 'string') {
    const values = Object.values(step.with ?? {}).filter((value) => typeof value === 'string');
    const head = values.find((value) => namesHead(value));
    if (head === undefined) return null;
    return { kind: 'uses', expression: head };
  }

  if (typeof step.run === 'string') {
    let fetchedHead = null;
    for (const command of commandsOf(step.run)) {
      const fetchesHead = PULL_HEAD_FETCH.test(command);
      const checksOutFetchHead = FETCH_HEAD_CHECKOUT.test(command);

      // A direct checkout that names the head in the same command. A `git fetch` of the pull head
      // also names it, so it is only a checkout here when the same command reads `FETCH_HEAD`.
      if (namesHead(command) && CHECKOUT_COMMANDS.some((pattern) => pattern.test(command))) {
        if (!fetchesHead || checksOutFetchHead) return { kind: 'run', expression: command };
      }

      if (fetchesHead) fetchedHead = command;
      if (fetchedHead !== null && checksOutFetchHead) {
        return { kind: 'run', expression: fetchedHead };
      }
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
    'checked for a checkout of the head (pull-request-target-checkout), and the two kinds of step ' +
    'are read by different criteria. An action is any uses: whose any with: value names the head, ' +
    'whatever the action is: actions/checkout, a third-party checkout or a local composite action. ' +
    'A run: command is one that both names the head and checks it out: git checkout, git switch, ' +
    'git worktree add, a hard reset onto it, git restore --source, git merge onto FETCH_HEAD, or ' +
    'gh pr checkout. A command that names the head and checks nothing out is not a checkout and the ' +
    'step passes. The head is named by an ' +
    'expression (github.event.pull_request.head.sha, github.event.pull_request.head.ref or ' +
    'github.head_ref) or by the reference a pull request number addresses ' +
    '(refs/pull/<number>/head, refs/pull/<number>/merge, gh pr checkout <number>, or a ' +
    'pull/<number>/head fetch followed by a FETCH_HEAD checkout); both count, and a number-addressed ' +
    'head is recognized from the literal reference without resolving it. Each offending step is one ' +
    'fail at the step line. The trigger without a head checkout is one pass ' +
    '(pull-request-target-without-head-checkout); workflows that never declare the trigger are one ' +
    'pass (no-pull-request-target); no workflow at all skips (no-ci) and an unparseable workflow ' +
    'skips (unparseable-workflow) without a pass on top.',
  evidence:
    'The job, the step index, the kind (uses or run) and the raw expression or reference that checks ' +
    'the head out, at the step line. For an action, the with: value that carries the head; for a ' +
    'run: step, the command that carries the expression or reference.',
  remediation:
    'Manual, printed as the choice to make: remove the pull_request_target trigger, or remove the ' +
    'step that checks the pull request head out, so the workflow never runs fork code with this ' +
    "repository's secrets. The tool never edits a workflow.",
  limits:
    'Proves that a declared workflow event and a declared step name the combination; it does not ' +
    'read whether the job has secrets, does not evaluate permissions:, does not resolve an ' +
    'expression (whether that ref is the fork head at run time is not decided here), and does not ' +
    'decide whether the checked-out code is built or executed. A with: value that names the head is ' +
    'read as a checkout reference, which is an inference: an action that receives the head and never ' +
    'reads it is indistinguishable here, and the rule reports it rather than guessing which actions ' +
    'consume their input. A head reached by pull request number ' +
    'is the exception: refs/pull/<number>/head, refs/pull/<number>/merge, gh pr checkout <number> ' +
    'and a pull/<number>/head fetch followed by a FETCH_HEAD checkout are literal references, ' +
    'recognized without resolving anything, so the expression limit does not reach them. A workflow ' +
    'the reader cannot attribute is skipped per file; the rule never guesses from a line scan. A ' +
    'with: map is read in both spellings the reader models — the block map and the flow form ' +
    'with: { ref: ... } on the key line (I-82) — so neither spelling hides a head, and a with: map ' +
    'that does not close on its own line makes the workflow unparseable, which is a skip and never ' +
    'a pass.',
  docs: DOC,

  /**
   * @param {object} ctx the resolved context of `src/lib/targets.js`
   * @returns {Array<object>} findings
   */
  detect(ctx) {
    const repo = ctx.repo;
    if (!repo) {
      return [
        { status: 'skip', code: 'no-repo', message: repoSkipMessage(ctx), probeUnavailable: true },
      ];
    }

    const workflows = repo.workflows ?? [];
    if (workflows.length === 0) {
      return [skip('no-ci', 'there is no workflow file, so no workflow can declare a trigger')];
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
