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
 * So the probe follows four of the shapes the catalogue prints today, and asserts the effect rather than the
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
 * The resolve step is judged by the row it writes, not by the file it names. A fixture that declared no
 * dependency produced a `pnpm-lock.yaml` whose root importer recorded nothing (`.: {}`), and a judgement
 * that asked whether the file existed called that a pass; the fixture now declares one link and the
 * judgement reads `importers["."].dependencies` through the reader the rules already parse a lockfile
 * with, so the probe and the report cannot disagree about what an importer records. Its second shape is
 * the one the catalogue prints for a repository declaring a foreign `packageManager`
 * (`src/lib/foreign-pin.js`), which is the step a user migrating off npm follows.
 *
 * Every write happens inside the `mkdtemp` directory, which is removed before the process exits.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { FOREIGN_PIN_FLAG, resolveLockfileStep } from '../src/lib/foreign-pin.js';
import { parseLockfile, recordedVersion } from '../src/lib/lockfile.js';
import { pinCommand } from '../src/rules/exact-versions.js';

/** The file the resolve step is supposed to write. */
export const LOCKFILE = 'pnpm-lock.yaml';

/** The importer key `pnpm-lock.yaml` gives the repository root. */
const ROOT_IMPORTER = '.';

/**
 * The pin the probe follows, in the shape the rule's builder takes.
 *
 * `file:./vendor` is an exact specifier, and the directory is written by this probe: pnpm links it
 * without a registry, so the whole chain runs offline. The value is a link and not a version for that
 * one reason — S8 measures the form, and a version would silently make this probe a check on the
 * network — never because a version is untestable.
 */
export const PROBE_PIN = Object.freeze({ type: 'devDependencies', dependency: 'local-pin', version: 'file:./vendor' });

/**
 * The dependency the resolve fixtures declare.
 *
 * The claim is "the resolve step records what it resolved", and a manifest with nothing declared gives
 * the lockfile nothing to record: the document holds `lockfileVersion` and no importer, so the only
 * question left is whether a file exists. `file:./vendor` is exact and offline, for the same reason the
 * pin's value is a link.
 */
export const PROBE_RESOLVE_PIN = Object.freeze({
  type: 'dependencies',
  dependency: 'local-pin',
  version: 'file:./vendor',
});

/**
 * The foreign declaration the second resolve fixture carries.
 *
 * `npm@11.13.0` is the version `docs/validation.md` measured the flag against, so the fixture exercises
 * the declaration the evidence names rather than a range pnpm might answer differently.
 */
export const FOREIGN_PACKAGE_MANAGER = 'npm@11.13.0';

/**
 * The importer form: a workspace finding is pinned in *that* manifest, with the `-C <dir>` prefix the
 * catalogue prints. A probe that only ran the root form would leave this path measured as text and not
 * as effect, which is the gap a reviewer named on the first version of this file.
 */
export const PROBE_SCOPED_PIN = Object.freeze({
  type: 'dependencies',
  dependency: '@probe/pin',
  version: 'file:./vendor',
  dir: 'packages/api',
});

/** The one file the pin's `install` segment needs, so the chain completes with no registry. */
const VENDOR_MANIFEST = '{\n  "name": "local-pin",\n  "version": "1.0.0"\n}\n';

/** The fixture's own manifest for the pin cases: nothing declared, so every effect after the run is the run's. */
const FIXTURE_MANIFEST = '{\n  "name": "remediation-probe",\n  "version": "1.0.0",\n  "private": true\n}\n';

/**
 * The resolve fixtures' manifest: one declared link, so the lockfile has a row to record, and the
 * declaration the shape under test is asked about, when there is one.
 * @param {string} [packageManager]
 * @returns {string}
 */
