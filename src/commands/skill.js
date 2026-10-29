/**
 * `skill` (record 0004, 11.8, amended by its distribution amendment): the agent skill this package
 * ships, printed on stdout byte for byte.
 *
 * The command is the distribution channel. npm has no convention for installing a skill, and a
 * `postinstall` that wrote into a home directory would be exactly the side effect this tool audits
 * other packages for, so the binary prints the file and a redirect saves it: stdout is the file and
 * nothing else, which is what makes `funky-secure skill > …/SKILL.md` produce a valid file.
 *
 * The file is resolved from this module, never from `process.cwd()`, so the answer does not depend on
 * where it is run and no repository has to exist. Nothing is read about the repository: no rule runs,
 * no probe is spawned, and the command exits `0` in any directory.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The shipped file, resolved against this module so `cwd` cannot move it. */
const SHIPPED = fileURLToPath(new URL('../../skills/funky-secure/SKILL.md', import.meta.url));

/**
 * The hint, on stderr because stdout is the file: two lines naming the project-local destination and
 * the user-level one, and no agent product, because the command is runtime-neutral.
 */
const DESTINATIONS = Object.freeze([
  'funky-secure skill: write it to .agents/skills/funky-secure/SKILL.md in this project',
  'funky-secure skill: or to ~/.agents/skills/funky-secure/SKILL.md for every project',
]);

/**
 * @param {object} options
 * @param {object} options.stdout
 * @param {object} options.stderr
 * @param {string} [options.skillPath] the shipped file; overridden only to test the failure branch
 * @returns {Promise<number>} exit code, always 0
 */
export async function run({ stdout, stderr, skillPath = SHIPPED }) {
  let bytes;
  try {
    bytes = readFileSync(skillPath);
  } catch (error) {
    // A partial or empty file on stdout would be saved by the redirect, so nothing is written there
    // and the usual two-line message names the fix instead (S5).
    const failure = new Error(`cannot read the shipped skill at ${skillPath} (${error.code ?? error.message})`);
    failure.action = 'reinstall funky-secure, the package ships skills/funky-secure/SKILL.md';
    throw failure;
  }

  stdout.write(bytes);
  for (const line of DESTINATIONS) stderr.write(`${line}\n`);
  return 0;
}
