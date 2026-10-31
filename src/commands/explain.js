/**
 * `explain` (RFC 11.4): a rendering of the catalog, in depth for one rule or as a list.
 *
 * There is no repository read and no probe: the catalog is the only input, which is what keeps the
 * command and `--help` from disagreeing with what the engine runs.
 */

import { UsageError } from '../lib/errors.js';
import { TOOL } from '../lib/tool.js';
import { catalog as defaultCatalog } from '../rules/index.js';

/**
 * A usage error that carries the action it asks for: `cli.run` prints that action first and the
 * message after a `reason:` label (S5).
 * @param {string} message the diagnosis, including the offending id
 * @param {string} action what the human must do
 * @returns {UsageError}
 */
function usage(message, action) {
  const error = new UsageError(message);
  error.action = action;
  return error;
}

function severityOf(rule) {
  return {
    baseline: rule.severity?.baseline ?? 'warn',
    strict: rule.severity?.strict ?? 'warn',
  };
}

function shown(value) {
  if (value === undefined || value === null || value === '') return '(not documented)';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(shown).join('; ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The state severities of a rule whose severity follows the state of its finding (0029).
 *
 * `explain` is the complete reference a human has (I-33), so the pair a state answers and the evidence
 * that selects it are printed beside the base pair. It is generated from the rule's own `severityWhen`,
 * never from a rule id: a second rule that needs a state table would otherwise have to pay for this
 * again. A rule that declares no state table contributes no line, so its rendering is unchanged.
 * @param {object} rule
 * @returns {string[]}
 */
function stateLines(rule) {
  const states = Array.isArray(rule.severityWhen) ? rule.severityWhen : [];
  return states.map((entry) => {
    const { baseline, strict } = severityOf({ severity: entry.severity });
    const selects = `${entry.evidence} is ${shown(entry.is)}`;
    return `${'state'.padEnd(12)}${entry.state} ${baseline} / ${strict} (baseline / strict) when ${selects}`;
  });
}

/** The JSON document of one rule: the same fields the text rendering prints. */
function ruleDocument(rule) {
  const { baseline, strict } = severityOf(rule);
  return {
    id: rule.id,
    title: rule.title ?? '',
    friction: rule.friction ?? 0,
    severity: { baseline, strict },
    question: rule.question ?? null,
    detection: rule.detection ?? null,
    evidence: rule.evidence ?? null,
    remediation: rule.remediation ?? null,
    limits: rule.limits ?? null,
    docs: rule.docs ?? null,
  };
}

function renderRule(rule) {
  const { baseline, strict } = severityOf(rule);
  const fields = [
    ['question', rule.question],
    ['detection', rule.detection],
    ['evidence', rule.evidence],
    ['remediation', rule.remediation],
    ['limits', rule.limits],
    ['docs', rule.docs],
  ];

  const lines = [
    `${rule.id} — ${rule.title ?? ''}`,
    '',
    `friction ${rule.friction ?? 0} · severity ${baseline} / ${strict} (baseline / strict)`,
    ...stateLines(rule),
    '',
  ];
  for (const [label, value] of fields) {
    lines.push(`${label.padEnd(12)}${shown(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderList(catalog) {
  if (catalog.length === 0) return '(none registered yet)\n';
  const idWidth = Math.max(...catalog.map((rule) => rule.id.length));
  const lines = catalog.map((rule) => {
    const { baseline, strict } = severityOf(rule);
    return `${rule.id.padEnd(idWidth)}  ${baseline}/${strict}  ${rule.title ?? ''}`;
  });
  return `${lines.join('\n')}\n`;
}

function jsonDocument(rules) {
  return `${JSON.stringify({ schemaVersion: 1, tool: TOOL, rules }, null, 2)}\n`;
}

/**
 * @param {object} options
 * @param {object} options.stdout
 * @param {string[]} [options.positionals]
 * @param {boolean} [options.list]
 * @param {string} [options.format]
 * @param {Array<object>} [options.catalog]
 * @returns {Promise<number>} exit code
 */
export async function run({
  stdout,
  positionals = [],
  list = false,
  format = 'human',
  catalog = defaultCatalog,
}) {
  if (list) {
    if (positionals.length > 0) {
      throw usage(
        `--list accepts no rule id (got "${positionals[0]}")`,
        'pass --list on its own to list the whole catalog',
      );
    }
    const text =
      format === 'json' ? jsonDocument(catalog.map(ruleDocument)) : renderList(catalog);
    stdout.write(text);
    return 0;
  }

  if (positionals.length === 0) {
    // No argument is not a mistake to punish: a human who types `explain` alone is asking what there
    // is to explain. `--list` stays as the explicit synonym, and an agent that wants a guarantee still
    // gets one, because the answer is the same catalog `explain --list` prints.
    stdout.write(format === 'json' ? jsonDocument(catalog.map(ruleDocument)) : renderList(catalog));
    return 0;
  }
  if (positionals.length > 1) {
    throw usage(
      `explain accepts one rule id (got "${positionals.join(' ')}")`,
      'pass one rule id',
    );
  }

  const id = positionals[0];
  const rule = catalog.find((candidate) => candidate.id === id) ?? null;
  if (rule === null) {
    throw usage(`unknown rule id "${id}"`, 'run funky-secure explain --list to see the rule ids');
  }

  stdout.write(format === 'json' ? jsonDocument([ruleDocument(rule)]) : renderRule(rule));
  return 0;
}
