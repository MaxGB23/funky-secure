/**
 * `skill` (record 0004, 11.8, amended by 0005): the agent skill this package ships.
 *
 * Two answers from one command, because they are the same fact:
 *
 * - with no flag, the file on stdout, byte for byte, so `funky-secure skill > …` still produces a
 *   valid file and an agent can read its own contract from the version it is running;
 * - with `--install`, the file written to the skill directory that this context owns, and a message
 *   that says where. No path is typed and none is accepted: the destination is composed, never parsed.
 *   Replacing an installed copy is a question, and with no terminal to ask it is exit 2 rather than a
 *   guess.
 *
 * Nothing about the repository is read except the worktree root, and only when `--install` needs it:
 * no rule runs and no probe is spawned for the print path, which is why it works in any directory.
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

import { UsageError } from '../lib/errors.js';
import { repoRoot } from '../lib/git.js';
import { createCollector } from '../lib/probes.js';
import { SHIPPED, destinationFor, installSkill } from '../lib/skill-install.js';

/** The hint for the print path, on stderr because stdout is the file. */
const DESTINATIONS = Object.freeze([
  'funky-secure skill: install it with funky-secure skill --install',
  'funky-secure skill: .agents/skills/funky-secure/SKILL.md in this project, ~/.agents/skills/funky-secure/SKILL.md for every project',
]);

/**
 * The question, asked only when a differing file is already installed and neither flag answered it.
 * Any answer that is not an explicit overwrite keeps what is there: the safe reading of "I did not
 * mean that".
 *
 * @param {{ display: string, stdin: object, stdout: object, stderr: object }} input
 * @returns {Promise<boolean>} true to replace
 */
async function askToReplace({ display, stdin, stdout, stderr }) {
  stderr.write(`funky-secure skill: ${display} differs from the skill this version ships\n`);
  stderr.write('funky-secure skill: replacing it discards whatever was changed there\n');
  stderr.write('funky-secure skill: replace it? [k]eep / [o]verwrite: ');
  const reader = createInterface({ input: stdin, output: stdout, terminal: false });
  try {
    const answer = (await reader.question('')).trim().toLowerCase();
    return answer === 'o' || answer === 'overwrite';
  } finally {
    reader.close();
  }
}

/**
 * @param {object} options
 * @param {object} options.stdout
 * @param {object} options.stderr
 * @param {string} [options.cwd]
 * @param {object} [options.env]
 * @param {string} [options.skillPath] the shipped file; overridden only to test the failure branch
 * @param {string} [options.home] the home root; overridden by tests so no test writes outside /tmp
 * @param {object} [options.stdin]
 * @param {object} [options.collector]
 * @param {boolean} [options.install]
 * @param {boolean} [options.user]
 * @param {boolean} [options.force]
 * @param {boolean} [options.keep]
 * @param {(() => boolean) | null} [options.confirm] injected answer; null when no terminal can ask
 * @returns {Promise<number>} exit code
 */
export async function run({
  stdout,
  stderr,
  cwd = process.cwd(),
  env = process.env,
  skillPath = SHIPPED,
  home,
  stdin = process.stdin,
  collector,
  install = false,
  user = false,
  force = false,
  keep = false,
  confirm,
}) {
  // A flag that only means something together with another flag is a usage error, never a silent
  // no-op: the human asked for something and the tool has to say it was not done.
  if (!install) {
    const orphan = [['--user', user], ['--force', force], ['--keep', keep]].find(([, set]) => set === true);
    if (orphan) {
      const error = new UsageError(`${orphan[0]} only applies to --install`);
      error.action = 'add --install, or drop the flag to print the skill';
      throw error;
    }
  }
  if (force && keep) {
    const error = new UsageError('--force and --keep contradict each other');
    error.action = 'pass one of them, or neither to be asked';
    throw error;
  }

  let bytes;
  try {
    bytes = readFileSync(skillPath);
  } catch (error) {
    // A partial or empty file on stdout would be saved by the redirect, so nothing is written there
    // and the usual two-line message names the fix instead.
    const failure = new Error(`cannot read the shipped skill at ${skillPath} (${error.code ?? error.message})`);
    failure.action = 'reinstall funky-secure, the package ships skills/funky-secure/SKILL.md';
    throw failure;
  }

  if (!install) {
    stdout.write(bytes);
    for (const line of DESTINATIONS) stderr.write(`${line}\n`);
    return 0;
  }

  const probes = collector ?? createCollector({ cwd, env });
  const root = user ? null : await repoRoot(probes);
  const destination = destinationFor({ scope: user || root === null ? 'user' : 'project', root, home });

  // The question needs a terminal on stdin; with no terminal the answer must come from a flag, and
  // `installSkill` fails closed when neither arrived.
  const answer = typeof confirm === 'undefined'
    ? stdin?.isTTY
      ? () => askToReplace({ display: destination.display, stdin, stdout, stderr })
      : null
    : confirm;

  const resolved = await installSkill({ destination, bytes, force, keep, confirm: answer });
  const lines = [];
  if (resolved.outcome === 'installed') {
    lines.push(`funky-secure skill: installed ${resolved.display}`);
    lines.push(
      destination.scope === 'project'
        ? 'funky-secure skill: commit it, so the repository carries the instructions its agents read'
        : 'funky-secure skill: it applies to every project on this machine',
    );
  } else if (resolved.outcome === 'unchanged') {
    lines.push(`funky-secure skill: ${resolved.display} already carries this exact version`);
  } else {
    lines.push(`funky-secure skill: kept ${resolved.display} as it is`);
  }
  for (const line of lines) stderr.write(`${line}\n`);
  return 0;
}
