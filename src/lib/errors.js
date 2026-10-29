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

/**
 * A decision not to act (exit code 3, RFC 10.4): the tool understood the situation, refused, and wrote
 * nothing. Distinct from `ConfigError`, which means it could not answer, and from exit 1, which is a
 * report whose findings crossed the threshold. A refusal carries the action that lifts it.
 */
export class RefusalError extends Error {
  /**
   * @param {string} message the diagnosis, after the `reason:` label
   * @param {string} [action] what the human must do first
   */
  constructor(message, action) {
    super(message);
    this.name = 'RefusalError';
    if (action !== undefined) this.action = action;
  }
}
