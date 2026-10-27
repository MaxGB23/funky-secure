/**
 * Human rendering (RFC 10.3, Appendix D.1).
 *
 * Grouped by target, one line per finding, the remediation indented under it, and a summary that
 * separates pass from fail from skip. Passing rules are rolled up into one line that names them.
 * Colour is applied only when the caller says stdout is a TTY and NO_COLOR is unset.
 *
 * The provenance line (S7) states the preset, the source it came from, what was measured about the
 * quarantine and whether the machine scope was excluded — never a value attributed to a source that
 * pnpm does not report (E2).
 *
 * The renderer ends with the `next` block (RFC 10.3, S1-S5): the one command that moves the repository
 * forward, in the same gutter as `summary` and `verdict`.
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

const WRAP = 100;
/** The label column shared by `summary`, `verdict` and `next`, and by their continuation lines. */
const LABEL_WIDTH = 9;

function paint(text, tone, color) {
  if (!color || !ANSI[tone]) return text;
  return `${ANSI[tone]}${text}${ANSI.reset}`;
}

function pathLabel(finding) {
  if (!finding.path) return '';
  return finding.line ? `${finding.path}:${finding.line}` : finding.path;
}

function blockFor(kind, targets, findings) {
  const facts = targets.map((target) => target.detail).filter(Boolean);

  if (kind !== 'importer') {
    if (targets.length === 0 && findings.length === 0) return null;
    return { heading: kind, facts, findings };
  }

  const paths = [
    ...new Set([...targets.map((t) => t.path), ...findings.map((f) => f.path)].filter(Boolean)),
  ].sort();
  if (paths.length === 0) {
    return findings.length === 0 ? null : { heading: 'importer', facts, findings };
  }
  return paths.map((path) => ({
    heading: `importer  ${path}`,
    facts: [],
    findings: findings.filter((finding) => finding.path === path),
  }));
}

function renderBlock(block, color) {
  const lines = [block.heading];
  for (const fact of block.facts) lines.push(`  ${fact}`);

  const ruleWidth = Math.max(...block.findings.map((finding) => finding.rule.length), 0);
  const pathWidth = Math.max(
    ...block.findings.map((finding) => pathLabel(finding).length),
    0,
  );

  for (const finding of block.findings) {
    const symbol =
      finding.status === 'skip'
        ? SYMBOL.skip
        : SYMBOL[finding.severity] ?? SYMBOL.error;
    const tone = finding.status === 'skip' ? 'skip' : finding.severity;

    const prefix = `  ${paint(symbol, tone, color)} `;
    let line = prefix + finding.rule.padEnd(ruleWidth);
    const path = pathLabel(finding);
    if (path) line += `  ${path.padEnd(pathWidth)}`;
    line += `  ${finding.message}`;
    lines.push(line);

    if (finding.remediation && finding.remediation.command) {
      const indent = ' '.repeat(prefix.length + ruleWidth + (path ? 2 + pathWidth : 0) + 2);
      lines.push(`${indent}→ ${finding.remediation.command}`);
    }
  }

  return lines;
}

function rollupPassing(passing, skipped) {
  const head = `passing  ${passing.length} rule${passing.length === 1 ? '' : 's'} (`;
  // Appendix D.1 aligns the continuation under the parenthesis, at the width of `passing  `.
  const indent = ' '.repeat('passing  '.length);
  const lines = [];
  let current = head;

  passing.forEach((finding, index) => {
    const piece = (index === 0 ? '' : ', ') + finding.rule;
    if (current.length + piece.length > WRAP && current !== head) {
      lines.push(`${current},`);
      current = indent + finding.rule;
    } else {
      current += piece;
    }
  });

  lines.push(`${current})`);
  lines[lines.length - 1] += `   ·   ${skipped} skipped`;
  return lines;
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * The one-line provenance of the report (S7), placed right after the title. It repeats no effective
 * pnpm value: the preset source is a measured fact, and the quarantine clause says only what was
 * measured — declared by this repository, not declared, or not verified.
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

/**
 * The one rule a reader should open next: the highest-severity failing finding, ties broken by the
 * catalog order — never alphabetical order and never the order the report happens to print, because
 * report order groups by target first (RFC 10.2). Two runs over the same state name the same rule.
 *
 * @param {Array<object>} failing findings that are neither pass nor skip
 * @param {Array<{ id: string }>} catalog catalog order, the tie-break of RFC 10.3
 * @returns {string} a rule id
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
 * The block a human `scan` ends with (RFC 10.3, S1-S5): the one command that moves the repository
 * forward, in the same nine-character gutter as `summary` and `verdict`.
 *
 * Exactly one of three shapes, decided by the report and nothing else. An automatic fix wins even
 * when the verdict is a pass, because the fixes are still available; the manual shape is what is
 * left when the run failed and nothing in it can be written. The block names no path, no time and no
 * machine value, so two runs over the same state produce the same bytes.
 *
 * @param {{ summary: { verdict: string }, findings: Array<object> }} report
 * @param {Array<{ id: string }>} catalog catalog order, used to break a severity tie
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
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
export function renderHuman(report, { color = false } = {}) {
  const targets = report.targets ?? [];
  const findings = report.findings ?? [];
  // A passing finding is rolled up into one line (RFC 10.3); it is never printed as a finding, so a
  // repository that is fine cannot look like a repository that is not.
  const visible = findings.filter((finding) => finding.status !== 'pass');

  const lines = [
    `${report.tool.name} scan  ·  preset ${report.policy.preset}  ·  scope ${report.scope}`,
  ];
  if (report.provenance) lines.push(provenanceLine(report.provenance));
  lines.push('');

  for (const kind of TARGET_ORDER) {
    const kindTargets = targets.filter((target) => target.kind === kind);
    const kindFindings = visible.filter((finding) => finding.target === kind);
    if (kindTargets.length === 0 && kindFindings.length === 0) continue;

    const block = blockFor(kind, kindTargets, kindFindings);
    const blocks = Array.isArray(block) ? block : block === null ? [] : [block];
    for (const item of blocks) {
      if (item.findings.length === 0 && item.facts.length === 0) continue;
      lines.push(...renderBlock(item, color));
      lines.push('');
    }
  }

  if (visible.length === 0) {
    lines.push('nothing to report', '');
  }

  const passing = findings.filter((finding) => finding.status === 'pass');
  const skipped = findings.filter((finding) => finding.status === 'skip').length;

  if (passing.length > 0) {
    lines.push(...rollupPassing(passing, skipped), '');
  } else if (skipped > 0) {
    lines.push(`passing  0 rules   ·   ${skipped} skipped`, '');
  }

  const { summary, policy } = report;
  lines.push(
    `summary  ${plural(summary.error, 'error', 'errors')} · ${plural(summary.warn, 'warning', 'warnings')} · ${summary.info} info · ${summary.pass} passing · ${plural(summary.skip, 'skipped', 'skipped')}`,
  );

  const verdict = summary.verdict === 'fail' ? 'FAIL' : 'PASS';
  const tone = summary.verdict === 'fail' ? 'error' : 'pass';
  lines.push(`verdict  ${paint(verdict, tone, color)} (threshold: ${policy.failOn})`);
  lines.push(...nextBlock(report, defaultCatalog));

  return `${lines.join('\n')}\n`;
}
