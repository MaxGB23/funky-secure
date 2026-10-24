/**
 * The mechanical half of RFC 17: the tag names the version, and the tarball carries exactly the files
 * the contract names. Nothing here decides that a release ships; it decides whether the tag that was
 * pushed may produce one.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..');
const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ALWAYS_PACKED = 'package.json';

/**
 * @param {string} tag the `vX.Y.Z` tag that was pushed
 * @param {string} version `package.json` `version`
 * @returns {{ ok: boolean, problems: Array<string> }}
 */
export function checkTag(tag, version) {
  const problems = [];

  if (typeof tag !== 'string' || !TAG.test(tag)) {
    problems.push(`"${tag ?? ''}" is not vX.Y.Z`);
  } else if (tag.slice(1) !== version) {
    problems.push(`${tag} does not name version ${version}`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * @param {Array<string>} files relative paths listed by `npm pack --dry-run --json`
 * @param {Array<string>} allowed the `files` entries of `package.json`
 * @returns {{ ok: boolean, problems: Array<string> }}
 */
export function checkPackList(files, allowed) {
  const problems = [];

  for (const file of files) {
    const path = String(file).split('\\').join('/');
    const permitted =
      path === ALWAYS_PACKED ||
      allowed.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));

    if (!permitted) problems.push(`${path} must not ship: it is not in the files contract`);
  }

  return { ok: problems.length === 0, problems };
}

/** The file list npm would pack, read without publishing anything. */
function packedFiles() {
  // A `.cmd` shim is not executable through `shell: false` on Windows (E7), and `shell: true` earns a
  // DEP0190 warning, so npm's own CLI entry point is run by this very interpreter instead.
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((value) => typeof value === 'string' && existsSync(value));

  const invocation =
    candidates.length > 0
      ? { file: process.execPath, args: [candidates[0], 'pack', '--dry-run', '--json'], options: {} }
      : { file: 'npm', args: ['pack', '--dry-run', '--json'], options: { shell: process.platform === 'win32' } };

  const result = spawnSync(invocation.file, invocation.args, { cwd: ROOT, encoding: 'utf8', ...invocation.options });

  if (result.error !== undefined || result.status !== 0) {
    const detail = result.error?.message ?? (result.stderr ?? '').trim();
    throw new Error(`npm pack --dry-run failed: ${detail === '' ? 'no output' : detail}`);
  }

  const parsed = JSON.parse(result.stdout);
  return parsed[0].files.map((entry) => entry.path);
}

/**
 * @param {{ tag?: string|null, root?: string, pack?: () => Array<string> }} [options]
 * @returns {{ ok: boolean, problems: Array<string>, checked: Array<string> }}
 */
export function run({ tag = null, root = ROOT, pack = packedFiles } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const problems = [];
  const checked = [];

  if (tag === null) {
    checked.push('no tag supplied: this is a dry run, not a release');
  } else {
    const tagCheck = checkTag(tag, manifest.version);
    problems.push(...tagCheck.problems);
    checked.push(`tag ${tag} against version ${manifest.version}`);
  }

  const packCheck = checkPackList(pack(), manifest.files);
  problems.push(...packCheck.problems);
  checked.push(`${(manifest.files ?? []).length} entries of the files contract`);

  return { ok: problems.length === 0, problems, checked };
}

function main(argv) {
  const index = argv.indexOf('--tag');
  const tag = index === -1 ? null : (argv[index + 1] ?? '');

  let result;
  try {
    result = run({ tag });
  } catch (error) {
    process.stderr.write(`release-guard: ${error.message}\n`);
    return 1;
  }

  for (const line of result.checked) process.stdout.write(`release-guard: ${line}\n`);
  if (!result.ok) {
    for (const problem of result.problems) process.stderr.write(`release-guard: ${problem}\n`);
    return 1;
  }

  process.stdout.write('release-guard: the tag and the packed files agree with the contract\n');
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
