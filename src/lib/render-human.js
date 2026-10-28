/**
 * Human rendering (spec 10.3, record RFC 0001 Appendix D.1).
 *
 * A human reads this without the catalog: a finding is a heading line naming the subject and the
 * file, the message under it, and the action last (S1). The header carries the counts and the verdict
 * before anything else (S2), because the first thing a reader wants is the answer, not the evidence.
 *
 * The rule id is not printed: it is a name for tooling, and it stays in the JSON document, in
 * `--help`, in `explain` and behind `--verbose` (S4). Nothing here prints more than 96 columns (S5);
 * the only shortened value is a machine path, whose length is not ours to bound.
 *
 * The provenance line (S7) states the preset, the source it came from, what was measured about the
 * quarantine and whether the machine scope was excluded — never a value attributed to a source that
 * pnpm does not report (E2).
 *
 * The renderer ends with the `next` block (S1-S5): the one command that moves the repository forward.
 */

import { severityRank, TARGET_ORDER } from './report.js';
import { catalog as defaultCatalog } from '../rules/index.js';

const SYMBOL = { error: '✖', warn: '⚠', info: 'ℹ', skip: '–' };
const ANSI = {
  error: '\u001b[31m',
  warn: '\u001b[33m',
  info: '\u001b[36m',
  skip: '\u001b[2m',
  pass: '\u001b[32m',
  reset: '\u001b[0m',
};

/** The hard width bound of S5. A rendered line never exceeds it. */
const WIDTH = 96;
/** Messages stop earlier than the hard bound: a paragraph that fills 96 columns is not scannable. */
const MESSAGE_WIDTH = 86;
/** The column a message and an action hang from: two spaces, the symbol, two spaces. */
const PREFIX = '  ';
const INDENT = '     ';
const ACTION = '     → ';
/** The label column shared by `summary`, `verdict` and `next`, and by their continuation lines. */
const LABEL_WIDTH = 9;
/** The rule under the header, 90 columns so it does not compete with the text above it. */
const SEPARATOR = '─'.repeat(90);
/** How much of a machine path survives shortening: enough to recognise it, not enough to dominate. */
const PATH_ROOM = 44;

function paint(text, tone, color) {
  if (!color || !ANSI[tone]) return text;
  return `${ANSI[tone]}${text}${ANSI.reset}`;
}

/**
 * Shortens a long value in the middle, keeping both ends. Deterministic by construction: the same
 * input always yields the same output, and the cut points depend only on the length.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function shorten(text, max) {
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${text.slice(0, head)}…${tail > 0 ? text.slice(-tail) : ''}`;
}

/**
 * Greedy wrap on spaces. A single word longer than the width is split, because the width bound is
 * asserted by a test and a long token is not a licence to cross it.
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wrap(text, width) {
  const lines = [];
  let line = '';

  for (const word of String(text).split(' ')) {
    if (word.length > width) {
      if (line !== '') {
        lines.push(line);
        line = '';
      }
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      line = lines.pop() ?? '';
      continue;
    }
    if (line === '') line = word;
    else if (line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line += ` ${word}`;
  }

  if (line !== '' || lines.length === 0) lines.push(line);
  return lines;
}

function pathLabel(finding) {
  if (!finding.path) return '';
  return finding.line ? `${finding.path}:${finding.line}` : finding.path;
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function toneOf(finding) {
  return finding.status === 'skip' ? 'skip' : (finding.severity ?? 'error');
}

function symbolOf(finding) {
  return finding.status === 'skip' ? SYMBOL.skip : (SYMBOL[finding.severity] ?? SYMBOL.error);
}

/**
 * The name a human sees for a rule: its label from the catalog, never its id (S3, S4). A finding that
 * carries an unknown id falls back to the id, because a report must render even when it is odd.
 */
function labelOf(finding, labels) {
  return labels.get(finding.rule) ?? finding.rule;
}

/**
 * One finding in at most three shapes: heading, message, action (S1). The id appears only under
 * `--verbose`, on its own indented line, so it never competes with the sentence.
 * @param {object} finding
 * @param {{ color: boolean, verbose: boolean }} options
 * @returns {string[]}
 */
function renderFinding(finding, { color, verbose, labels }) {
  const tone = toneOf(finding);
  const head = `${PREFIX}${paint(symbolOf(finding), tone, color)}  ${labelOf(finding, labels)}`;
  const location = pathLabel(finding);
  const room = WIDTH - head.length - '  ·  '.length;
  const lines = [
    location === '' ? head : `${head}  ·  ${paint(shorten(location, Math.max(room, PATH_ROOM)), 'skip', color)}`,
  ];

  for (const line of wrap(finding.message, MESSAGE_WIDTH)) lines.push(INDENT + line);

  const command = finding.remediation?.command;
  if (command) {
    const pieces = wrap(command, WIDTH - ACTION.length);
    lines.push(ACTION + pieces[0]);
    for (const piece of pieces.slice(1)) lines.push(' '.repeat(ACTION.length) + piece);
  }

  if (verbose) lines.push(`${INDENT}·  ${finding.rule}`);
  return lines;
}

