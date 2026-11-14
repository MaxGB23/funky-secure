/**
 * R13 - `workflow-run-artifact`: does a privileged workflow read bytes an unprivileged workflow
 * produced? (RFC 0035, spec 8.2 R13)
 *
 * `workflow_run` starts a workflow because another run finished, and the artifact that run uploaded
 * is reachable from the second one. When the first workflow runs on `pull_request` it executes a
 * fork's bytes with a read-only token; when the second holds a write token and downloads what the
 * first produced, the escalation is assembled between the two files: a fork's bytes travel into a run
 * that holds this repository's write token. Neither file is wrong on its own, which is why no rule
 * that reads one workflow at a time can report it.
 *
 * The producer is named by workflow `name:` in `on.workflow_run.workflows`, which lives in a sibling
 * file, so this rule reads every workflow of the repository, which the collector already resolved
 * (`ctx.repo.workflows`), and matches the names against each file's `name:`. A producer it cannot
 * resolve is a `skip` with its own code, never a `fail` and never a silent `pass`: "I did not
 * resolve the producer" and "the producer is trusted" must not print the same.
 *
 * Every leg is read through the shared structural reader, never by scanning a file for a token: the
 * trigger block with its lists, `permissions:` at the workflow level and in each job, and each step's
 * `uses` and `with`. Nothing here is a new parser.
 */

import { declaresTrigger, parseWorkflow } from '../lib/workflows.js';

const DOC = 'docs/rules/workflow-run-artifact.md';

/** The trigger this rule is about. */
const TRIGGER = 'workflow_run';

/** The trigger that makes a producer unprivileged: a fork can start it. */
const PRODUCER_TRIGGER = 'pull_request';

/** The action that downloads an artifact, with or without a pinned ref. */
const DOWNLOAD_ACTION = 'actions/download-artifact';

/** The expression that names the producing run, read from a step's `with.run-id`. */
const RUN_ID = 'github.event.workflow_run.id';

/**
 * GitHub's permission scopes in catalog order, which is the order this rule names them in. A scope the
 * catalog does not list is still a write when the declaration writes it, so it is kept and named after
 * the listed ones instead of being dropped: an unnamed write would be a pass over a token that exists.
 */
const SCOPE_CATALOG = [
  'actions',
  'attestations',
  'checks',
  'contents',
  'deployments',
  'discussions',
  'id-token',
  'issues',
  'models',
  'packages',
  'pages',
  'pull-requests',
  'security-events',
  'statuses',
];

/** The remediation, printed as the choice to make: both routes are structural. */
const FIX =
  'split the workflow so the job that holds the write token never consumes the artifact, or keep the ' +
  'artifact out of the write path and read the run through the API instead';

/**
 * @param {string} code
 * @param {string} reason
 */
function skip(code, reason) {
  return { status: 'skip', code, message: `skipped: ${reason}`, probeUnavailable: true };
}

/**
 * The artifact download inside one step, or null when the step neither runs the download action nor
 * names the producing run.
 *
 * `uses` is the signal the reader always carries; a `with: { run-id: ... }` written as a flow map is
 * not visible to the reader today, so the run-id expression is read as a second signal and never as
 * the only one.
 * @param {object} step a step from the structural reader
 * @returns {{ kind: 'uses' | 'run-id', value: string } | null}
 */
function download(step) {
  if (typeof step.uses === 'string') {
    const uses = step.uses.toLowerCase();
    if (uses === DOWNLOAD_ACTION || uses.startsWith(`${DOWNLOAD_ACTION}@`)) {
      return { kind: 'uses', value: step.uses };
    }
  }

  const runId = step.with?.['run-id'];
  if (typeof runId === 'string' && runId.includes(RUN_ID)) {
    return { kind: 'run-id', value: runId };
  }

  return null;
}

/**
 * The write scopes one `permissions:` declaration grants, or an empty list when it grants none. Any
 * scope whose value is `write` is one: a token that mints an OIDC identity (`id-token`), opens a check
 * (`checks`) or writes a status (`statuses`) reaches the same place as `contents`, which is why the
 * three-scope list the first draft carried was a false pass over a real repository. `write-all` is
 * reported under its own name, because it is the whole token rather than a list of scopes.
 * @param {{ form?: string, entries?: Record<string, string> } | null | undefined} permissions
 * @returns {string[]}
 */
