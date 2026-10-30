/**
 * What a pnpm specifier means, in one place (RFC 8.2 R5, 11.9).
 *
 * Two callers need the same answer: `exact-versions` decides whether to report a specifier, and
 * `funky-secure pin` decides whether there is anything to pin. A copy of this predicate in each would
 * be a rule that reports one thing and a command that fixes another, so it lives here and both import
 * it.
 */

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const CATALOGUE_SCHEME = 'catalog';
const EXACT_LITERAL = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PARTIAL_LITERAL = /^\d+(?:\.\d+)*$/;
const TAG_LITERAL = /^[a-z][a-z0-9._-]*$/i;

/**
 * A wildcard version token such as `x`, `1.x` or `1.2.X`.
 * @param {string} value
 * @returns {boolean}
 */
function isWildcard(value) {
  const segments = value.split('.');
  return (
    segments.some((segment) => /^[xX]$/.test(segment)) &&
    segments.every((segment) => /^[xX]$/.test(segment) || /^\d+$/.test(segment))
  );
}

/**
 * Whether a specifier can resolve to more than one version.
 *
 * `workspace:*` is a pinned internal link; `workspace:^` and `workspace:~` are ranges;
 * `workspace:<version>` is a pin. `link:` is a live local link, and `git+`, `github:`, `http(s):`,
 * `git:` and `file:` pin no registry version at all.
 *
 * @param {unknown} specifier
 * @returns {boolean}
 */
export function isFloating(specifier) {
  if (typeof specifier !== 'string') return false;
  const value = specifier.trim();
  if (value === '') return false;

  const scheme = value.match(SCHEME)?.[1]?.toLowerCase() ?? null;
  if (scheme !== null) {
    if (scheme === 'npm') {
      const rest = value.slice('npm:'.length);
      const at = rest.lastIndexOf('@');
      if (at <= 0) return true;
      return isFloating(rest.slice(at + 1));
    }
    if (scheme === 'workspace') {
      const rest = value.slice('workspace:'.length);
      if (rest === '*') return false;
      return isFloating(rest);
    }
    // A catalogue reference resolves to exactly one version: the one the catalogue holds. It is not
    // floating, and it is never pinnable — writing a version here would delete the reference and
    // freeze one dependency out of the catalogue while its siblings kept reading it (0026).
    if (scheme === CATALOGUE_SCHEME) return false;
    return scheme !== 'link';
  }

  if (value === 'latest') return true;
  if (/^[\^~<>]/.test(value)) return true;
  if (value.startsWith('*')) return true;
  if (isWildcard(value)) return true;
  if (/\s|\|\|/.test(value)) return true;
  if (EXACT_LITERAL.test(value)) return false;
  if (/^v\d/.test(value) && EXACT_LITERAL.test(value.slice(1))) return false;
  if (PARTIAL_LITERAL.test(value)) return true;
  if (TAG_LITERAL.test(value)) return true;
  return false;
}

/**
 * Whether a specifier reads its range from a `pnpm-workspace.yaml` catalogue (RFC 8.2 R5, 11.9).
 *
 * `catalog:` is the `default` catalogue and `catalog:<name>` names another. `pin` needs its own
 * predicate because "not floating" is not the same as "exact": a catalogue reference is neither.
 * @param {unknown} specifier
 * @returns {boolean}
 */
export function isCatalogue(specifier) {
  if (typeof specifier !== 'string') return false;
  return specifier.trim().toLowerCase().startsWith(`${CATALOGUE_SCHEME}:`);
}

/**
 * The dependency sections of a manifest, in the order the report walks them.
 */
export const DEPENDENCY_SECTIONS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
