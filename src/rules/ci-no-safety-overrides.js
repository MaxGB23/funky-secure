/**
 * R10 — `ci-no-safety-overrides`: does CI disable the frozen lockfile or re-enable lifecycle
 * scripts? (RFC 8.3, 16 G2, E5)
 *
 * pnpm already freezes the lockfile in CI and does not run dependency lifecycle scripts by default
 * (RFC 4.1, E5), so only an explicit override is interesting and a plain `pnpm install` is the
 * correct command. The workflow half is read through the structural reader — a step is what the
 * reader says is a step — and the `.npmrc` half reads the resolved root file for the same keys.
 * A quoted sentence and a comment are not commands.
 */

import { repoSkipMessage } from '../lib/scope.js';
import { parseWorkflow } from '../lib/workflows.js';

const DOC = 'docs/rules/ci-no-safety-overrides.md';

/** The repository-root configuration file whose keys apply to every CI install. */
const NPMRC = '.npmrc';

/** Words that turn the frozen lockfile off (RFC 16 G2). */
const FROZEN_FLAGS = new Set(['--no-frozen-lockfile', '--frozen-lockfile=false']);

/** Words that turn dependency lifecycle scripts back on (RFC 16 G2). */
const SCRIPT_FLAGS = new Set([
  '--ignore-scripts=false',
  '--enable-pre-post-scripts',
  '--enable-pre-post-scripts=true',
]);

/**
 * The word that clears each override, by the word it replaces (RFC 16 G2). The remediation is an edit
 * inside the step: the offending word moves and the rest of the `run:` body stays as written, because
 * replacing the whole body of a compound step (`pnpm install --no-frozen-lockfile && pnpm build`)
 * drops every other command it runs (#383).
 */
const CLEARING_WORD = new Map([
  ['--no-frozen-lockfile', '--frozen-lockfile'],
  ['--frozen-lockfile=false', '--frozen-lockfile'],
  ['--ignore-scripts=false', '--ignore-scripts'],
  ['--enable-pre-post-scripts', '--ignore-scripts'],
  ['--enable-pre-post-scripts=true', '--ignore-scripts'],
]);

/**
 * @param {string} code
 * @param {string} reason
 */
function skip(code, reason) {
  return { status: 'skip', code, message: `skipped: ${reason}`, probeUnavailable: true };
}

/**
 * The words of one `run:` body that are commands rather than prose, each with the line it came from
 * and its own `[start, end)` span in the body, so an edit can replace exactly that word. A word that
 * begins with a quote is prose (a quoted sentence is not a command), and `#` at the start of a word
 * begins a comment.
 * @param {string} run
 * @returns {Array<{ word: string, line: string, start: number, end: number }>}
 */
function commandWords(run) {
  const words = [];
  // `split` with a capturing group keeps the line separators, so each content part has an offset.
  const parts = run.split(/(\r\n|\n|\r)/);
  let offset = 0;
  for (let part = 0; part < parts.length; part += 1) {
    const line = parts[part];
    if (part % 2 === 1) {
      offset += line.length;
      continue;
    }
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === '#') break;
      if (/\s/.test(ch) || ';|&()'.includes(ch)) {
        i += 1;
        continue;
      }
      const quoted = ch === "'" || ch === '"';
      const start = i;
      let word = '';
      while (i < line.length && !/[\s;|&()]/.test(line[i])) {
        const current = line[i];
        if (current === "'" || current === '"') {
          const end = line.indexOf(current, i + 1);
          const stop = end === -1 ? line.length : end;
          word += line.slice(i + 1, stop);
          i = stop + 1;
          continue;
        }
        word += current;
        i += 1;
      }
      if (word !== '' && !quoted) {
        words.push({ word, line: line.trim(), start: offset + start, end: offset + Math.min(i, line.length) });
      }
    }
    offset += line.length;
  }
  return words;
}