/**
 * A target with too many skipped rules to be useful says how many and which, then how to expand:
 * `--verbose` is where each reason and its verifying command live (S7). A single skip is cheaper to
 * print than to explain, so it keeps its own block and needs no flag.
 * @param {Array<object>} skipped
 * @param {{ color: boolean, verbose: boolean }} options
 * @returns {string[]}
 */
function renderSkipped(skipped, options) {
  if (skipped.length === 0) return [];
  if (options.verbose || skipped.length === 1) {
    return skipped.flatMap((finding) => ['', ...renderFinding(finding, options)]);
  }

  const head = `${PREFIX}${paint(SYMBOL.skip, 'skip', options.color)}  ${plural(skipped.length, 'rule', 'rules')} not verified: `;
  const names = skipped.map((finding) => labelOf(finding, options.labels)).join(', ');
  const lines = wrap(names, WIDTH - head.length).map((line, index) =>
    index === 0 ? head + line : ' '.repeat(head.length) + line,
  );
  lines.push(`${ACTION}funky-secure scan --verbose, each names what was not verified and how to verify it`);
  return lines;
}

/**
 * A target fact is prose the collector produced, and the machine block embeds two absolute paths in
 * it. The default report bounds them; `--verbose` prints the fact verbatim and the JSON keeps it whole
 * (S8), so nothing is lost, only shortened where a human is reading.
 * @param {string} fact
 * @param {boolean} verbose
 * @returns {string[]}
 */
function renderFact(fact, verbose) {
  const text = verbose
    ? fact
    : fact.replace(/\S{45,}/g, (token) => (/[/\\]/.test(token) ? shorten(token, PATH_ROOM) : token));
  return wrap(text, WIDTH - 2).map((line, index) => (index === 0 ? `  ${line}` : `  ${line}`));
}

/** The heading of a block: the target kind, upper case, and the path when the kind is an importer. */
function blockName(block) {
  const kind = block.kind === 'importer' ? `IMPORTER  ${block.path ?? ''}`.trimEnd() : block.kind.toUpperCase();
  return kind;
}

/**
 * @param {{ kind: string, path?: string, facts: string[], findings: object[], passing: object[], skipped: object[] }} block
 * @param {{ color: boolean, verbose: boolean }} options
 * @returns {string[]}
 */
function renderBlock(block, options) {
  const name = blockName(block);
  const failing = block.findings;

  if (failing.length === 0 && block.skipped.length === 0) {
    const facts = block.facts.flatMap((fact) => renderFact(fact, options.verbose));
    if (block.passing.length === 0 && block.facts.length === 0) return [];
    if (block.passing.length === 0) return [name, ...facts];
    const count = plural(block.passing.length, 'rule', 'rules');
    return [`${name}   all ${count} pass`, ...facts];
  }

  const lines = [name, ...block.facts.flatMap((fact) => renderFact(fact, options.verbose))];
  const groups = failing.map((finding) => renderFinding(finding, options));
  const skipped = renderSkipped(block.skipped, options);
  if (skipped.length > 0) groups.push(skipped);

  // One blank line between findings: a paragraph that runs straight into the next one is the
  // problem this output was rewritten to fix.
  groups.forEach((group, index) => {
    if (index > 0) lines.push('');
    lines.push(...group);
  });
  return lines;
}

/**
 * Splits one target kind into the blocks that are printed under it. `importer` is the only kind that
 * can be about several files at once, so it is the only one that is split by path.
 * @returns {Array<object>}
 */
function blocksFor(kind, targets, findings, passing) {
  const ofKind = (finding) => finding.target === kind;
  const kindTargets = targets.filter((target) => target.kind === kind);
  const kindFindings = findings.filter(ofKind);
  const kindPassing = passing.filter(ofKind);
  const facts = kindTargets.map((target) => target.detail).filter(Boolean);

  if (kind === 'importer') {
    const paths = [
      ...new Set(
        [...kindTargets.map((t) => t.path), ...kindFindings.map((f) => f.path), ...kindPassing.map((f) => f.path)]
          .filter(Boolean),
      ),
    ].sort();
    if (paths.length === 0) {
      return kindFindings.length === 0 && kindPassing.length === 0
        ? []
        : [{ kind, path: null, facts, findings: kindFindings, passing: kindPassing, skipped: [] }];
    }
    return paths.map((path) => ({
      kind,
      path,
      facts: [],
      findings: kindFindings.filter((finding) => finding.path === path),
      passing: kindPassing.filter((finding) => finding.path === path),
      skipped: [],
    }));
  }

  return [
    {
      kind,
      facts,
      findings: kindFindings.filter((finding) => finding.status !== 'skip'),
      passing: kindPassing,
      skipped: kindFindings.filter((finding) => finding.status === 'skip'),
    },
  ];
}

/**
 * The one-line provenance of the report (S7). It repeats no effective pnpm value.
 * @param {{ preset: string, presetSource: string, quarantine: string, machine: string }} provenance
 * @returns {string}
 */
function provenanceLine(provenance) {
  return (
    `provenance  preset ${provenance.preset} (${provenance.presetSource})` +
    `  ·  quarantine ${provenance.quarantine}` +
    `  ·  machine ${provenance.machine}`
  );
}

