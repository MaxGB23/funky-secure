/**
 * R8 — `actions-pinned-sha`: can a CI workflow change under you without a commit?
 * (RFC 8.2 R8, E6)
 *
 * The rule is stated against the structural workflow reader, never against a line scan: a
 * `uses:`-anchored scan finds none of the real steps and takes false positives from block scalars,
 * folded values and `with:` keys (E6). A step is what the reader says is a step.
 */

import { repoSkipMessage } from '../lib/scope.js';
import { parseWorkflow } from '../lib/workflows.js';

const FULL_SHA = /^[0-9a-fA-F]{40}$/;
const SHORT_SHA = /^[0-9a-fA-F]{7,39}$/;
const DOCKER_DIGEST = /@sha256:[0-9a-fA-F]{64}$/;
const DOCKER_SCHEME = 'docker://';

/**
 * A docker reference split where Docker splits it: the tag is what follows the last `:` only when that
 * `:` comes after the last `/`, and a reference that already carries an `@` carries a digest instead.
 * Splitting on the last colon alone reads the scheme's own colon when the reference names no tag, a
 * registry's port when it names one, and the algorithm's colon when it carries a digest it cannot
 * accept, printing `uses: docker@sha256:<64 hex> # //node`,
 * `uses: docker://registry@sha256:<64 hex> # 5000/app` and
 * `uses: docker://alpine@sha256@sha256:<64 hex> # aaa…` — none of which is a reference the file can
 * take, and the second silently swaps the image.
 *
 * @param {string} uses the whole `uses` value, scheme included
 * @returns {{ image: string, tag: string | null, digest: string | null }} the reference without its tag
 *   or digest, the tag, and the digest when it carries one
 */
function splitDocker(uses) {
  const rest = uses.slice(DOCKER_SCHEME.length);
  const at = rest.indexOf('@');
  if (at !== -1) {
    return { image: uses.slice(0, DOCKER_SCHEME.length + at), tag: null, digest: rest.slice(at + 1) };
  }
  const colon = rest.lastIndexOf(':');
  if (colon === -1 || colon < rest.lastIndexOf('/')) {
    return { image: uses, tag: null, digest: null };
  }
  return {
    image: uses.slice(0, DOCKER_SCHEME.length + colon),
    tag: rest.slice(colon + 1),
    digest: null,
  };
}

/**
 * What is wrong with a container reference, as the sentence the message carries.
 * @param {{ tag: string | null, digest: string | null }} split
 * @returns {string}
 */
function dockerForm({ tag, digest }) {
  if (digest !== null) {
    const [algorithm, value = ''] = digest.split(':');
    return algorithm === 'sha256'
      ? `carries a sha256 digest of ${value.length} hex characters, not 64`
      : `carries a ${algorithm} digest, and only sha256 is accepted`;
  }
  if (tag === null) return 'names no tag, so it resolves to latest and moves';
  return 'is a mutable container tag';
}

/**
 * The shape the remediation prints, built from what the finding already knows: the action and the ref
 * that moves. The tool never resolves the SHA (RFC 4.9) — that would be a network call — but a template
 * that says `owner/repo` makes the reader retype both facts, and <sha> alone does not say what goes
 * before the `@`. Measured in a field report: the reader had to copy the action name out of the
 * message by hand for every finding.
 *
 * @param {string} target the action (or image) the reference names
 * @param {string} ref the tag or branch that moves, empty when the reference names none
 * @returns {{ kind: string, command: string }}
 */
function remediationFor(target, ref) {
  return {
    kind: 'manual',
    command: ref === '' ? `uses: ${target}@<sha>` : `uses: ${target}@<sha> # ${ref}`,
  };
}

/**
 * @param {string} code
 * @param {string} reason
 */
function skip(code, reason) {
  return { status: 'skip', code, message: `skipped: ${reason}`, probeUnavailable: true };
}