/**
 * The step's `run:` body with the offending word replaced by the one that clears it, or null when
 * that rewrite is not unambiguous: the word the finding names must be in the body as written, and
 * the body must be one line so the printed text can be the body.
 * @param {string} run the `run:` body of the step
 * @param {string} flag the offending word
 * @returns {string | null}
 */
function editedBody(run, flag) {
  const fix = CLEARING_WORD.get(flag);
  if (fix === undefined) return null;
  // A multi-line body printed as one line would keep the word and drop the other commands with it.
  if (/[\r\n]/.test(run)) return null;
  const spans = commandWords(run).filter(({ word }) => word === flag);
  if (spans.length === 0) return null;
  // A word whose own text carries a quote (`--ignore-scripts="false"`) is not the flag as written, so
  // the flag cannot be located as a whole word and pointing the reader at one would be a guess.
  if (spans.some(({ start, end }) => run.slice(start, end) !== flag)) return null;

  let edited = '';
  let at = 0;
  for (const { start, end } of spans) {
    edited += run.slice(at, start) + fix;
    at = end;
  }
  return edited + run.slice(at);
}

/**
 * The sentence a step whose body cannot be rewritten that way is printed as: the edit it names, never
 * a replacement that discards anything.
 * @param {string} flag
 * @returns {string}
 */
function manualEdit(flag) {
  return (
    `edit the step by hand: replace ${flag} with ${CLEARING_WORD.get(flag)}, ` +
    'keeping the rest of the run: body as written'
  );
}

/**
 * One finding per offending flag in a step, or null when the flag is not an override.
 * @param {string} path
 * @param {{ id: string }} job a job from the structural reader
 * @param {{ index: number, line: number }} step a step from the structural reader
 * @param {string} flag
 * @param {string} line the command line that carries the flag
 * @param {string} run the whole `run:` body of the step
 * @returns {object | null}
 */
function overrideFinding(path, job, step, flag, line, run) {
  const frozen = FROZEN_FLAGS.has(flag);
  if (!frozen && !SCRIPT_FLAGS.has(flag)) return null;

  const message = frozen
    ? `job "${job.id}" runs ${flag}; the frozen lockfile is what makes the install reproducible from the commit`
    : `job "${job.id}" runs ${flag}; dependency lifecycle scripts run arbitrary code at install time`;

  const edited = editedBody(run, flag);

  return {
    status: 'fail',
    code: frozen ? 'ci-frozen-lockfile-disabled' : 'ci-lifecycle-scripts-enabled',
    path,
    line: step.line,
    message,
    evidence: { job: job.id, step: step.index, flag, command: line },
    remediation: { kind: 'manual', command: edited === null ? manualEdit(flag) : `run: ${edited}` },
  };
}

/**
 * Every key/value pair of a `.npmrc`, with its 1-based line. `#` and `;` begin a comment at the
 * start of a line or after whitespace, as npm's ini reader treats them.
 * @param {string} text
 * @returns {Array<{ key: string, value: string, line: number }>}
 */
