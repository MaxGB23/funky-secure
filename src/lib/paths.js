/**
 * Write-target validation (RFC 11.5).
 *
 * The target always comes from the closed catalog of the RFC; this module only answers whether that
 * catalog entry may be written here. Nothing is created, and the check is cheap enough to repeat
 * immediately before the write (11.5 point 4).
 */

import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative as relativePath, resolve, sep } from 'node:path';

/**
 * Whether two spellings name one directory.
 *
 * A Windows volume with 8.3 names answers both `runneradmin` and `RUNNER~1` for one directory, and
 * `realpathSync` hands back whichever it was given. The native call goes through the operating system
 * and expands both to the same value, so it answers this question even where it cannot be used to
 * *report* a path: canonicalizing what the tool prints changed every string the tests compared, which
 * is why that attempt was reverted (issue 210). Here the answer is a boolean and the value is dropped.
 *
 * @param {string} one
 * @param {string} other
 * @returns {boolean}
 */
export function sameDirectory(one, other) {
  if (typeof one !== 'string' || typeof other !== 'string' || one === '' || other === '') return false;
  const fold = (directory) => {
    let expanded;
    try {
      expanded = realpathSync.native(directory);
    } catch {
      expanded = directory;
    }
    const withSeparators = expanded.split('/').join(sep);
    return process.platform === 'win32' ? withSeparators.toLowerCase() : withSeparators;
  };
  return fold(one) === fold(other);
}

/**
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
function isInside(root, target) {
  const between = relativePath(root, target);
  return between === '' || (between !== '..' && !between.startsWith(`..${sep}`) && !isAbsolute(between));
}

/**
 * @param {string} relative
 * @returns {boolean}
 */
function isRepositoryRelative(relative) {
  if (relative === '') return false;
  if (isAbsolute(relative)) return false;
  if (/^[A-Za-z]:[\\/]/.test(relative) || relative.startsWith('\\\\')) return false;
  const segments = relative.split(/[\\/]/);
  return segments.every((segment) => segment !== '' && segment !== '..');
}

/**
 * @param {{ root?: string, relative?: string, expectedBasename?: string }} target
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function validateWriteTarget({ root, relative, expectedBasename } = {}) {
  if (typeof relative !== 'string' || !isRepositoryRelative(relative)) {
    return { ok: false, reason: 'not-relative' };
  }
  if (expectedBasename !== undefined && expectedBasename !== null) {
    const actual = relative.split(/[\\/]/).at(-1);
    if (actual !== expectedBasename) return { ok: false, reason: 'basename-mismatch' };
  }
  if (typeof root !== 'string' || root === '') return { ok: false, reason: 'unresolvable' };

  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch {
    return { ok: false, reason: 'unresolvable' };
  }

  const resolved = resolve(realRoot, relative);
  const parent = dirname(resolved);
  let realParent;
  try {
    realParent = realpathSync(parent);
  } catch {
    return { ok: false, reason: 'unresolvable' };
  }

  let target = resolve(realParent, basename(resolved));
  if (existsSync(resolved)) {
    try {
      target = realpathSync(resolved);
    } catch {
      return { ok: false, reason: 'unresolvable' };
    }
  }

  if (!isInside(realRoot, target)) return { ok: false, reason: 'outside-root' };
  return { ok: true, path: target };
}