/** The one top-level `runs:` key of an action's metadata file. */
const RUNS_KEY = /^runs\s*:(?:\s*#.*)?$/;

/** @param {string} line */
function isBlankOrComment(line) {
  const text = line.trim();
  return text === '' || text.startsWith('#');
}

/** @param {string} line */
function indentOf(line) {
  return /^[ \t]*/.exec(line)[0].length;
}

/**
 * A composite action has no `jobs:`: its `runs:` block carries `using:` and `steps:`, and that step
 * sequence is the same shape as a workflow job's. The block is lifted one level into the shape the
 * structural reader models — `jobs:` -> job -> `steps:` — and read by that same reader, never by a
 * second line scan (E6). Only leading indentation changes: no line is dropped, so every step still
 * reports the line it came from and the caller shifts the reader's 1-based line by `offset`. A key
 * the reader does not model (`using:`, `main:`, `post:`) stays a job key it ignores, so a javascript
 * or docker action is read without a guess and yields no step.
 *
 * @param {string} text
 * @returns {{ ok: true, text: string, offset: number } | { ok: false, detail: string } | null}
 *   null when the file declares no top-level `runs:` block: it is not an action at all.
 */
function liftComposite(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const runsAt = lines.findIndex((line) => RUNS_KEY.test(line));
  if (runsAt === -1) return null;

  let end = runsAt + 1;
  while (end < lines.length && (isBlankOrComment(lines[end]) || indentOf(lines[end]) > 0)) end += 1;

  const body = lines.slice(runsAt + 1, end);
  if (body.every(isBlankOrComment)) {
    return { ok: false, detail: `"runs" at line ${runsAt + 1} declares no key` };
  }

  return {
    ok: true,
    text: ['jobs:', '  action:', ...body.map((line) => `  ${line}`)].join('\n'),
    // body[0] is line runsAt + 2 of the file and line 3 of the lifted document.
    offset: runsAt + 2 - 3,
  };
}

/**
 * One skip, for a file whose references cannot be attributed. Read and refused is not an unavailable
 * probe, so `--strict-probes` does not promote it.
 * @param {string} code
 * @param {string} path
 * @param {string} reason
 */
function refused(code, path, reason) {
  return { status: 'skip', code, path, message: `skipped: ${reason}` };
}

/**
 * The steps of one composite action, read by the workflow reader. A file that is not an action and a
 * block the reader refuses come back as a skip that says which of the two it was.
 * @param {{ path: string, text: string }} file
 * @returns {Array<object>} findings, or one skip
 */
function compositeFindings(file) {
  const lifted = liftComposite(file.text);
  if (lifted === null) {
    return [
      refused(
        'not-an-action',
        file.path,
        `${file.path} declares no top-level runs: block, so it is not a composite action and no step ` +
          'can be attributed',
      ),
    ];
  }
  if (!lifted.ok) {
    return [refused('unparseable-action', file.path, `unparseable composite action — ${lifted.detail}`)];
  }

  const parsed = parseWorkflow(lifted.text);
  if (!parsed.ok) {
    return [refused('unparseable-action', file.path, `unparseable composite action — ${parsed.detail}`)];
  }

  return stepFindings(file.path, parsed.jobs, lifted.offset);
}

/**
 * Lexical classification of a ref. It is not a git answer: no network and no probe (RFC 4.9).
 * @param {string} ref
 * @returns {'short-sha' | 'tag' | 'branch'}
 */
function formOf(ref) {
  if (SHORT_SHA.test(ref)) return 'short-sha';
  if (/^v\d/i.test(ref) || /^\d+\.\d+/.test(ref)) return 'tag';
  return 'branch';
}

/** @param {string} form */
function why(form) {
  if (form === 'tag') return 'is a tag';
  if (form === 'short-sha') return 'is a short SHA';
  return 'follows a branch';
}

/**
 * One finding per `uses` value that can move, or null when the reference is immutable.
 * @param {string} path
 * @param {object} step a step from the structural reader
 */
function unpinned(path, step) {
  const uses = step.uses;
  if (typeof uses !== 'string' || uses === '') return null;
  if (uses.startsWith('./')) return null;

  const raw = step.raw ?? uses;

  if (uses.startsWith(DOCKER_SCHEME)) {
    if (DOCKER_DIGEST.test(uses)) return null;
    const split = splitDocker(uses);
    return {
      status: 'fail',
      code: 'mutable-docker-tag',
      path,
      line: step.line,
      message: `${uses} ${dockerForm(split)}; reference the digest instead (docker://image@sha256:<64 hex>)`,
      evidence: { uses: raw, form: 'docker-tag' },
      remediation: {
        kind: 'manual',
        command:
          split.tag === null
            ? `uses: ${split.image}@sha256:<64 hex>`
            : `uses: ${split.image}@sha256:<64 hex> # ${split.tag}`,
      },
    };
  }

  const at = uses.lastIndexOf('@');
  const ref = at === -1 ? '' : uses.slice(at + 1);
  if (FULL_SHA.test(ref)) return null;

  const form = at === -1 ? 'branch' : formOf(ref);
  const what = at === -1 || ref === '' ? 'names no ref' : why(form);
  return {
    status: 'fail',
    code: 'unpinned-action',
    path,
    line: step.line,
    message: `${uses} ${what}; pin the 40-character commit SHA so the workflow cannot change under you — resolve it with git ls-remote against the action's host and keep the tag as the comment, because this tool does not use the network`,
    evidence: { uses: raw, form },
    remediation: remediationFor(at === -1 ? uses : uses.slice(0, at), ref),
  };
}

/**
 * One finding per step the reader attributed, from either a workflow job or a composite action.
 * @param {string} path
 * @param {Array<object>} jobs jobs the structural reader returned
 * @param {number} [offset] added to the reader's 1-based line, for a lifted composite action
 * @returns {Array<object>}
 */
function stepFindings(path, jobs, offset = 0) {
  const findings = [];
  for (const job of jobs) {
    for (const step of job.steps) {
      const finding = unpinned(path, offset === 0 ? step : { ...step, line: step.line + offset });
      if (finding !== null) findings.push(finding);
    }
  }
  return findings;
}

export default {
  id: 'actions-pinned-sha',
  title: 'Actions are pinned to a commit SHA',
  label: 'Pinned actions',
  scope: ['repo'],
  targets: ['ci'],
  friction: 1,
  severity: { baseline: 'error', strict: 'error' },
  question: 'Can a CI workflow change under you without a commit?',
  detection:
    'Every workflow step the structural reader attributes (jobs -> job -> steps -> step), and every ' +
    'step of a composite action under .github/actions/**/action.yml or action.yaml, whose runs: ' +
    'block is lifted into the same jobs -> job -> steps shape and read by the same reader. A uses ' +
    'value is immutable when owner/repo@<40 hex>, a local ./path, or docker://image@sha256:<64 hex>. ' +
    'A tag (@v1), a branch (@main), a short SHA (@<7 hex>) and docker://image:tag are reported, and ' +
    'so is docker://image (no tag, so latest) and a digest that is not 64 sha256 hex. ' +
    'A uses inside a with: map or a run: block scalar is never a step. An unparseable workflow skips. ' +
    'An action metadata file that declares no top-level runs: skips (not-an-action), and one the ' +
    'reader cannot attribute skips (unparseable-action); a javascript or docker action declares no ' +
    'steps and reports nothing.',
  evidence:
    'file:line, the raw reference as written (quotes and trailing comment included) and the form: ' +
    'tag, branch, short-sha or docker-tag. A trailing version comment is evidence, never trusted.',
  remediation:
    'Manual, printed as uses: owner/repo@<sha> # vX.Y.Z, and as uses: docker://registry:port/image' +
    '@sha256:<64 hex> # tag for a container reference, which keeps its registry and its port. ' +
    'The tool does not resolve the SHA: that is ' +
    'a network call (gh api repos/owner/repo/git/refs/tags/vX.Y.Z) and v0.1 makes none.',
  limits:
    'Proves the reference is a full commit SHA, not that the SHA is the release the comment claims. ' +
    'The tag/branch/short-sha form is a lexical classification, not a git lookup. A workflow the ' +
    'reader cannot attribute is skipped per file; the rule never guesses from a line scan. Only the ' +
    'action metadata file is read, so a `uses:` in an action\'s own script is out of reach.',
  docs: 'docs/rules/actions-pinned-sha.md',

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

      findings.push(...stepFindings(file.path, parsed.jobs));
    }

    for (const file of repo.actionFiles ?? []) {
      findings.push(...compositeFindings(file));
    }

    if (findings.length === 0) {
      findings.push({
        status: 'pass',
        code: 'pinned-actions',
        message:
          'every workflow and composite action reference is an immutable commit SHA, a digest or a ' +
          'local action',
      });
    }

    return findings;
  },
};