function resolveManifest(packageManager) {
  const manifest = {
    name: 'remediation-probe',
    version: '1.0.0',
    private: true,
    dependencies: { [PROBE_RESOLVE_PIN.dependency]: PROBE_RESOLVE_PIN.version },
  };
  if (packageManager !== undefined) manifest.packageManager = packageManager;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The reader's context for a manifest this probe wrote, carrying only the field `declaredPackageManager`
 * reads. The step is therefore asked for from the declaration the fixture exercises, never from a second
 * copy of the condition.
 * @param {string} text
 * @returns {object}
 */
function manifestContext(text) {
  return { files: { packageJson: { json: JSON.parse(text) } } };
}

/**
 * The resolve step the catalogue prints, imported and never copied (S7): `resolveLockfileStep` is the
 * builder `start`, `migrate`, the pin path and the writers print from, so the flag that appears for a
 * repository declaring a foreign `packageManager` reaches this probe instead of being remembered here.
 * @param {object | null} [repo] the reader's context for the manifest the step will act on
 * @returns {string}
 */
export function lockfileCommand(repo = null) {
  return resolveLockfileStep(repo);
}

/**
 * Judge the resolve step by the row it exists to write: `importers["."]` naming the dependency with a
 * version beside it.
 *
 * The file appearing is not the claim. pnpm writes a lockfile for a manifest with nothing declared, so
 * "a lockfile exists" passes on a document that resolved nothing — measured, not feared: the fixture that
 * declared no dependency produced a `pnpm-lock.yaml` whose root importer is `.: {}`, and the first
 * version of this probe called that a pass. The three ways the row can be missing are named apart — no
 * file, a file this reader refuses, a file with no record — because they send the reader to three
 * different places.
 *
 * @param {{ text: string | null, command: string, dependency: string }} input
 * @returns {{ ok: boolean, problems: Array<string> }}
 */
export function judgeLockfile({ text, command, dependency }) {
  if (typeof text !== 'string') {
    return { ok: false, problems: [`no ${LOCKFILE} exists after ${command}`] };
  }

  const lock = parseLockfile(text);
  if (!lock.supported) {
    return {
      ok: false,
      problems: [`${LOCKFILE} is not a shape this reader can judge after ${command}: ${lock.detail}`],
    };
  }

  const recorded = recordedVersion(lock.importers?.[ROOT_IMPORTER], dependency, PROBE_RESOLVE_PIN.type);
  if (recorded === null) {
    return {
      ok: false,
      problems: [
        `${LOCKFILE} records no ${PROBE_RESOLVE_PIN.type}["${dependency}"] with a version after ${command}`,
      ],
    };
  }

  return { ok: true, problems: [] };
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
 * The lockfile's text, or `null` when the step wrote nothing: the two are different failures, and the
 * judge names them apart.
 * @param {string} path
 * @returns {string | null}
 */
function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** The directory holding the fixture the pin's `install` segment reads, so the chain needs no registry. */
function writeVendor(dir) {
  mkdirSync(join(dir, 'vendor'), { recursive: true });
  writeFileSync(join(dir, 'vendor', 'package.json'), VENDOR_MANIFEST);
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

  // Two resolve shapes, because the catalogue prints two: the bare step for a repository that declares no
  // foreign manager, and the one carrying the flag for a repository that does. The second is the path a
  // user migrating off npm follows (0018), so it is measured here rather than assumed from the constant.
  const resolveCases = [
    { dir: 'lockfile', manifest: resolveManifest() },
    { dir: 'foreign-lockfile', manifest: resolveManifest(FOREIGN_PACKAGE_MANAGER) },
  ];

  for (const { dir, manifest } of resolveCases) {
    const target = join(root, dir);
    writeVendor(target);
    writeFileSync(join(target, 'package.json'), manifest);
    const command = lockfileCommand(manifestContext(manifest));
    run(command, target);
    problems.push(
      ...judgeLockfile({
        text: readIfPresent(join(target, LOCKFILE)),
        command,
        dependency: PROBE_RESOLVE_PIN.dependency,
      }).problems,
    );
  }

  const pinDir = join(root, 'pin');
  writeVendor(pinDir);
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

  const workspace = join(root, 'workspace');
  const importerDir = join(workspace, PROBE_SCOPED_PIN.dir);
  writeVendor(importerDir);
  writeFileSync(join(importerDir, 'package.json'), FIXTURE_MANIFEST);
  writeFileSync(join(workspace, 'package.json'), FIXTURE_MANIFEST);
  run(pinCommand(PROBE_SCOPED_PIN), workspace);
  problems.push(
    ...judgeField({
      manifest: readManifest(importerDir),
      type: PROBE_SCOPED_PIN.type,
      dependency: PROBE_SCOPED_PIN.dependency,
      expected: PROBE_SCOPED_PIN.version,
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
      `probe-remediation: ${lockfileCommand()} and its ${FOREIGN_PIN_FLAG} form each recorded ${PROBE_RESOLVE_PIN.dependency}, ${pinCommand(PROBE_PIN)} left ${PROBE_PIN.type}["${PROBE_PIN.dependency}"]=${PROBE_PIN.version}, and ${pinCommand(PROBE_SCOPED_PIN)} left the same in ${PROBE_SCOPED_PIN.dir}`,
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
