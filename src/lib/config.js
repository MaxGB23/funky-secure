/**
 * Configuration discovery and validation (RFC 9.2, 9.3).
 *
 * JSON only: no YAML, no JS, no comments. There is no parser to depend on and no code execution
 * path. Machine scope never reads a repository config, so this module is only called by commands
 * that own a repository root.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConfigError, PRESETS, RULE_SEVERITIES } from './policy.js';

export { ConfigError };

export const CONFIG_FILENAME = 'funky-secure.config.json';
/** The complete set of accepted top-level keys; anything else is an error named by key. */
export const CONFIG_KEYS = ['preset', 'quarantineMinutes', 'rules'];

/**
 * Validates a parsed config document and returns a normalized copy holding only known keys.
 * @param {unknown} raw
 * @param {{ catalog?: Array<{ id: string }> }} [options]
 * @returns {{ preset?: string, quarantineMinutes?: number, rules?: Record<string, string> }}
 */
export function validateConfig(raw, { catalog = [] } = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(`${CONFIG_FILENAME} must contain a JSON object`, CONFIG_FILENAME);
  }

  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.includes(key)) {
      throw new ConfigError(`${CONFIG_FILENAME}: unknown key "${key}"`, key);
    }
  }

  const config = {};

  if (raw.preset !== undefined) {
    if (!PRESETS.includes(raw.preset)) {
      throw new ConfigError(`${CONFIG_FILENAME}: unknown preset "${raw.preset}"`, String(raw.preset));
    }
    config.preset = raw.preset;
  }

  if (raw.quarantineMinutes !== undefined) {
    const value = raw.quarantineMinutes;
    if (!Number.isInteger(value) || value <= 0) {
      throw new ConfigError(
        `${CONFIG_FILENAME}: quarantineMinutes must be a positive integer`,
        'quarantineMinutes',
      );
    }
    config.quarantineMinutes = value;
  }

  if (raw.rules !== undefined) {
    const rules = raw.rules;
    if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
      throw new ConfigError(`${CONFIG_FILENAME}: rules must be an object of id -> severity`, 'rules');
    }
    const known = new Set(catalog.map((rule) => rule.id));
    const normalized = {};
    for (const [id, severity] of Object.entries(rules)) {
      if (!known.has(id)) {
        throw new ConfigError(`${CONFIG_FILENAME}: unknown rule id "${id}"`, id);
      }
      if (!RULE_SEVERITIES.includes(severity)) {
        throw new ConfigError(
          `${CONFIG_FILENAME}: unknown severity "${severity}" for rule "${id}"`,
          id,
        );
      }
      normalized[id] = severity;
    }
    config.rules = normalized;
  }

  return config;
}

/**
 * Reads the repository config: the git toplevel of `cwd`, else `cwd` (RFC 9.3).
 * @param {{ cwd: string, root?: string | null, catalog?: Array<{ id: string }> }} options
 * @returns {{ config: object | null, path: string | null }}
 */
export function loadConfig({ cwd, root = null, catalog = [] } = {}) {
  const fromRoot = root === null || root === undefined ? null : join(root, CONFIG_FILENAME);
  const fromCwd = join(cwd, CONFIG_FILENAME);

  let path = null;
  if (fromRoot !== null && existsSync(fromRoot)) {
    path = fromRoot;
  } else if (existsSync(fromCwd)) {
    path = fromCwd;
  }
  if (path === null) return { config: null, path: null };

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConfigError(`${CONFIG_FILENAME} is not valid JSON: ${error.message}`, CONFIG_FILENAME);
    }
    throw error;
  }

  return { config: validateConfig(raw, { catalog }), path };
}
