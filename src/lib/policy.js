/**
 * Policy model of RFC 9: presets, overrides, precedence and validation.
 *
 * Everything here is pure. The caller supplies the catalog and the parsed config; this module
 * decides which rules run and at which severity, and never touches the filesystem.
 */

import { ConfigError } from './errors.js';

export { ConfigError };

/** @type {readonly string[]} */
export const PRESETS = ['baseline', 'strict', 'starter'];
/** @type {readonly string[]} */
export const RULE_SEVERITIES = ['off', 'info', 'warn', 'error'];
/** @type {readonly string[]} */
export const FAIL_ON_VALUES = ['error', 'warn', 'info', 'none'];

export const DEFAULT_FAIL_ON = 'error';
export const DEFAULT_PRESET = 'baseline';

/** The manager's built-in default on the pnpm 11/12 line (RFC 9.4, E1). */
export const QUARANTINE_DEFAULT_MINUTES = 1440;
/** The floor the `strict` preset asks for (RFC 9.4). */
export const QUARANTINE_STRICT_MINUTES = 4320;
/** The first pnpm major with a built-in quarantine; before it the default is 0 (RFC 9.4). */
export const QUARANTINE_FIRST_GATED_MAJOR = 11;

/**
 * The preset-to-severity map: the one place a preset states which rules it runs, beside `PRESETS` and
 * never a second catalog — every rule keeps its own `severity` object. A preset that is not a key here
 * takes each rule's own severity for that preset.
 *
 * `starter` is the day-zero preset (record 0003, S5 and L10): it runs exactly these six at their
 * `baseline` severity and turns every other catalog rule `off`, so it is a reduced `baseline`, never a
 * second `strict`. Adding a rule to the catalog therefore leaves it `off` under `starter` until this list
 * says otherwise, which is the safe direction for a preset that claims to check less.
 *
 * `foreign-lockfile` belongs to the day-zero set (L10): a repository a framework generator produced
 * starts with someone else's lockfile, and it is the one rule that names a second package manager. It
 * keeps the `warn` of `baseline`, so including it keeps the preset gentle.
 *
 * @type {Readonly<Record<string, { atBaseline: readonly string[], otherwise: string }>>}
 */
export const PRESET_SEVERITY = Object.freeze({
  starter: Object.freeze({
    atBaseline: Object.freeze([
      'package-manager-pin',
      'lockfile-committed',
      'foreign-lockfile',
      'quarantine',
      'exact-versions',
      'sensitive-ignored',
    ]),
    otherwise: 'off',
  }),
});

/**
 * The severity one preset gives one rule: the preset's own opinion when it carries one, otherwise the
 * rule's own severity for that preset, and `warn` for a catalog entry that declares neither.
 * @param {{ id: string, severity?: Record<string, string> }} rule
 * @param {string} preset
 * @returns {string}
 */
function presetSeverity(rule, preset) {
  const declared = PRESET_SEVERITY[preset];
  if (declared === undefined) return rule.severity?.[preset] ?? 'warn';
  return declared.atBaseline.includes(rule.id)
    ? (rule.severity?.baseline ?? 'warn')
    : declared.otherwise;
}

const SEVERITY_RANK = { off: 0, info: 1, warn: 2, error: 3 };

/**
 * Orders severities for the verdict comparison. An unknown value is a configuration error, never a
 * silent `off`: a mistyped severity is the same defect class as a stale help text (RFC 9.2).
 * @param {string} severity
 * @returns {0 | 1 | 2 | 3}
 */
export function severityRank(severity) {
  const rank = SEVERITY_RANK[severity];
  if (rank === undefined) {
    throw new ConfigError(`unknown severity "${severity}"`, String(severity));
  }
  return /** @type {0 | 1 | 2 | 3} */ (rank);
}

/**
 * The release-age floor R4 compares against (RFC 9.4): the repository override wins, then the
 * preset, then the manager's default for the pinned major.
 * @param {{ preset?: string, override?: number, major?: number }} [options]
 * @returns {number}
 */
