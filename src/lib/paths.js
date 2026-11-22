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
 * A literal list of repository-relative names, spelled against the directory a step is pasted in.
 *
 * `writtenPaths` spells plan items and nothing else, and the steps this serves print literals: the
 * manifest, `pnpm-lock.yaml` and a foreign lockfile are named by commits that never planned them, and a
 * `package.json` is a plan item only while a writer still has something to change in it. So this takes
 * the names and rebases them, which is the whole of what a `git add` needs: git resolves a pathspec
 * against the directory it runs in, so a file above that directory earns the `../` prefix that works.
 *
 * The guard is the reason this is its own function. At the repository root the names are returned
 * unchanged, because a Windows volume can spell one directory two ways and a subtraction between two
 * spellings answers `../../../../../runneradmin/...` — a path nobody can paste, which is the defect
 * `writtenPaths` has no guard against and the call site that uses it supplies (issue 210). A rebase
 * applied unguarded at the root reintroduces exactly that string.
 *
 * @param {string[]} names repository-relative names, in the order a step prints them
 * @param {string | null} root the repository root the names are relative to
 * @param {string | null} cwd the directory the step is pasted in
 * @returns {string[]}
 */
export function pathsAtCwd(names, root, cwd) {
  if (!Array.isArray(names)) return [];
  if (typeof root !== 'string' || root === '') return names;
  if (typeof cwd !== 'string' || cwd === '') return names;
  if (sameDirectory(root, cwd)) return names;
  return names.map((name) => {
    if (typeof name !== 'string' || name === '') return name;
    return relativePath(cwd, resolve(root, name)).split('\\').join('/');
  });
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
