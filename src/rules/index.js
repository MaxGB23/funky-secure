/**
 * Rule catalog: the single source for `--help`, `explain` and `docs/rules/<id>.md` (RFC 13.1).
 * Catalog order is the report order, so this array is part of the public contract: it follows the
 * order of RFC 8.2, not alphabetical order and not import order.
 */

import actionsPinnedSha from './actions-pinned-sha.js';
import ciNoSafetyOverrides from './ci-no-safety-overrides.js';
import envNotTracked from './env-not-tracked.js';
import exactVersions from './exact-versions.js';
import foreignLockfile from './foreign-lockfile.js';
import lockfileCommitted from './lockfile-committed.js';
import noBotAutoMerge from './no-bot-auto-merge.js';
import packageManagerPin from './package-manager-pin.js';
import quarantine from './quarantine.js';
import sensitiveIgnored from './sensitive-ignored.js';

/** @type {Array<object>} */
export const catalog = [
  packageManagerPin,
  lockfileCommitted,
  foreignLockfile,
  quarantine,
  exactVersions,
  envNotTracked,
  sensitiveIgnored,
  actionsPinnedSha,
  noBotAutoMerge,
  ciNoSafetyOverrides,
];

/** @param {string} id */
export function ruleById(id) {
  return catalog.find((rule) => rule.id === id) ?? null;
}
