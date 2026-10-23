/**
 * Rule catalog: the single source for `--help`, `explain` and `docs/rules/<id>.md` (RFC 13.1).
 * Catalog order is the report order, so this array is part of the public contract.
 */

/** @type {Array<object>} */
export const catalog = [];

/** @param {string} id */
export function ruleById(id) {
  return catalog.find((rule) => rule.id === id) ?? null;
}