/** The counts line, unchanged in wording and gutter: only its position moved (S2). */
function summaryLine(summary) {
  return (
    `${'summary'.padEnd(LABEL_WIDTH)}${plural(summary.error, 'error', 'errors')} · ` +
    `${plural(summary.warn, 'warning', 'warnings')} · ${summary.info} info · ` +
    `${summary.pass} passing · ${plural(summary.skip, 'skipped', 'skipped')}`
  );
}

/**
 * The rule ids of the passing rules, for `--verbose` only: the default report counts them (S6).
 * @param {Array<object>} passing
 * @returns {string[]}
 */
function passingIds(passing) {
  const head = `${'passing'.padEnd(LABEL_WIDTH)}${passing.length} rules (`;
  const indent = ' '.repeat(LABEL_WIDTH);
  const lines = [];
  let current = head;

  passing.forEach((finding, index) => {
    const piece = (index === 0 ? '' : ', ') + finding.rule;
    if (current.length + piece.length > WIDTH && current !== head) {
      lines.push(`${current},`);
      current = indent + finding.rule;
    } else current += piece;
  });

  lines.push(`${current})`);
  return lines;
}

/**
 * The one rule a reader should open next: the highest-severity failing finding, ties broken by the
 * catalog order — never alphabetical order and never the order the report happens to print, because
 * report order groups by target first (10.2). Two runs over the same state name the same rule.
 * @param {Array<object>} failing
 * @param {Array<{ id: string }>} catalog
 * @returns {string}
 */
function ruleToRead(failing, catalog) {
  const order = new Map(catalog.map((rule, index) => [rule.id, index]));
  const rank = (finding) => order.get(finding.rule) ?? catalog.length;

  let chosen = failing[0];
  for (const finding of failing.slice(1)) {
    const severity = severityRank(finding.severity);
    const chosenSeverity = severityRank(chosen.severity);
    if (severity > chosenSeverity || (severity === chosenSeverity && rank(finding) < rank(chosen))) {
      chosen = finding;
    }
  }
  return chosen.rule;
}

/**
 * The block a human `scan` ends with (S1-S5): the one command that moves the repository forward.
 * Exactly one of three shapes, decided by the report and nothing else. An automatic fix wins even
 * when the verdict is a pass, because the fixes are still available.
 * @param {{ summary: { verdict: string }, findings: Array<object> }} report
 * @param {Array<{ id: string }>} catalog
 * @returns {string[]}
 */
function nextBlock({ summary, findings }, catalog) {
  const gutter = 'next'.padEnd(LABEL_WIDTH);
  const indent = ' '.repeat(LABEL_WIDTH);
  const failing = findings.filter(
    (finding) => finding.status !== 'pass' && finding.status !== 'skip',
  );
  const automatic = failing.filter((finding) => finding.remediation?.kind === 'auto');

  if (automatic.length > 0) {
    return [
      `${gutter}funky-secure init  plan the ${plural(automatic.length, 'fix', 'fixes')} it can make (nothing is written)`,
      `${indent}funky-secure explain ${ruleToRead(failing, catalog)}   what this rule wants, and why`,
    ];
  }

  if (summary.verdict === 'pass') {
    return [`${gutter}nothing to do: everything at or above the policy passes`];
  }

  return [`${gutter}manual: each finding names the file, its line, and the action`];
}

/**
 * @param {object} report the object built by `buildReport`
 * @param {{ color?: boolean, verbose?: boolean }} [options]
 * @returns {string}
 */
export function renderHuman(report, { color = false, verbose = false } = {}) {
  const targets = report.targets ?? [];
  const findings = report.findings ?? [];
  // A passing finding is never printed as a finding: the header counted it, and a repository that is
  // fine cannot be allowed to look like a repository that is not (10.1).
  const visible = findings.filter((finding) => finding.status !== 'pass');
  const passing = findings.filter((finding) => finding.status === 'pass');
  const options = { color, verbose, labels: new Map(defaultCatalog.map((rule) => [rule.id, rule.label ?? rule.id])) };

  const verdict = report.summary.verdict === 'fail' ? 'FAIL' : 'PASS';
  const lines = [
    `${report.tool.name} scan  ·  preset ${report.policy.preset}  ·  scope ${report.scope}`,
  ];
  if (report.provenance) lines.push(provenanceLine(report.provenance));
  lines.push(summaryLine(report.summary));
  lines.push(
    `${'verdict'.padEnd(LABEL_WIDTH)}${paint(verdict, verdict === 'FAIL' ? 'error' : 'pass', color)} (threshold: ${report.policy.failOn})`,
  );
  lines.push(SEPARATOR, '');

  for (const kind of TARGET_ORDER) {
    for (const block of blocksFor(kind, targets, visible, passing)) {
      const rendered = renderBlock(block, options);
      if (rendered.length === 0) continue;
      lines.push(...rendered, '');
    }
  }

  if (verbose && passing.length > 0) lines.push(...passingIds(passing), '');

  lines.push(...nextBlock(report, defaultCatalog));

  return `${lines.join('\n')}\n`;
}
