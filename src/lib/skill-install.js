/**
 * Installing the shipped skill (records 0004, 0005; 11.5 point 7 and 11.8): the one write this tool
 * performs outside the repository.
 *
 * Bytes alone cannot answer the question the human is really asking. "Different from what I ship"
 * covers three situations that deserve three different answers — an older copy waiting for an upgrade,
 * a newer copy than this binary, and the same version edited by hand — so the file carries the version
 * it belongs to, and the comparison is version first, bytes second.
 *
 * The destination is a constant: a root plus four fixed segments (`.agents`, `skills`, `funky-secure`,
 * `SKILL.md`). No path is ever accepted from the command line, so there is no input to traverse with.
 * `assertDestination` re-checks the composition immediately before the write instead of validating a
 * user string, and `paths.validateWriteTarget` keeps its repository-only job untouched.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RefusalError } from './errors.js';

/** The shipped file, resolved against this module so `cwd` cannot move it. */
export const SHIPPED = fileURLToPath(new URL('../../skills/funky-secure/SKILL.md', import.meta.url));

/** The four fixed segments of every destination. Project and user scope differ only by root. */
export const SKILL_SEGMENTS = Object.freeze(['.agents', 'skills', 'funky-secure', 'SKILL.md']);

/**
 * An exit-2 failure that carries the action it asks for, in the shape `cli.js` prints. A refusal to act
 * — a symbolic link in the way — is a `RefusalError` instead, because it exits 3.
 * @param {string} message the diagnosis
 * @param {string} action what the human must do
 * @returns {Error}
 */
function failure(message, action) {
  const error = new Error(message);
  error.action = action;
  return error;
}

/**
 * The version the file declares in its frontmatter, or null when it declares none.
 *
 * The value is read from the bytes rather than from `package.json` so a copy that travelled by hand
 * still says what it is: the file is the artifact, and it has to describe itself.
 *
 * @param {Buffer} bytes
 * @returns {string | null}
 */
export function readSkillVersion(bytes) {
  const text = bytes.toString('utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (frontmatter === null) return null;
  const declared = /^version:[ \t]*(\S+)/m.exec(frontmatter[1]);
  return declared === null ? null : declared[1];
}

/**
 * Orders two dotted versions numerically, ignoring any prerelease suffix.
 * @param {string} left
 * @param {string} right
 * @returns {-1 | 0 | 1} -1 when `left` is older
 */
export function compareVersions(left, right) {
  const parts = (value) => String(value).split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Where `--install` writes. `project` is the repository that owns the session; `user` is the machine's
 * home. The root is resolved by the caller — never by an argument — and `display` is the portable form
 * the message prints, so no absolute machine path reaches the prose.
 *
 * @param {{ scope: 'project' | 'user', root?: string | null, home?: string }} target
 * @returns {{ scope: 'project' | 'user', path: string, display: string }}
 */
export function destinationFor({ scope, root = null, home = homedir() }) {
  if (scope === 'project') {
    if (typeof root !== 'string' || root === '') {
      throw failure(
        'cannot install for this project: no worktree root',
        'run it inside the repository, or pass --user to install for every project',
      );
    }
    return { scope, path: join(root, ...SKILL_SEGMENTS), display: SKILL_SEGMENTS.join('/') };
  }
  return { scope: 'user', path: join(home, ...SKILL_SEGMENTS), display: `~/${SKILL_SEGMENTS.join('/')}` };
}

/**
 * Re-checks that a composed path still ends in the four fixed segments. This is not input validation:
 * it is a self-check on the composition, and it runs before every write because a destination that
 * drifts is a destination that writes somewhere nobody reviewed.
 *
 * @param {string} path
 * @returns {string} the same path
 */
export function assertDestination(path) {
  const tail = String(path).split(/[\\/]/).slice(-SKILL_SEGMENTS.length).join('/');
  if (tail !== SKILL_SEGMENTS.join('/')) {
    throw failure(`refusing to write ${path}: it is not the skill destination`, 'report this as a defect');
  }
  return path;
}

/**
 * What is installed, without changing anything.
 *
 * | state | meaning |
 * |---|---|
 * | `absent` | nothing there yet |
 * | `identical` | the shipped bytes, exactly |
 * | `edited` | the same version, different bytes: a human changed it |
 * | `older` | an earlier version: replacement is an upgrade |
 * | `newer` | a later version than this binary ships: replacement is a downgrade |
 * | `unversioned` | no version line, so its origin cannot be told |
 *
 * @param {{ destination: { path: string, display: string }, bytes: Buffer, shippedVersion: string | null }} input
 * @returns {{ state: 'absent' | 'identical' | 'edited' | 'older' | 'newer' | 'unversioned', installedVersion: string | null, shippedVersion: string | null, path: string, display: string }}
 */
export function inspectInstallation({ destination, bytes, shippedVersion }) {
  const { path, display } = destination;
  assertDestination(path);

  if (!existsSync(path)) return { state: 'absent', installedVersion: null, shippedVersion, path, display };
  if (lstatSync(path).isSymbolicLink()) {
    throw new RefusalError(
      `refusing to write ${display}: it is a symbolic link`,
      'remove the link and run the command again, or install with --user',
    );
  }

  const installed = readFileSync(path);
  if (Buffer.compare(installed, bytes) === 0) {
    return { state: 'identical', installedVersion: readSkillVersion(installed), shippedVersion, path, display };
  }

  const installedVersion = readSkillVersion(installed);
  if (installedVersion === null || shippedVersion === null) {
    return { state: 'unversioned', installedVersion, shippedVersion, path, display };
  }
  const order = compareVersions(installedVersion, shippedVersion);
  if (order < 0) return { state: 'older', installedVersion, shippedVersion, path, display };
  if (order > 0) return { state: 'newer', installedVersion, shippedVersion, path, display };
  return { state: 'edited', installedVersion, shippedVersion, path, display };
}

/**
 * Writes the shipped bytes over the destination. Atomic by construction: a temporary file in the same
 * directory, renamed over the target, removed when the write fails — a half-written skill would be read
 * as an installation.
 *
 * @param {{ path: string }} destination
 * @param {Buffer} bytes
 * @returns {void}
 */
export function writeInstallation({ path }, bytes) {
  assertDestination(path);
  const directory = dirname(path);
  const temporary = join(directory, `.${process.pid}.SKILL.md.tmp`);
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      /* the write already failed; the message names the path that could not be written */
    }
    throw failure(
      `cannot write ${path} (${error.code ?? error.message})`,
      'check the directory permissions, then run the command again',
    );
  }
}
