/**
 * The mechanical half of RFC 17: the tag names the version, the tarball carries exactly the files the
 * contract names, and every page the rule catalog promises a reader survives packing. Nothing here
 * decides that a release ships; it decides whether the tag that was pushed may produce one.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { catalog } from '../src/rules/index.js';

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
 * A `files` entry as npm reads it: `./README.md` (root-anchored) and a Windows separator both name the
 * packed path `README.md`. The anchor matters — an unanchored `README.md` is a basename glob to npm,
 * and it packs every `README.md` in the tree, measured with npm 11.15.0 against this repository.
 * @param {string} entry
 * @returns {string}
 */
function normalizeEntry(entry) {
  const path = String(entry).split('\\').join('/');
  return path.startsWith('./') ? path.slice(2) : path;
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
      allowed.some((raw) => {
        const entry = normalizeEntry(raw);
        return entry.endsWith('/') ? path.startsWith(entry) : path === entry;
      });

    if (!permitted) problems.push(`${path} must not ship: it is not in the files contract`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Every page the catalog promises a reader must survive packing (layout 14.1, S5). `checkPackList`
 * compares the packed set against `files`, so on its own it follows a narrowing of `files` silently: a
 * page left behind is permitted by both sides of that comparison. The catalog is the third opinion.
 *
 * @param {Array<string>} files relative paths listed by `npm pack --dry-run --json`
 * @param {Array<object>} [rules] the catalog; injected so a test does not depend on its current size
 * @returns {{ ok: boolean, problems: Array<string> }}
 */
export function checkRuleDocs(files, rules = catalog) {
  const packed = new Set(files.map((file) => String(file).split('\\').join('/')));
  const problems = [];

  for (const rule of rules) {
    const page = rule.docs;
    if (typeof page !== 'string' || page === '') continue;
    if (!packed.has(page)) {
      problems.push(`${page} must ship: rule ${rule.id} declares it, and the packed file list has no such page`);
    }
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

  const files = pack();
  const packCheck = checkPackList(files, manifest.files);
  problems.push(...packCheck.problems);
  checked.push(`${(manifest.files ?? []).length} entries of the files contract`);

  const docsCheck = checkRuleDocs(files);
  problems.push(...docsCheck.problems);
  const pages = catalog.filter((rule) => typeof rule.docs === 'string').length;
  checked.push(`${pages} rule pages declared by the catalog`);

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