function writeScopes(permissions) {
  if (permissions === null || permissions === undefined) return [];
  if (permissions.form === 'write-all') return ['write-all'];
  if (permissions.form !== 'map') return [];
  const entries = permissions.entries ?? {};
  const rank = (scope) => {
    const at = SCOPE_CATALOG.indexOf(scope);
    return at === -1 ? SCOPE_CATALOG.length : at;
  };
  // Object.keys keeps the declaration order, and a stable sort keeps it for a scope the catalog does
  // not list, so the answer never depends on how the file happened to spell its map.
  return Object.keys(entries)
    .filter((scope) => entries[scope] === 'write')
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * The declaration that governs one job's token: the job's own `permissions:`, else the workflow's,
 * else nothing, because the closest declaration wins as GitHub applies it.
 * @param {object} job
 * @param {{ form?: string, entries?: Record<string, string> } | null} workflow
 * @returns {string[]}
 */
function jobScopes(job, workflow) {
  return writeScopes(job.permissions ?? workflow);
}

/** @param {string[]} scopes */
function scopesText(scopes) {
  return scopes.includes('write-all') ? 'permissions: write-all' : `${scopes.join(': write, ')}: write`;
}

export default {
  id: 'workflow-run-artifact',
  title: 'A privileged workflow does not read an artifact an unprivileged run produced',
  label: 'Workflow run artifact',
  scope: ['repo'],
  targets: ['ci'],
  friction: 1,
  severity: { baseline: 'error', strict: 'error' },
  question: 'Does a privileged workflow read bytes an unprivileged workflow produced?',
  detection:
    'Every workflow of the repository through the structural reader, because the producer is named ' +
    'by workflow name: in on.workflow_run.workflows and lives in a sibling file. A consumer is a ' +
    'workflow whose on: block declares workflow_run and whose steps carry an artifact download: a ' +
    'step whose uses is actions/download-artifact (with any ref), or a step whose with.run-id reads ' +
    'github.event.workflow_run.id. The download is reported only when the declaration that governs ' +
    'its job, which is the job permissions: else the workflow permissions:, grants any scope whose ' +
    'value is write, or write-all: contents: write, id-token: write, checks: write and every other ' +
    'scope carry the same token. Every write scope that declaration holds is named in the message and ' +
    'in evidence.scopes, in catalog order and never one it did not read. The download is reported ' +
    'when the producer resolves: every name ' +
    'the trigger lists is matched against the name: of every workflow in the repository, a name ' +
    'exactly one workflow carries is that producer, and one that declares pull_request makes the ' +
    'pair one fail (workflow-run-artifact) at the line of the step that downloads, one per ' +
    'downloading step. A producer that cannot be resolved is a skip with its own code ' +
    '(producer-unresolved-name for a name no workflow carries and for a name more than one workflow ' +
    'carries, producer-unresolved-trigger, producer-unresolved-config) and never a pass. The ' +
    'passes: no workflow declares workflow_run ' +
    '(no-workflow-run), a workflow_run workflow downloads nothing ' +
    '(workflow-run-without-artifact), a downloading workflow_run job holds no write scope ' +
    '(no-write-permission), and every resolved producer declares no pull_request ' +
    '(trusted-producer). No workflow at all skips (no-ci), an unparseable workflow skips ' +
    '(unparseable-workflow) without a pass on top, and no repository facts skip (no-repo).',
  evidence:
    'The consumer job and the downloading step, at the step line; the producer path, the name it was ' +
    'matched by and the pull_request trigger that makes it unprivileged; the download mechanism ' +
    '(uses, or the run-id expression) with the value that was read; and every write scope the ' +
    'governing declaration holds, in catalog order, or write-all.',
  remediation:
    'Manual, printed as the choice to make: split the workflow so the job that holds the write token ' +
    'never consumes the artifact, or keep the artifact out of the write path and re-derive what the ' +
    'job needs from the run through the API. Printing, hashing or copying the bytes is a read like ' +
    'any other. The tool never edits a workflow.',
  limits:
    'Proves that a declared trigger, a declared step and a declared permission name the pair, and ' +
    'that a workflow carrying the producer name declares pull_request. It does not read what the ' +
    'downloaded bytes are or what the job does with them, does not follow the artifact by name (only ' +
    'the download is read, never the upload that named it), does not decide whether a fork can ' +
    'trigger the producer branch it targets, and does not resolve a producer that lives in another ' +
    'repository or is reached through a reusable workflow. A scope whose value is write is a write ' +
    'whatever the scope is called, and which scopes fork bytes can reach is not decided here, so an ' +
    'artifact read outside a step (gh run download, the artifacts API) and one a reusable workflow ' +
    'reads as an input are invisible. A producer name more than one workflow ' +
    'carries names no producer, so it is a skip and never a resolution. A with: map written as a ' +
    'flow collection is invisible to the reader today, so a download that only a flow-style with ' +
    'carries is not seen, and the workflows the trigger lists are read only from a block map: any ' +
    'other spelling of on: is a skip, never a guessed list.',
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
    /** @type {Array<{ path: string, text: string, parsed: object }>} */
    const files = [];
    let unreadable = false;

    for (const file of workflows) {
      const parsed = parseWorkflow(file.text);
      if (!parsed.ok) {
        unreadable = true;
        findings.push({
          status: 'skip',
          code: 'unparseable-workflow',
          path: file.path,
          message: `skipped: unparseable workflow: ${parsed.detail}`,
          evidence: { reason: parsed.reason },
        });
        continue;
      }
      files.push({ path: file.path, text: file.text, parsed });
    }

    // The producer is named by `name:`, so the catalog of names is the whole repository, matched
    // exactly as GitHub matches it. A name more than one file carries names no producer at all:
    // choosing between them would make the answer depend on which file sorts first.
    /** @type {Map<string, Array<{ path: string, text: string, parsed: object }>>} */
    const byName = new Map();
    for (const file of files) {
      const name = file.parsed.name;
      if (typeof name !== 'string' || name === '') continue;
      const matches = byName.get(name);
      if (matches === undefined) byName.set(name, [file]);
      else matches.push(file);
    }

    let declares = false;
    let consumes = false;
    let privileged = false;
    let unresolved = false;

    for (const file of files) {
      const triggers = file.parsed.triggers;

      /** @type {object | null} the workflow_run event, when the reader can attribute one */
      let event = null;
      if (triggers !== null) {
        if (triggers.form === 'flow-map') {
          // A flow `on:` map carries no events: the names are readable only as a token, which is
          // enough to know the rule should answer, and not enough to resolve a producer from.
          if (declaresTrigger(file.text, TRIGGER)) event = { name: TRIGGER, config: null };
        } else {
          event = triggers.events.find((candidate) => candidate.name === TRIGGER) ?? null;
        }
      }
      if (event === null) continue;
      declares = true;

      const downloads = [];
      for (const job of file.parsed.jobs) {
        for (const step of job.steps) {
          const found = download(step);
          if (found !== null) downloads.push({ job, step, download: found });
        }
      }
      if (downloads.length === 0) continue;
      consumes = true;

      if (event.config === null) {
        unresolved = true;
        findings.push({
          status: 'skip',
          code: 'producer-unresolved-trigger',
          path: file.path,
          message:
            'skipped: the on: block is a flow collection, a form the reader does not model, so the ' +
            'workflows this trigger names cannot be read and the producer cannot be resolved',
          evidence: { form: triggers.form },
          probeUnavailable: true,
        });
        continue;
      }

      const names = event.config.workflows;
      if (!Array.isArray(names) || names.length === 0) {
        unresolved = true;
        findings.push({
          status: 'skip',
          code: 'producer-unresolved-config',
          path: file.path,
          message:
            'skipped: the workflow_run trigger names no workflow in a form the reader can read, so ' +
            'the producer cannot be resolved',
          evidence: { workflows: names ?? null },
          probeUnavailable: true,
        });
        continue;
      }

      // A name resolves only when exactly one workflow carries it, so a shared name is the absence
      // of a producer and not a choice between two of them.
      /** @type {Array<{ path: string, text: string, parsed: object }>} */
      const producers = [];
      /** @type {Array<{ name: string, paths: string[] }>} */
      const shared = [];
      for (const name of names) {
        const matches = [...(byName.get(name) ?? [])].sort((a, b) => (a.path < b.path ? -1 : 1));
        if (matches.length === 1) producers.push(matches[0]);
        else if (matches.length > 1) shared.push({ name, paths: matches.map((match) => match.path) });
      }

      if (shared.length > 0) {
        unresolved = true;
        findings.push({
          status: 'skip',
          code: 'producer-unresolved-name',
          path: file.path,
          message:
            'skipped: the workflow_run trigger names ' +
            shared
              .map(
                (entry) =>
                  `"${entry.name}", which more than one workflow carries (${entry.paths.join(', ')})`,
              )
              .join('; ') +
            ', so the producer cannot be resolved',
          evidence: { workflows: names },
          probeUnavailable: true,
        });
        continue;
      }

      if (producers.length === 0) {
        unresolved = true;
        findings.push({
          status: 'skip',
          code: 'producer-unresolved-name',
          path: file.path,
          message:
            `skipped: no workflow in the repository carries the name ${names.map((name) => `"${name}"`).join(', ')} ` +
            'the workflow_run trigger names, so the producer cannot be resolved',
          evidence: { workflows: names },
          probeUnavailable: true,
        });
        continue;
      }

      const untrusted = producers.filter((producer) =>
        declaresTrigger(producer.text, PRODUCER_TRIGGER),
      );

      for (const { job, step, download: found } of downloads) {
        const scopes = jobScopes(job, file.parsed.permissions);
        if (scopes.length === 0) continue;
        privileged = true;
        if (untrusted.length === 0) continue;

        const producer = untrusted[0];
        findings.push({
          status: 'fail',
          code: 'workflow-run-artifact',
          path: file.path,
          line: step.line,
          message:
            `job "${job.id}" downloads an artifact produced by "${producer.parsed.name}", which ` +
            `declares ${PRODUCER_TRIGGER}, and the job holds ${scopesText(scopes)}: bytes a fork can ` +
            "write reach this repository's write token",
          evidence: {
            job: job.id,
            step: step.index,
            producerPath: producer.path,
            producerName: producer.parsed.name,
            producerTrigger: PRODUCER_TRIGGER,
            downloadKind: found.kind,
            download: found.value,
            scopes,
          },
          remediation: { kind: 'manual', command: FIX },
        });
      }
    }

    const failed = findings.some((finding) => finding.status === 'fail');
    if (failed || unreadable || unresolved) return findings;

    findings.push(pass({ declares, consumes, privileged }, files, byName));
    return findings;
  },
};

