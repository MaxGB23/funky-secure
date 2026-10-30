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
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
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

const scratch = mkdtempSync(join(tmpdir(), 'funky-secure-pack-'));
try {
  const packed = npmRun(['pack', '--pack-destination', scratch], repo).trim().split('\n').pop();
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
