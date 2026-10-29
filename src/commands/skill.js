/**
 * `skill` (records 0004, 0005; 11.5 point 7 and 11.8): the agent skill this package ships.
 *
 * Two answers from one command, because they are the same fact:
 *
 * - with no flag, the file on stdout, byte for byte, so `funky-secure skill > …` still produces a
 *   valid file and an agent can read its own contract from the version it is running;
 * - with `--install`, the file written to the skill directory this context owns, and a message that
 *   says where. No path is typed and none is accepted: the destination is composed, never parsed.
 *
 * Replacing an installed copy is decided by what is installed, not by "the bytes differ". The file
 * carries its version, so an older copy is an upgrade, a newer one is a downgrade this binary refuses
 * to perform by default, and the same version with different bytes is a local edit that must not be
 * discarded by a routine command. The question states which of the three it is asking about.
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

import { RefusalError, UsageError } from '../lib/errors.js';
import { SYMBOL } from '../lib/render-human.js';
import { repoRoot } from '../lib/git.js';
import { createCollector } from '../lib/probes.js';
/** The report symbols, plus the tick a success needs and a finding never does. */
const DONE = "✓";

import {
  SHIPPED,
  destinationFor,
  inspectInstallation,
  readSkillVersion,
  writeInstallation,
} from '../lib/skill-install.js';

/** The hint for the print path, on stderr because stdout is the file. */
const DESTINATIONS = Object.freeze([
  'funky-secure skill: install it with funky-secure skill --install',
  'funky-secure skill: .agents/skills/funky-secure/SKILL.md in this project, ~/.agents/skills/funky-secure/SKILL.md for every project',
]);

/**
 * What the question says about the copy that is already there. The three states are not the same
 * decision, so they are not the same sentence.
 * @param {{ state: string, display: string, installedVersion: string | null, shippedVersion: string | null }} found
 * @returns {string}
 */
function differenceSentence({ state, display, installedVersion, shippedVersion }) {
  if (state === 'newer') {
    return `${display} is version ${installedVersion}, newer than the ${shippedVersion} this binary ships`;
  }
  if (state === 'older') {
    return `${display} is version ${installedVersion}; this binary ships ${shippedVersion}`;
  }
  if (state === 'edited') {
    return `${display} carries local changes on version ${installedVersion}`;
  }
  return `${display} carries no version line, so where it came from cannot be told`;
}

/**
 * Reads one answer. The menu is numbered because a number is unambiguous on any keyboard and in any
 * language, and the words are accepted because a human who types them should not be corrected. An
 * empty answer is the default, and the default keeps: a decision that destroys something is never the
 * answer to pressing Enter.
 *
 * @param {string} answer
 * @returns {boolean | null} true to replace, false to keep, null when the answer is not one of them
 */
export function parseAnswer(answer) {
  const normalised = String(answer ?? '').trim().toLowerCase();
  if (normalised === '') return false;
  if (['1', 'k', 'keep'].includes(normalised)) return false;
  if (['2', 'o', 'overwrite', 'replace', 'y', 'yes'].includes(normalised)) return true;
  return null;
}

/**
 * The question, asked only when replacing is a decision a flag has not already made.
 *
 * Three lines of facts, then a numbered menu whose default is stated, then the prompt. Any answer that
 * is not an explicit replacement keeps what is there — the safe reading of "I did not mean that" —
 * and an answer the menu does not offer is asked again rather than guessed at, up to three times.
 *
 * @param {{ found: object, stdin: object, stdout: object, stderr: object }} input
 * @returns {Promise<boolean>} true to replace
 */
/** The prompt, written last so the menu is the line the answer goes under. */
const QUESTION = 'funky-secure skill: choose 1 or 2 [1]: ';

/**
 * The question as lines, in the order a human reads them: what happened, what each answer does, and
 * then the prompt. Blank lines carry no prefix, because a prefixed empty line reads like a mistake.
 *
 * @param {{ state: string, display: string, installedVersion: string | null, shippedVersion: string | null }} found
 * @returns {string[]}
 */
export function questionLines(found) {
  const version = found.shippedVersion === null ? 'the version this binary ships' : `version ${found.shippedVersion}`;
  return [
    `funky-secure skill: ${differenceSentence(found)}\n`,
    'funky-secure skill: replacing it discards whatever is there now\n',
    '\n',
    '  1  keep it as it is, and change nothing\n',
    `  2  replace it with ${version}\n`,
    '\n',
  ];
}

async function askToReplace({ found, stdin, stdout, stderr }) {
  for (const line of questionLines(found)) stderr.write(line);
  stderr.write(QUESTION);

  const reader = createInterface({ input: stdin, output: stdout, terminal: false });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const answer = await reader.question('');
      const decided = parseAnswer(answer);
      if (decided !== null) return decided;
      stderr.write(`funky-secure skill: "${answer.trim()}" is not one of the answers; anything else keeps the file\n`);
    }
    stderr.write('funky-secure skill: keeping the file, since no answer was recognised\n');
    return false;
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

  const shippedVersion = readSkillVersion(bytes);
  const probes = collector ?? createCollector({ cwd, env });
  const root = user ? null : await repoRoot(probes);
  const destination = destinationFor({ scope: user || root === null ? 'user' : 'project', root, home });
  const found = inspectInstallation({ destination, bytes, shippedVersion });

  /** Report one outcome: the symbol and the fact on the first line, the consequence under it. */
  const report = (symbol, fact, detail) => {
    stderr.write(`${symbol}  ${fact}
`);
    if (detail) stderr.write(`     ${detail}
`);
    return 0;
  };

  const suffix = shippedVersion === null ? '' : ` (${shippedVersion})`;

  if (found.state === 'identical') {
    return report(SYMBOL.skip, `Current  ·  ${found.display}${suffix}`, 'nothing to do: it already carries this exact version');
  }

  if (found.state === 'newer' && !force) {
    // A downgrade is not a routine repair: this binary has nothing better to offer than what is
    // installed, and only an explicit --force may take the newer copy away.
    if (keep) return report(SYMBOL.info, `Kept  ·  ${found.display}`, 'it is newer than the version this binary ships');
    throw new RefusalError(
      `refusing to replace ${found.display}: it is version ${found.installedVersion}, and this binary ships ${shippedVersion}`,
      'install the newer funky-secure to keep that version, or pass --force to downgrade the installed skill',
    );
  }

  // Only an existing file needs a decision: a fresh destination has nothing to discard.
  if (found.state !== 'absent') {
    const decided = keep ? false : force ? true : null;
    const answer = decided === null
      ? typeof confirm === 'undefined'
        ? stdin?.isTTY
          ? () => askToReplace({ found, stdin, stdout, stderr })
          : null
        : confirm
      : () => decided;

    if (answer === null) {
      throw Object.assign(
        new Error(`cannot ask whether to replace ${found.display}: ${differenceSentence(found)} and stdin is not a terminal`),
        { action: 'pass --force to replace it, or --keep to leave it as it is' },
      );
    }
    if ((await answer()) !== true) return report(SYMBOL.info, `Kept  ·  ${found.display}`, 'the file was not changed');
  }

  writeInstallation(destination, bytes);

  return report(
    DONE,
    `Installed  ·  ${destination.display}${suffix}`,
    destination.scope === 'project'
      ? 'commit it, so the repository carries the instructions its agents read'
      : 'it applies to every project on this machine',
  );
}