/**
 * The one pass of a repository that carries no finding: the furthest leg the rule did reach, so the
 * pass names what it verified rather than a generic "fine".
 * @param {{ declares: boolean, consumes: boolean, privileged: boolean }} seen
 * @param {Array<{ path: string, text: string, parsed: object }>} files
 * @param {Map<string, Array<{ path: string, text: string, parsed: object }>>} byName the files each
 *   workflow name is carried by, so the pass never resolves a name two workflows share
 * @returns {object}
 */
function pass(seen, files, byName) {
  if (!seen.declares) {
    return {
      status: 'pass',
      code: 'no-workflow-run',
      message:
        'no workflow declares the workflow_run trigger, so no workflow is started by another run ' +
        'finishing and no artifact travels between two runs',
    };
  }

  if (!seen.consumes) {
    return {
      status: 'pass',
      code: 'workflow-run-without-artifact',
      message:
        'a workflow declares workflow_run but no step downloads an artifact, so nothing another ' +
        'workflow produced reaches this one',
    };
  }

  if (!seen.privileged) {
    return {
      status: 'pass',
      code: 'no-write-permission',
      message:
        'a workflow_run workflow downloads an artifact but the declaration that governs its job ' +
        'grants no write scope, so no bytes reach a write token',
    };
  }

  const trusted = files
    .filter((file) => file.parsed.triggers !== null && file.parsed.triggers.events !== undefined)
    .flatMap((file) => file.parsed.triggers.events)
    .filter((event) => event.name === TRIGGER)
    .flatMap((event) => (Array.isArray(event.config?.workflows) ? event.config.workflows : []))
    .map((name) => byName.get(name))
    .filter((matches) => matches !== undefined && matches.length === 1)
    .map(([match]) => match.parsed.name);

  const names = [...new Set(trusted)];
  return {
    status: 'pass',
    code: 'trusted-producer',
    message:
      `every producer the workflow_run trigger names resolves to a workflow that declares no ` +
      `${PRODUCER_TRIGGER} trigger${names.length === 0 ? '' : ` (${names.map((name) => `"${name}"`).join(', ')})`}, ` +
      'so the artifact does not come from a workflow a fork can start',
    evidence: { producers: names },
  };
}