export function quarantineFloor({ preset = DEFAULT_PRESET, override, major } = {}) {
  if (override !== undefined) return override;
  // `starter` is a reduced `baseline`, not a stricter one: it keeps the manager's default gate and
  // never the 4320 floor of `strict` (record 0003, S5, RFC 9.4).
  if (preset === 'strict') return QUARANTINE_STRICT_MINUTES;
  if (typeof major === 'number' && major < QUARANTINE_FIRST_GATED_MAJOR) return 0;
  return QUARANTINE_DEFAULT_MINUTES;
}

function assertPreset(preset) {
  if (!PRESETS.includes(preset)) {
    throw new ConfigError(`unknown preset "${preset}"`, String(preset));
  }
}

function assertFailOn(failOn) {
  if (!FAIL_ON_VALUES.includes(failOn)) {
    throw new ConfigError(`unknown --fail-on value "${failOn}"`, String(failOn));
  }
}

function assertRuleIds(ids, catalog, flag) {
  if (ids === undefined) return;
  if (!Array.isArray(ids)) {
    throw new ConfigError(`${flag} must be a list of rule ids`, flag);
  }
  const known = new Set(catalog.map((rule) => rule.id));
  for (const id of ids) {
    if (!known.has(id)) {
      throw new ConfigError(`${flag}: unknown rule id "${id}"`, String(id));
    }
  }
}

function assertRuleMap(rules, catalog) {
  if (rules === undefined) return;
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
    throw new ConfigError('rules must be an object of id -> severity', 'rules');
  }
  const known = new Set(catalog.map((rule) => rule.id));
  for (const [id, severity] of Object.entries(rules)) {
    if (!known.has(id)) {
      throw new ConfigError(`unknown rule id "${id}"`, id);
    }
    if (!RULE_SEVERITIES.includes(severity)) {
      throw new ConfigError(`unknown severity "${severity}" for rule "${id}"`, id);
    }
  }
}

/**
 * Resolves the effective policy for one run.
 *
 * Precedence (RFC 9.2), highest first: `ignore` -> `only` -> config `rules` -> preset default.
 * `off` is applied before `only`: narrowing never resurrects a rule the repository turned off.
 *
 * @param {object} options
 * @param {Array<{ id: string, severity?: Record<string, string> }>} [options.catalog]
 * @param {string} [options.presetFromFlag]
 * @param {{ preset?: string, quarantineMinutes?: number, rules?: Record<string, string> }} [options.config]
 * @param {string[]} [options.only]
 * @param {string[]} [options.ignore]
 * @param {string} [options.failOn]
 * @param {boolean} [options.requireVerified] treat an unverified rule as a violation (0023)
 * @param {number} [options.major] active pnpm major, when a probe answered
 * @returns {{ preset: string, quarantineMinutes: number, failOn: string, requireVerified: boolean, severities: Record<string, string>, active: string[] }}
 */
export function resolvePolicy({
  catalog = [],
  presetFromFlag,
  config = {},
  only,
  ignore,
  failOn,
  requireVerified = false,
  major,
} = {}) {
  const preset = presetFromFlag ?? config.preset ?? DEFAULT_PRESET;
  assertPreset(preset);

  const effectiveFailOn = failOn ?? DEFAULT_FAIL_ON;
  assertFailOn(effectiveFailOn);

  assertRuleMap(config.rules, catalog);
  assertRuleIds(only, catalog, '--only');
  assertRuleIds(ignore, catalog, '--ignore');

  const configured = config.rules ?? {};
  const ignored = new Set(ignore ?? []);
  const selected = only === undefined ? null : new Set(only);

  const severities = {};
  const active = [];

  for (const rule of catalog) {
    const severity = configured[rule.id] ?? presetSeverity(rule, preset);
    severities[rule.id] = severity;

    if (severity === 'off') continue;
    if (ignored.has(rule.id)) continue;
    if (selected !== null && !selected.has(rule.id)) continue;
    active.push(rule.id);
  }

  return {
    preset,
    quarantineMinutes: quarantineFloor({
      preset,
      override: config.quarantineMinutes,
      major,
    }),
    failOn: effectiveFailOn,
    requireVerified,
    severities,
    active,
  };
}
