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