function npmrcEntries(text) {
  const entries = [];
  const lines = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim().replace(/\s[#;].*$/, '');
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const equals = line.indexOf('=');
    if (equals === -1) continue;
    entries.push({
      key: line.slice(0, equals).trim(),
      value: line.slice(equals + 1).trim(),
      line: i + 1,
    });
  }
  return entries;
}

/**
 * One finding per `.npmrc` key that turns a safety default off, or null for every other key.
 * @param {{ key: string, value: string, line: number }} entry
 * @returns {object | null}
 */
function npmrcFinding(entry) {
  const key = entry.key.toLowerCase();
  const value = entry.value.toLowerCase();
  const frozen = key === 'frozen-lockfile' && value === 'false';
  const scripts =
    (key === 'ignore-scripts' && value === 'false') || (key === 'enable-pre-post-scripts' && value === 'true');
  if (!frozen && !scripts) return null;

  const message = frozen
    ? `${NPMRC} sets frozen-lockfile=false; pnpm freezes the lockfile in CI by default`
    : `${NPMRC} sets ${key}=${value}; the install runs dependency lifecycle scripts, which are off by default`;

  return {
    status: 'fail',
    code: frozen ? 'ci-frozen-lockfile-disabled' : 'ci-lifecycle-scripts-enabled',
    target: 'repo-root',
    path: NPMRC,
    line: entry.line,
    message,
    evidence: { key: entry.key, value: entry.value },
    remediation: { kind: 'manual', command: `delete the ${key} key from ${NPMRC}` },
  };
}

export default {
  id: 'ci-no-safety-overrides',
  title: 'CI does not disable the frozen lockfile or re-enable lifecycle scripts',
  label: 'CI install flags',
  scope: ['repo'],
  targets: ['ci'],
  friction: 1,
  severity: { baseline: 'warn', strict: 'error' },
  question: 'Does CI disable the frozen lockfile or re-enable lifecycle scripts?',
  detection:
    'Every workflow step the structural reader attributes, plus the root .npmrc. A run word ' +
    '--no-frozen-lockfile or --frozen-lockfile=false is ci-frozen-lockfile-disabled; a run word ' +
    '--ignore-scripts=false or --enable-pre-post-scripts is ci-lifecycle-scripts-enabled. The ' +
    '.npmrc keys frozen-lockfile=false, ignore-scripts=false and enable-pre-post-scripts=true are ' +
    'the same two findings, at the 1-based line of the key. A quoted word and a comment are not a ' +
    'command. No override is one pass (ci-safety-defaults); no workflow and no .npmrc skips ' +
    '(no-ci), and an unparseable workflow skips (unparseable-workflow).',
  evidence:
    'For a workflow: the job, the step index, the offending word and the command line that carries ' +
    'it, at the step line. For .npmrc: the key and its value, at the 1-based line of the key.',
  remediation:
    'Manual, printed as the edit to perform inside the step: the offending word replaced by the one ' +
    'that clears it (--no-frozen-lockfile -> --frozen-lockfile, --ignore-scripts=false -> ' +
    '--ignore-scripts) with the rest of the run: body left as written, so a compound step keeps its ' +
    'other commands; a body that cannot be rewritten that way is printed as a sentence naming the ' +
    'edit. Delete the key from .npmrc for the configuration. The tool never edits a workflow and ' +
    'never rewrites .npmrc.',
  limits:
    'Proves that no declared step or root .npmrc key names the override; it does not prove the ' +
    'install was frozen, because an inherited environment, a global config, a composite action or a ' +
    'script the step calls can still pass the same flag. A word is classified by its own text, not ' +
    'by resolving it: whether the command is an install is not decided here. A workflow the reader ' +
    'cannot attribute is skipped per file; the rule never guesses from a line scan.',
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
    const npmrc = repo.files?.npmrc ?? null;
    if (workflows.length === 0 && npmrc === null) {
      return [skip('no-ci', 'there is no workflow and no root .npmrc, so no CI install fact exists')];
    }

    const findings = [];

    for (const file of workflows) {
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
          if (typeof step.run !== 'string') continue;
          const seen = new Set();
          for (const { word, line } of commandWords(step.run)) {
            if (seen.has(word)) continue;
            const finding = overrideFinding(file.path, job, step, word, line, step.run);
            if (finding === null) continue;
            seen.add(word);
            findings.push(finding);
          }
        }
      }
    }

    if (npmrc !== null && typeof npmrc.text === 'string') {
      for (const entry of npmrcEntries(npmrc.text)) {
        const finding = npmrcFinding(entry);
        if (finding !== null) findings.push(finding);
      }
    }

    if (findings.length === 0) {
      findings.push({
        status: 'pass',
        code: 'ci-safety-defaults',
        message:
          'no workflow command and no .npmrc key disables the frozen lockfile or re-enables lifecycle scripts',
      });
    }

    return findings;
  },
};
