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

export const SYMBOL = { error: '✖', warn: '⚠', info: 'ℹ', skip: '–' };
const ANSI = {
  heading: '[1m',
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
/** The honesty line stops before the 96-column bound: it is a note, not a paragraph (10.3). */
const HONESTY_WIDTH = 86;
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
  const name = paint(blockName(block), 'heading', options.color);
  const failing = block.findings;

  if (failing.length === 0 && block.skipped.length === 0) {
    const facts = block.facts.flatMap((fact) => renderFact(fact, options.verbose));
    if (block.passing.length === 0 && block.facts.length === 0) return [];
    if (block.passing.length === 0) return [name, ...facts];
    const count = plural(block.passing.length, 'rule', 'rules');
    return [name, `${INDENT}all ${count} pass`, ...facts];
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
  const text =
    `preset ${provenance.preset} (${provenance.presetSource})` +
    `  ·  quarantine ${provenance.quarantine}` +
    `  ·  machine ${provenance.machine}`;
  // `provenance` is one character wider than the nine-character gutter the other labels use, so it
  // keeps its own two spaces and its continuations hang under them.
  const gutter = 'provenance  ';

  // The one header line that can outgrow the width bound: wrapped in the gutter, never left to the
  // terminal to fold mid-word.
  return wrap(text, WIDTH - gutter.length).map((line, index) =>
    index === 0 ? gutter + line : ' '.repeat(gutter.length) + line,
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
 * The skips the report counted in the verdict, said in full: rule, file when there is one, and the
 * reason the prose carries. One line per rule, because a rule that skipped forty files skipped for one
 * reason and repeating it forty times is how a reader learns to scroll past it (S12, 0024).
 *
 * A skip already rendered inside a target block is not repeated: those blocks exist precisely to attach
 * the reason to the file it belongs to.
 *
 * @param {object} report
 * @param {Array<object>} catalog
 * @param {{ color: boolean, labels: Map<string, string> }} options
 * @param {Set<object>} renderedSkips the skips a target block already printed with their file
 * @returns {string[]}
 */
function unverifiedLines(report, catalog, options, renderedSkips = new Set()) {
  const skips = report.findings.filter(
    (finding) => finding.status === 'skip' && !renderedSkips.has(finding),
  );
  if (skips.length === 0) return [];

  const byRule = new Map();
  for (const finding of skips) {
    const entry = byRule.get(finding.rule) ?? { label: null, messages: new Set(), paths: new Set() };
    entry.messages.add(finding.message);
    if (finding.path) entry.paths.add(finding.path);
    byRule.set(finding.rule, entry);
  }
  for (const rule of catalog) {
    const entry = byRule.get(rule.id);
    if (entry !== undefined) entry.label = rule.label ?? rule.id;
  }

  const indent = ' '.repeat(LABEL_WIDTH);
  const lines = [`${'not verified'.padEnd(LABEL_WIDTH)}${plural(byRule.size, 'rule', 'rules')} did not answer`];
  for (const [rule, entry] of byRule) {
    const label = entry.label ?? rule;
    const reason = [...entry.messages].join(' · ');
    const scope = entry.paths.size > 0 ? ` (${plural(entry.paths.size, 'file', 'files')})` : '';
    lines.push(`${indent}–  ${label}${scope}`);
    for (const line of wrap(reason, WIDTH - LABEL_WIDTH - 3)) {
      lines.push(`${indent}   ${line}`);
    }
  }
  return [...lines, ''];
}

/**
 * The verdict, with the number of rules it did not verify (RFC 10.3, S12).
 *
 * `PASS` alone was read as "checked": a repository scanned with `--scope repo` printed a pass while
 * two rules were unverified, and the skip lines that say so sit below the verdict, where a reader or
 * a CI log that greps this line never looks. The count moves into the word; the listing stays where it
 * is, so the header states the coverage and the body states the reason.
 *
 * A verdict with nothing unverified is byte-identical to what it always was: the count appears only
 * when it is not zero, and a scan that verified everything is not asked to say so twice.
 *
 * @param {{ verdict: string, skip: number }} summary
 * @param {string} failOn the threshold the verdict was decided against
 * @param {boolean} color
 * @returns {string}
 */
function verdictLine(summary, failOn, color, unverifiedIds = []) {
  const word = summary.verdict === 'fail' ? 'FAIL' : 'PASS';
  const gutter = 'verdict'.padEnd(LABEL_WIDTH);
  const head = `${gutter}${paint(word, word === 'FAIL' ? 'error' : 'pass', color)} (threshold: ${failOn}`;
  if (summary.skip === 0) return `${head})`;

  const count = `${plural(summary.skip, 'rule', 'rules')} not verified`;
  const named = unverifiedIds.length > 0 ? `: ${unverifiedIds.join(', ')}` : '';
  const oneLine = `${head} · ${count}${named})`;
  if (oneLine.length <= WIDTH) return oneLine;

  // Naming the unverified rules made this line reach 207 columns on a repository with six of them, and
  // 10.3 bounds every rendered line at 96. The gutter continues, the sentence wraps, and the closing
  // parenthesis travels with the last id (0024).
  const indent = ' '.repeat(LABEL_WIDTH);
  const body = wrap(`${unverifiedIds.join(', ')})`, WIDTH - LABEL_WIDTH);
  return [`${head} · ${count}:`, ...body.map((line) => indent + line)].join('\n');
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
 * The honesty line (record 0003, S6, 10.3). A policy that leaves catalog rules unrun says how many
 * rules it does run and names the ones it does not, in catalog order and by the label a human reads.
 * `off` prints nothing at all (9.2), so a `PASS` under a reduced preset would otherwise claim a
 * coverage it does not have.
 *
 * It is one helper because two commands print it — the report and `start` — and a second copy of the
 * sentence would drift from the first. It is human output only: the JSON document of 10.2 is
 * unchanged, and a run that disables nothing prints no line at all.
 *
 * @param {{ active?: string[], catalog?: Array<{ id: string, label?: string }> }} [options]
 * @returns {string[]} the lines to print, or `[]` when nothing is disabled
 */
/**
 * The rule ids the effective policy turned `off`. `--only` and `--ignore` narrow a run without
 * changing a severity, so they are not policy coverage and never reach the honesty line (S6).
 * @param {{ severities?: Record<string, string> }} policy
 * @returns {string[]}
 */
export function offByPolicy(policy) {
  return Object.entries(policy?.severities ?? {})
    .filter(([, severity]) => severity === 'off')
    .map(([id]) => id);
}

export function notRunLines({ off = [], catalog = defaultCatalog } = {}) {
  const disabled = new Set(off);
  const missing = catalog.filter((rule) => disabled.has(rule.id));
  if (missing.length === 0) return [];

  // The labels come from the same catalog the renderer already builds its label map from (S3, S4), so
  // the line names a rule exactly as a finding does.
  const names = missing.map((rule) => rule.label ?? rule.id).join(", ");
  const running = catalog.length - missing.length;
  const text = `${running} of ${catalog.length} rules; off by policy: ${names}`;
  const gutter = "not run".padEnd(LABEL_WIDTH);

  return wrap(text, HONESTY_WIDTH - LABEL_WIDTH).map((line, index) =>
    index === 0 ? gutter + line : " ".repeat(LABEL_WIDTH) + line,
  );
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
 * @param {{ color?: boolean, verbose?: boolean, active?: string[] }} [options] `active` is the
 *   policy's active rule list; pass it and a reduced policy states what it did not run, leave it out
 *   and the rendering is exactly what it was before the honesty line existed
 * @returns {string}
 */
export function renderHuman(report, { color = false, verbose = false, off } = {}) {
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
  if (report.provenance) lines.push(...provenanceLine(report.provenance));
  lines.push(summaryLine(report.summary));
  const unverifiedIds = [
    ...new Set(
      report.findings.filter((finding) => finding.status === 'skip').map((finding) => finding.rule),
    ),
  ];
  lines.push(verdictLine(report.summary, report.policy.failOn, color, unverifiedIds));
  if (off !== undefined) lines.push(...notRunLines({ off, catalog: defaultCatalog }));
  lines.push(SEPARATOR, '');

  /** @type {Set<object>} */
  const renderedSkips = new Set();
  for (const kind of TARGET_ORDER) {
    for (const block of blocksFor(kind, targets, visible, passing)) {
      const rendered = renderBlock(block, options);
      if (rendered.length === 0) continue;
      for (const finding of block.skipped ?? []) renderedSkips.add(finding);
      lines.push(...rendered, '');
    }
  }

  if (verbose && passing.length > 0) lines.push(...passingIds(passing), '');

  // S12 (0024): a rule that could not verify something names itself and its reason here, whether or not
  // a target block had room for it. The verdict counts the unverified rules; without this section the
  // count was all a reader got, and `exact-versions` refusing a lockfile shape reached neither the body
  // nor `--verbose` because its finding has a target and no path, so no block was ever built for it.
  lines.push(...unverifiedLines(report, defaultCatalog, options, renderedSkips));

  lines.push(...nextBlock(report, defaultCatalog));

  return `${lines.join('\n')}\n`;
}
