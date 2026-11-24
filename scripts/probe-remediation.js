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
 * report on npm's uptime. The form — the property path the name selects, the `-C <dir>` prefix, the
 * trailing install — is the rule's own, unchanged.
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
 *
 * A third thing keeps it honest, and it is the one R4-002 named on #552: a fixture the rule will not
 * spell is a failure, not a skip. `pinCommand` returns no command for a value outside its grammars, so a
 * rule change that refuses one of the fixtures below would have left this leg green with no pin executed
 * — the green that measures nothing this script was written to refuse. Such a fixture is a problem that
 * names it, because the probe exists to execute the printed spelling: a fixture it cannot print is a
 * measurement gap, and a gap is never a pass.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
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
export function resolveManifest(packageManager) {
  const manifest = {
    name: 'remediation-probe',
    version: '1.0.0',
    private: true,
    // The section the judgement reads, built from the same constant: a literal here and a constant there
    // diverge the first time one of them is edited, and the probe would then judge a section its own
    // fixture never wrote (native review of #278, R2-001).
    [PROBE_RESOLVE_PIN.type]: { [PROBE_RESOLVE_PIN.dependency]: PROBE_RESOLVE_PIN.version },
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
 * The shell the catalogue's text is written for: `cmd`, `bash` and `sh`, the three the pin is quoted
 * for (spec §8.2 R5, 0042). The text is shell text, so the probe hands it to a real shell in each
 * dialect instead of parsing it into an argv here: an argv this script built would measure its own
 * quoting, never the line a reader is told to paste.
 *
 * On Windows the text goes through `execSync(command)`, which spawns ComSpec as `/d /s /c`. It must NOT
 * go through `execFileSync('cmd', ['/c', command])`: measured, node re-quotes the argument it hands the
 * child and `/c` strips that quoting, so a command that works when pasted fails here with
 * `ERR_PNPM_PKG_INVALID_PROPERTY_PATH: Input ends without closing quote (")`. Do not "simplify" the
 * platform branch back to the argv form; it makes the Windows leg red on a command that works by hand.
 *
 * `sh` is what the POSIX runner that executes this probe carries; a machine without it is told so
 * below, because the alternative is this script re-deriving an argv the catalogue never printed.
 */
const SHELL = 'sh';

/**
 * Run one printed command, in the directory it is meant to act on.
 * @param {string} command
 * @param {string} cwd
 */
function runCommand(command, cwd) {
  const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  // ComSpec on Windows — the shell the defect this leg exists for belongs to — and `sh` everywhere else.
  if (process.platform === 'win32') {
    execSync(command, options);
    return;
  }
  execFileSync(SHELL, ['-c', command], options);
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
 * Whether a pin fixture produced a command, reporting the gap when it did not.
 *
 * The fixture was written so a printed pin could be followed and judged, so a fixture the rule refuses to
 * spell measured nothing: `ok` is not the answer for it, and neither is silence. The problem names the
 * fixture, the value it carries and why it is a problem, because a reader who learns only that "a pin was
 * refused" has to guess which one the rule stopped printing (S4, R4-002).
 *
 * @param {Array<string>} problems
 * @param {{ pin: object, command: string | null }} input
 * @returns {boolean} whether there is a command to run
 */
function requireCommand(problems, { pin, command }) {
  if (command !== null) return true;
  const where = pin.dir === undefined || pin.dir === '' ? 'the root importer' : pin.dir;
  problems.push(
    `the pin fixture for ${where} printed no command for ${pin.type}["${pin.dependency}"]=${pin.version}, so nothing was run for it: this probe exists to execute the printed spelling, and a fixture the rule cannot print is a measurement gap, not a pass`,
  );
  return false;
}

/**
 * Follow both commands and judge what they left behind.
 *
 * The runner is a parameter, for the same reason `probe-permissions.js` takes its `fetchImpl`: the suite
 * asserts the judgement and the two commands without pnpm, an install or a network.
 *
 * The fixtures are a parameter for a reason the runner cannot cover: both shipped ones are inside the
 * grammar the rule interpolates, so the refusal a rule change would produce — the branch below that
 * reports a gap instead of skipping it — is unreachable from them. A test drives it with a fixture the
 * rule must refuse, which is why the list is an argument and not a constant read here.
 *
 * @param {{ root: string, run?: (command: string, cwd: string) => void, pins?: Array<object> }} input
 * @returns {{ ok: boolean, problems: Array<string> }}
 */
export function probe({ root, run = runCommand, pins = [PROBE_PIN, PROBE_SCOPED_PIN] }) {
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

  // Both pin shapes, one directory each and in the order the catalogue prints them. The root form is run
  // in its manifest's own directory; the importer form carries the `-C <dir>` prefix and must leave its
  // effect in *that* directory, which is why the two are not interchangeable. The fixture list is the
  // argument above, so a value the rule refuses can be driven from the suite.
  for (const [index, pin] of pins.entries()) {
    // The rule answers before this loop writes anything: a fixture it refuses has no directory to prepare,
    // and preparing one would be a write the refusal never asked for (R3-003).
    const command = pinCommand(pin);
    if (!requireCommand(problems, { pin, command })) continue;

    const base = join(root, `pin-${index + 1}`);
    const target = pin.dir === undefined || pin.dir === '' ? base : join(base, pin.dir);
    // The directory grammar admits `..`, so a fixture can name a parent — and a probe that writes there
    // writes outside the tree it audits. Such a fixture is reported rather than prepared.
    const between = relative(base, target);
    if (between.startsWith('..') || isAbsolute(between)) {
      problems.push(
        `the pin fixture for ${pin.dir} resolves outside its own scratch directory, so nothing was prepared for it: this probe never writes outside the directory it owns`,
      );
      continue;
    }

    writeVendor(target);
    writeFileSync(join(target, 'package.json'), FIXTURE_MANIFEST);
    // The directory above the importer is a repository too, so `pnpm -C <dir>` has a workspace to stand in.
    if (target !== base) writeFileSync(join(base, 'package.json'), FIXTURE_MANIFEST);

    run(command, base);
    problems.push(
      ...judgeField({
        manifest: readManifest(target),
        type: pin.type,
        dependency: pin.dependency,
        expected: pin.version,
      }).problems,
    );
  }

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
    return `${SHELL} is not available, and the catalogue's commands are text for cmd, bash or sh: this machine carries no shell that reads them`;
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
    // Built from the commands the rule actually prints. Neither can be absent here: `probe()` reports a
    // fixture the rule refuses to print as a problem, so an `ok` result is one where both pins ran (S4).
    const pins = [PROBE_PIN, PROBE_SCOPED_PIN]
      .map((pin) => ({ pin, command: pinCommand(pin) }))
      .map(({ command, pin }) =>
        pin.dir === undefined
          ? `${command} left ${pin.type}["${pin.dependency}"]=${pin.version}`
          : `${command} left the same in ${pin.dir}`,
      )
      .join(', and ');
    console.log(
      `probe-remediation: ${lockfileCommand()} and its ${FOREIGN_PIN_FLAG} form each recorded ${PROBE_RESOLVE_PIN.dependency}, ${pins}`,
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
