#!/usr/bin/env node
/**
 * The package smoke test: pack what would be published, install it the way a user does, and run it.
 *
 * `files` in package.json decides what survives packing, and every mistake there fails at the same
 * place: the package installs and does not start. Nothing in the suite can see that, because the suite
 * runs from the repository, where every path exists. So the check packs the tarball, installs it into
 * a directory that contains nothing else, and asks the installed binary for its version and a report.
 *
 * It runs from `prepublishOnly`, and by hand as `node scripts/pack-smoke.js`. It uses no network: the
 * package has no dependencies, so the install only links the tarball's own files.
 *
 * The tarball name is read from `npm pack --json`, never from its human output: a lifecycle script
 * inherits the npm configuration of the command that invoked it, so the output shape is not this
 * script's to assume.
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** @param {string} message */
function fail(message) {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}

/**
 * npm as a single shell command. Node refuses to spawn a `.cmd` without a shell on Windows, and a
 * single string is the one form whose quoting stays correct on both platforms.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
function npmRun(args, cwd) {
  return execSync([npm, ...args].join(' '), {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The tarball name `npm pack --json` reports. The array is one entry per packed package, and the smoke
 * test packs exactly one, so the first entry is the tarball. Asking for the name instead of reading it
 * off the end of the human output is what keeps the gate independent of the ambient npm config: with
 * `npm_config_json=true` the human output is a JSON array, and its last line is `]`.
 * @param {string} stdout the stdout of `npm pack --pack-destination <dir> --json`
 * @returns {string}
 */
export function packedFilename(stdout) {
  let packed;
  try {
    packed = JSON.parse(stdout);
  } catch {
    throw new Error(`npm pack did not answer with JSON: ${String(stdout).trim().split('\n')[0] || 'no output'}`);
  }
  if (!Array.isArray(packed)) throw new Error('npm pack answered with JSON that is not an array of packed entries');
  if (packed.length === 0) throw new Error('npm pack answered with an empty array: nothing was packed');

  const filename = packed[0]?.filename;
  if (typeof filename !== 'string' || filename === '') {
    throw new Error('npm pack answered with a packed entry that carries no filename');
  }
  return filename;
}

function main() {
  const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const scratch = mkdtempSync(join(tmpdir(), 'funky-secure-pack-'));
  try {
    let packed;
    try {
      packed = packedFilename(npmRun(['pack', '--pack-destination', scratch, '--json'], repo));
    } catch (error) {
      fail(error.message);
    }
    const tarball = join(scratch, packed);

    const consumer = join(scratch, 'consumer');
    mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), '{ "name": "consumer", "version": "1.0.0", "private": true }\n');
    npmRun(['install', tarball, '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel', 'error'], consumer);

    const binary = join(consumer, 'node_modules', 'funky-secure', 'bin', 'funky-secure.js');
    const reported = execFileSync(process.execPath, [binary, '--version'], { encoding: 'utf8' }).trim();
    if (reported !== version) fail(`the installed binary reports "${reported}", package.json says "${version}"`);

    // A directory the package never wrote: the scan has to answer from the tarball alone.
    writeFileSync(join(consumer, 'package.json'), '{ "name": "consumer", "version": "1.0.0" }\n');
    let stdout = '';
    let status = 0;
    try {
      stdout = execFileSync(process.execPath, [binary, 'scan', '--scope', 'repo', '--format', 'json'], {
        cwd: consumer,
        encoding: 'utf8',
      });
    } catch (error) {
      status = error.status ?? 1;
      stdout = String(error.stdout ?? '');
    }
    if (status !== 0 && status !== 1) fail(`the installed scan exited ${status}, which is neither a pass nor a violation`);

    const report = JSON.parse(stdout);
    if (report.tool.version !== version) fail(`the report carries version "${report.tool.version}"`);

    process.stdout.write(`✓ ${packed}: ${version} installs and reports ${report.summary.verdict}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
