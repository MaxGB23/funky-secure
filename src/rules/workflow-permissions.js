/**
 * R12 — `workflow-permissions`: does each workflow declare least-privilege `permissions:`?
 * (RFC 8.3, 16 F5 G4)
 *
 * `GITHUB_TOKEN` is minted for every job, and the scopes it carries are decided by the closest
 * `permissions:` declaration: the job's, else the workflow's, else the repository setting. So the
 * declaration is the only fact a stateless reader can hold, and it is read from the shared workflow
 * reader — the workflow-level declaration and each job's, as the reader attributed them — never by
 * scanning the file for the `permissions:` key. A `run:` body that prints the word, a comment, or a
 * `with:` map key is not a declaration.
 *
 * Three answers. No declaration anywhere for a job — no workflow-level block and none on that job
 * itself — is `workflow-permissions-missing` at line 1, naming the jobs that inherit the default:
 * the workflow has no default, so each job inherits whatever the repository setting allows. A
 * workflow-level or job-level `write-all` is `workflow-permissions-write-all` at the line of the
 * declaration that grants it — the workflow's own line, or the job's. Everything else — a `read-all`,
 * an empty `{}`, or a map of narrow scopes — is least privilege, and it is one pass.
 *
 * A workflow-level `write-all` is reported even when a job narrows it, because the workflow still
 * grants every scope to every job that does not narrow it, and that includes the next job somebody
 * adds. A job-level `write-all` is reported even when the workflow level is narrow, because the job
 * overrides the narrow default with everything.
 */

import { parseWorkflow } from '../lib/workflows.js';

const DOC = 'docs/rules/workflow-permissions.md';

/** The remediation of an absent workflow-level declaration. */
const MISSING_FIX = 'add "permissions:" with "contents: read" at the top level, and widen it only in the job that needs it';

/** The remediation of a workflow-level grant of everything. */
const WORKFLOW_FIX = 'replace the workflow-level "permissions: write-all" with the exact scopes the workflows write';

/**
 * @param {string} code
 * @param {string} reason
 */
function skip(code, reason) {
  return { status: 'skip', code, message: `skipped: ${reason}`, probeUnavailable: true };
}

/**
 * One fail for one `write-all` declaration, workflow-level or job-level.
 * @param {string} path
 * @param {{ level: 'workflow' | 'job', job?: string }} where
 * @param {number} line
 * @returns {object}
 */
function writeAllFinding(path, where, line) {
  const message =
    where.level === 'workflow'
      ? 'the workflow grants permissions: write-all, so every scope the GITHUB_TOKEN supports is ' +
        'writable in every job that does not narrow it'
      : `job "${where.job}" grants permissions: write-all, so every scope the GITHUB_TOKEN supports ` +
        'is writable in that job, whatever the workflow declares';
  return {
    status: 'fail',
    code: 'workflow-permissions-write-all',
    path,
    line,
    message,
    evidence: where,
    remediation: {
      kind: 'manual',
      command:
        where.level === 'workflow'
          ? WORKFLOW_FIX
          : `replace "permissions: write-all" in job "${where.job}" with the exact scopes that job writes`,
    },
  };
}

export default {
  id: 'workflow-permissions',
  title: 'Every workflow declares least-privilege permissions',
  scope: ['repo'],
  targets: ['ci'],
  friction: 1,
  severity: { baseline: 'warn', strict: 'error' },
  question: 'Does each workflow declare least-privilege permissions?',
  detection:
    'Every workflow through the structural reader, which now models permissions: at the workflow ' +
    'level and in each job. A declaration is read as a form — write-all, read-all, none for {}, or ' +
    'a map of scopes — with the 1-based line it was declared on; a permissions: value the reader ' +
    'cannot attribute is an unparseable workflow, not a guess. A workflow with no workflow-level ' +
    'declaration anywhere and at least one job has none either is workflow-permissions-missing at ' +
    'default and each job inherits the repository setting. A workflow-level or job-level write-all ' +
    'is workflow-permissions-write-all at the line of the declaration that grants it, and a ' +
    'workflow-level write-all is reported even when a job narrows it. read-all, {} and a map of ' +
    'scopes are least privilege: no failure is one pass (least-privilege-permissions). No workflow ' +
    'at all skips (no-ci), an unparseable workflow skips (unparseable-workflow) without a pass on ' +
    'top, and no repository facts skip (no-repo).',
  evidence:
    'level workflow or job, at the line of the declaration that grants write-all; a job-level ' +
    'finding also carries the job id and is reported at the line of that job permissions declaration.',
  remediation:
    'Manual, printed as the declaration to write: add a top-level permissions: with contents: read ' +
    'and widen it only in the job that needs it, or replace write-all with the exact scopes. The ' +
    'tool never edits a workflow.',
  limits:
    'Proves what the workflow declares; it does not prove the token a job receives. The ' +
    'declaration is not the effective grant: a repository setting decides the default for a ' +
    'workflow that declares none, a reusable workflow the job calls brings its own permissions, and ' +
    'an environment can narrow or widen what a job gets. It does not judge whether the scopes a job ' +
    'does declare are the narrowest possible for what that job runs: a workflow that declares ' +
    'contents: write everywhere it does not need it is reported as a pass. It does not evaluate ' +
    'GITHUB_TOKEN defaults, because they are a repository setting that is not in the fact set, ' +
    'which is why an absent declaration is warn in baseline and error in strict rather than an ' +
    'error everywhere.',
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
      return [skip('no-ci', 'there is no .github/workflows directory, so no workflow can declare permissions')];
    }

    const findings = [];
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

      if (parsed.permissions === null) {
        // A job that declares its own block is not uncovered: its declaration governs it, whatever the
        // workflow default is. Only a job that inherits the repository setting is reported.
        const uncovered = parsed.jobs.filter((job) => job.permissions === null).map((job) => job.id);
        if (uncovered.length > 0) {
          findings.push({
            status: 'fail',
            code: 'workflow-permissions-missing',
            path: file.path,
            line: 1,
            message:
              'the workflow declares no permissions:, so ' +
              (uncovered.length === parsed.jobs.length
                ? 'every job'
                : `${uncovered.length} of its ${parsed.jobs.length} jobs (${uncovered.join(', ')})`) +
              ' inherits the scopes the repository setting allows',
            evidence: { level: 'workflow', jobs: uncovered },
            remediation: { kind: 'manual', command: MISSING_FIX },
          });
        }
      } else if (parsed.permissions.form === 'write-all') {
        findings.push(writeAllFinding(file.path, { level: 'workflow' }, parsed.permissions.line));
      }

      for (const job of parsed.jobs) {
        if (job.permissions?.form !== 'write-all') continue;
        findings.push(writeAllFinding(file.path, { level: 'job', job: job.id }, job.permissions.line));
      }
    }

    const failed = findings.some((finding) => finding.status === 'fail');
    if (failed || unreadable) return findings;

    findings.push({
      status: 'pass',
      code: 'least-privilege-permissions',
      message:
        'every workflow declares permissions:, and none grants write-all at the workflow level or ' +
        'in a job',
    });

    return findings;
  },
};
