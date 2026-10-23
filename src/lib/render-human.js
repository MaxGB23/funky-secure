/**
 * Human rendering (RFC 10.3, Appendix D.1).
 *
 * Grouped by target, one line per finding, the remediation indented under it, and a summary that
 * separates pass from fail from skip. Passing rules are rolled up into one line that names them.
 * Colour is applied only when the caller says stdout is a TTY and NO_COLOR is unset.
 */

import { TARGET_ORDER } from './report.js';

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
  const names = passing.map((finding) => finding.rule).join(', ');
  const head = `passing  ${passing.length} rule${passing.length === 1 ? '' : 's'} (`;
  const lines = [];
  let current = head;

  for (const word of names.split(' ')) {
    if (current.length + word.length > WRAP && current !== head) {
      lines.push(current);
      current = ' '.repeat(head.length) + word;
    } else {
      current += word;
    }
  }
  lines.push(current + ')');
  lines[lines.length - 1] += `   ·   ${skipped} skipped`;
  return lines;
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * @param {object} report the object built by `buildReport`
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
export function renderHuman(report, { color = false } = {}) {
  const targets = report.targets ?? [];
  const findings = report.findings ?? [];

  const lines = [
    `${report.tool.name} scan  ·  preset ${report.policy.preset}  ·  scope ${report.scope}`,
    '',
  ];

  for (const kind of TARGET_ORDER) {
    const kindTargets = targets.filter((target) => target.kind === kind);
    const kindFindings = findings.filter((finding) => finding.target === kind);
    if (kindTargets.length === 0 && kindFindings.length === 0) continue;

    const block = blockFor(kind, kindTargets, kindFindings);
    const blocks = Array.isArray(block) ? block : block === null ? [] : [block];
    for (const item of blocks) {
      lines.push(...renderBlock(item, color));
      lines.push('');
    }
  }

  if (findings.length === 0) {
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

  return `${lines.join('\n')}\n`;
}
