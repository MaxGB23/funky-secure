#!/usr/bin/env node
/**
 * The remediation commands, measured by what they leave behind, because a command nobody runs is a
 * string with an opinion.
 *
 * `docs/validation.md` carried this row as a deliberate gap: "The correctness of every remediation that
 * needs an install (`pnpm install --lockfile-only`, `pnpm pkg set`) — following one would change a
 * repository; the commands were verified for shape, not for effect". The objection is right and the
 * consequence does not follow: the reason a step cannot be followed in *the* repository is that it
 * writes one, and a directory from `mkdtemp` is a repository it may write.
 *
 * So the probe follows the two shapes the catalogue prints today, and asserts the effect rather than the
 * exit: a command that exits `0` and writes nothing would be a green that measures nothing, and the
 * claim being closed is "the step does what its text says", never "pnpm is installed". Two things keep
 * it honest.
 *
 * The first is where the text comes from. S7: the probe imports the strings the catalogue emits, it does
 * not spell them again. `pnpm install --lockfile-only` is `LOCKFILE_ONLY_STEP` in
 * `src/lib/foreign-pin.js`, and the pin is the builder `src/rules/exact-versions.js` prints from, so a
 * change to either reaches this probe instead of leaving it measuring yesterday's command. The test
 * asserts the equality in both directions, which is why the builder was lifted out of the rule rather
 * than copied beside it.
 *
 * The second is what the probe asks for. S8 fixes the claim to effect, for the shapes the catalogue
 * emits today, and explicitly not to a resolution being correct: the resolved version is pnpm's business,
 * and this probe cannot see whether `1.3.0` is the right pin for anything. The pin's *value* is therefore
 * a local link, `file:./vendor`, which is exact, needs no registry and cannot make this measurement a
 * report on npm's uptime. The form — the bracketed property path, the `-C <dir>` prefix, the trailing
 * install — is the rule's own, unchanged.
 *
 * Every write happens inside the `mkdtemp` directory, which is removed before the process exits.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LOCKFILE_ONLY_STEP } from '../src/lib/foreign-pin.js';
import { pinCommand } from '../src/rules/exact-versions.js';

/** The file the resolve step is supposed to write. */
export const LOCKFILE = 'pnpm-lock.yaml';

/**
 * The pin the probe follows, in the shape the rule's builder takes.
 *
 * `file:./vendor` is an exact specifier, and the directory is written by this probe: pnpm links it
 * without a registry, so the whole chain runs offline. The value is a link and not a version for that
 * one reason — S8 measures the form, and a version would silently make this probe a check on the
 * network — never because a version is untestable.
 */
export const PROBE_PIN = Object.freeze({ type: 'devDependencies', dependency: 'local-pin', version: 'file:./vendor' });

/** The one file the pin's `install` segment needs, so the chain completes with no registry. */
const VENDOR_MANIFEST = '{\n  "name": "local-pin",\n  "version": "1.0.0"\n}\n';

/** The fixture's own manifest: nothing declared, so every effect after the run is the run's. */
const FIXTURE_MANIFEST = '{\n  "name": "remediation-probe",\n  "version": "1.0.0",\n  "private": true\n}\n';

/**
 * The resolve step the catalogue prints, imported and never copied (S7): the constant
 * `src/lib/foreign-pin.js` owns, which is the same one `start`, `migrate` and the pin path print.
 * @returns {string}
 */
export function lockfileCommand() {
  return LOCKFILE_ONLY_STEP;
}

/**
 * Judge the resolve step by the file it exists to write. A missing lockfile is a problem that names the
 * step, because "no pnpm-lock.yaml" without the command is a fact with no instruction in it.
 * @param {{ present: boolean }} observed
 * @returns {{ ok: boolean, problems: Array<string> }}
 */
export function judgeLockfile({ present }) {
  if (present) return { ok: true, problems: [] };
  return { ok: false, problems: [`no ${LOCKFILE} exists after ${lockfileCommand()}`] };
}

/**
 * Judge the pin step by the field it exists to set. The three ways it can fail are named apart — no
 * section, no entry, a different value — because "the manifest does not carry it" is the same sentence
 * for three different consequences, and the value found is what tells them apart.
 * @param {{ manifest: unknown, type: string, dependency: string, expected: string }} input
 * @returns {{ ok: boolean, problems: Array<string> }}
 */
