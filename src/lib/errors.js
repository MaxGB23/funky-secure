/**
 * Errors that mean "the tool could not answer" (exit code 2, RFC 10.4).
 * A policy violation is never an exception: it is a finding plus a verdict.
 */

export class ConfigError extends Error {
  /**
   * @param {string} message human-readable, names the offending key
   * @param {string} [key] the key or id at fault, for tests and for the CLI message
   */
  constructor(message, key) {
    super(message);
    this.name = 'ConfigError';
    this.key = key;
  }
}

export class UsageError extends Error {
  /** @param {string} message the offending argument, named */
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}
