/**
 * R8 — `actions-pinned-sha`: can a CI workflow change under you without a commit?
 * (RFC 8.2 R8, E6)
 *
 * The rule is stated against the structural workflow reader, never against a line scan: a
 * `uses:`-anchored scan finds none of the real steps and takes false positives from block scalars,
 * folded values and `with:` keys (E6). A step is what the reader says is a step.
 */

import { parseWorkflow } from '../lib/workflows.js';

const FULL_SHA = /^[0-9a-fA-F]{40}$/;
const SHORT_SHA = /^[0-9a-fA-F]{7,39}$/;
const DOCKER_DIGEST = /@sha256:[0-9a-fA-F]{64}$/;

/** The exact shape the remediation prints; the tool never resolves the SHA (RFC 4.9). */
const REMEDIATION = { kind: 'manual', command: 'uses: owner/repo@<sha> # vX.Y.Z' };

/**
 * @param {string} code
 * @param {string} reason
 */
function skip(code, reason) {
  return { status: 'skip', code, message: `skipped: ${reason}`, probeUnavailable: true };
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

  if (uses.startsWith('docker://')) {
    if (DOCKER_DIGEST.test(uses)) return null;
    return {
      status: 'fail',
      code: 'mutable-docker-tag',
      path,
      line: step.line,
      message: `${uses} is a mutable container tag; reference the digest instead (docker://image@sha256:<64 hex>)`,
      evidence: { uses: raw, form: 'docker-tag' },
      remediation: REMEDIATION,
    };
  }

  const at = uses.lastIndexOf('@');
  const ref = at === -1 ? '' : uses.slice(at + 1);
  if (FULL_SHA.test(ref)) return null;

  const form = at === -1 ? 'branch' : formOf(ref);
  const what = at === -1 ? 'names no ref' : why(form);
  return {
    status: 'fail',
    code: 'unpinned-action',
    path,
    line: step.line,
    message: `${uses} ${what}; pin the 40-character commit SHA so the workflow cannot change under you`,
    evidence: { uses: raw, form },
    remediation: REMEDIATION,
  };
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
    'Every workflow step the structural reader attributes (jobs -> job -> steps -> step). A uses ' +
    'value is immutable when owner/repo@<40 hex>, a local ./path, or docker://image@sha256:<64 hex>. ' +
    'A tag (@v1), a branch (@main), a short SHA (@<7 hex>) and docker://image:tag are reported. ' +
    'A uses inside a with: map or a run: block scalar is never a step. An unparseable workflow skips.',
  evidence:
    'file:line, the raw reference as written (quotes and trailing comment included) and the form: ' +
    'tag, branch, short-sha or docker-tag. A trailing version comment is evidence, never trusted.',
  remediation:
    'Manual, printed as uses: owner/repo@<sha> # vX.Y.Z. The tool does not resolve the SHA: that is ' +
    'a network call (gh api repos/owner/repo/git/refs/tags/vX.Y.Z) and v0.1 makes none.',
  limits:
    'Proves the reference is a full commit SHA, not that the SHA is the release the comment claims. ' +
    'The tag/branch/short-sha form is a lexical classification, not a git lookup. A workflow the ' +
    'reader cannot attribute is skipped per file; the rule never guesses from a line scan.',
  docs: 'docs/rules/actions-pinned-sha.md',

  /**
   * @param {object} ctx the resolved context of `src/lib/targets.js`
   * @returns {Array<object>} findings
   */
  detect(ctx) {
    const repo = ctx.repo;
    if (!repo) return [skip('no-repo', 'no repository facts were collected')];

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

      for (const job of parsed.jobs) {
        for (const step of job.steps) {
          const finding = unpinned(file.path, step);
          if (finding !== null) findings.push(finding);
        }
      }
    }

    if (findings.length === 0) {
      findings.push({
        status: 'pass',
        code: 'pinned-actions',
        message: 'every workflow reference is an immutable commit SHA, a digest or a local action',
      });
    }

    return findings;
  },
};