export function judgeField({ manifest, type, dependency, expected }) {
  const section = manifest?.[type];
  if (section === null || typeof section !== 'object') {
    return { ok: false, problems: [`package.json carries no ${type}["${dependency}"] after the pkg set form`] };
  }

  const carried = section[dependency];
  if (carried === undefined) {
    return { ok: false, problems: [`${type} carries no ${dependency} after the pkg set form`] };
  }
  if (carried !== expected) {
    return {
      ok: false,
      problems: [`${type}["${dependency}"] carries ${JSON.stringify(carried)}, not ${JSON.stringify(expected)}`],
    };
  }

  return { ok: true, problems: [] };
}

/**
 * The shell the catalogue's text is written for.
 *
 * The printed command carries single quotes — `pnpm pkg set 'dependencies["left-pad"]=1.3.0'` — because
 * a shell strips them before pnpm reads the property path. Measured on pnpm 12.3.4 under `cmd.exe`, which
 * keeps them: pnpm answers ERR_PNPM_PKG_INVALID_PROPERTY_PATH, "Input ends without closing quote". The
 * text is therefore shell text, and the probe hands it to a shell instead of imitating one's quoting.
 * `sh` is what the runner that executes this probe carries; a machine without it is told so below,
 * because the alternative would be this script re-deriving an argv the catalogue never printed.
 */
const SHELL = 'sh';

/**
 * Run one printed command, in the directory it is meant to act on.
 * @param {string} command
 * @param {string} cwd
 */
function runCommand(command, cwd) {
  execFileSync(SHELL, ['-c', command], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * @param {string} dir
 * @returns {unknown}
 */
function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

/**
 * Follow both commands and judge what they left behind.
 *
 * The runner is a parameter, for the same reason `probe-permissions.js` takes its `fetchImpl`: the suite
 * asserts the judgement and the two commands without pnpm, an install or a network.
 *
 * @param {{ root: string, run?: (command: string, cwd: string) => void }} input
 * @returns {{ ok: boolean, problems: Array<string> }}
 */
export function probe({ root, run = runCommand }) {
  const problems = [];

  const lockfileDir = join(root, 'lockfile');
  mkdirSync(lockfileDir, { recursive: true });
  writeFileSync(join(lockfileDir, 'package.json'), FIXTURE_MANIFEST);
  run(lockfileCommand(), lockfileDir);
  problems.push(...judgeLockfile({ present: existsSync(join(lockfileDir, LOCKFILE)) }).problems);

  const pinDir = join(root, 'pin');
  mkdirSync(join(pinDir, 'vendor'), { recursive: true });
  writeFileSync(join(pinDir, 'vendor', 'package.json'), VENDOR_MANIFEST);
  writeFileSync(join(pinDir, 'package.json'), FIXTURE_MANIFEST);
  run(pinCommand(PROBE_PIN), pinDir);
  problems.push(
    ...judgeField({
      manifest: readManifest(pinDir),
      type: PROBE_PIN.type,
      dependency: PROBE_PIN.dependency,
      expected: PROBE_PIN.version,
    }).problems,
  );

  return { ok: problems.length === 0, problems };
}

/**
 * What a failed run says.
 *
 * A missing `sh` is not a failed command: the machine cannot run the catalogue's text at all, and saying
 * "a command did not complete" there sends the reader looking for a pnpm problem. The distinction is the
 * one `ENOENT` makes, and it is named.
 * @param {NodeJS.ErrnoException} error
 * @returns {string}
 */
function describe(error) {
  if (error?.code === 'ENOENT' && String(error.message).includes(`spawnSync ${SHELL}`)) {
    return `${SHELL} is not available, and the catalogue's commands are text for a POSIX shell: the single quotes are the shell's`;
  }
  return `a command did not complete: ${error.message}`;
}

function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'funky-secure-remediation-'));
  let result;
  try {
    result = probe({ root: scratch });
  } catch (error) {
    console.error(`probe-remediation: ${describe(error)}`);
    process.exitCode = 1;
    return;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (result.ok) {
    console.log(
      `probe-remediation: ${lockfileCommand()} wrote ${LOCKFILE}, and ${pinCommand(PROBE_PIN)} left ${PROBE_PIN.type}["${PROBE_PIN.dependency}"]=${PROBE_PIN.version}`,
    );
    return;
  }

  for (const problem of result.problems) {
    console.error(`probe-remediation: ${problem}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
