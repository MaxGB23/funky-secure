/**
 * Installing the shipped skill (record 0005, 11.8): the one write this tool performs outside the
 * repository.
 *
 * The destination is a constant, composed from a root and four fixed segments — `.agents`, `skills`,
 * `funky-secure`, `SKILL.md`. No path is ever accepted from the command line, so there is no input to
 * traverse with: `assertDestination` re-checks the composition immediately before the write instead of
 * validating a user string, and `paths.validateWriteTarget` keeps its repository-only job untouched.
 *
 * Two rules carry over from the repository writers (RFC 4.3): a target is never replaced without an
 * answer, and an identical file is not rewritten at all. "Replaced without an answer" is why `--force`
 * and `--keep` exist — not as a convenience, but because a run with no terminal has nobody to ask, and
 * guessing on the human's behalf is the failure this command refuses to make.
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

/** The shipped file, resolved against this module so `cwd` cannot move it. */
export const SHIPPED = fileURLToPath(new URL('../../skills/funky-secure/SKILL.md', import.meta.url));

/** The four fixed segments of every destination. Project and user scope differ only by root. */
export const SKILL_SEGMENTS = Object.freeze(['.agents', 'skills', 'funky-secure', 'SKILL.md']);

/**
 * An exit-2 failure that carries the action it asks for, in the shape `cli.js` prints.
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
 * it is a self-check on the composition, and it runs on every call because a destination that drifts
 * is a destination that writes somewhere nobody reviewed.
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
 * @param {string} path
 * @param {Buffer} bytes
 * @returns {void}
 */
function writeAtomically(path, bytes) {
  const directory = dirname(path);
  const temporary = join(directory, `.${process.pid}.SKILL.md.tmp`);
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
  } catch (error) {
    // A half-written file would be read as an installation, so the temporary is removed and the
    // failure surfaces as exit 2 with the action that fixes it.
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      /* the write already failed; the leftover is named by the path the message prints */
    }
    throw failure(
      `cannot write ${path} (${error.code ?? error.message})`,
      'check the directory permissions, then run the command again',
    );
  }
}

/**
 * Installs the shipped bytes, asking before anything is replaced.
 *
 * Outcomes, in the order they are decided:
 *
 * - `unchanged` — the installed file is byte-identical; nothing is written and no question is asked.
 * - `kept` — the human answered keep, or passed `--keep`; the installed bytes stay untouched.
 * - `installed` — absent, or replaced through `--force` or a human answer.
 *
 * `confirm` is `null` when there is no terminal to ask. A differing file with no terminal and no flag
 * is exit 2, never a silent overwrite and never a silent skip.
 *
 * @param {object} input
 * @param {{ path: string, display: string }} input.destination
 * @param {Buffer} input.bytes
 * @param {boolean} [input.force]
 * @param {boolean} [input.keep]
 * @param {(() => boolean | Promise<boolean>) | null} [input.confirm]
 * @returns {Promise<{ outcome: 'installed' | 'unchanged' | 'kept', path: string, display: string }>}
 */
export async function installSkill({ destination, bytes, force = false, keep = false, confirm = null }) {
  const { path, display } = destination;
  assertDestination(path);

  let installed = null;
  if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink()) {
      throw failure(
        `refusing to write ${display}: it is a symbolic link`,
        'remove the link and run the command again, or install with --user',
      );
    }
    installed = readFileSync(path);
    if (Buffer.compare(installed, bytes) === 0) return { outcome: 'unchanged', path, display };
    if (keep) return { outcome: 'kept', path, display };
    if (!force) {
      if (confirm === null) {
        throw failure(
          `cannot ask whether to replace ${display}: it differs from the shipped skill and stdin is not a terminal`,
          'pass --force to replace it, or --keep to leave it as it is',
        );
      }
      if ((await confirm()) !== true) return { outcome: 'kept', path, display };
    }
  }

  writeAtomically(path, bytes);
  return { outcome: 'installed', path, display };
}
