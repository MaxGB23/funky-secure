#!/usr/bin/env node
/**
 * Golden report generator (RFC 15.2).
 *
 * One JSON report per fixture repository, rendered by the same `renderJson` the product uses and
 * reviewed as a diff. A golden is never hand-edited: it is regenerated here, and `tests/drift.test.js`
 * imports `FIXTURES`, `goldenPath` and `renderGolden` from this module so the gate and the generator
 * cannot disagree about what a golden is.
 *
 * The collector is deterministic by construction (RFC 15.2, 15.4): it reads files from the fixture,
 * answers the git probes from the fixture's own bytes, and reports no pnpm version at all, so no
 * machine fact — no clock, no network, no spawn, no absolute path — can leak into a golden.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderJson } from '../src/lib/render-json.js';
import { collectScan } from '../src/lib/scan.js';
import { catalog } from '../src/rules/index.js';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const GOLDEN_DIR = join(ROOT, 'tests', 'golden');

const INIT_FIXTURES = join(ROOT, 'tests', 'fixtures', 'init');
const GOLDEN_FIXTURES = join(GOLDEN_DIR, 'fixtures');

/**
 * The declared fixture list: three pre-existing `init` repositories (never modified) plus two
 * created for the golden gate. A fixture's golden is `tests/golden/<name>.json`.
 */
export const FIXTURES = Object.freeze([
  { name: 'at-policy', dir: join(INIT_FIXTURES, 'at-policy') },
  { name: 'below-policy', dir: join(INIT_FIXTURES, 'below-policy') },
  { name: 'pinned-conflict', dir: join(INIT_FIXTURES, 'pinned-conflict') },
  { name: 'dirty', dir: join(GOLDEN_FIXTURES, 'dirty') },
  { name: 'clean', dir: join(GOLDEN_FIXTURES, 'clean') },
]);

/** @param {string} name @returns {string} absolute path of that fixture's golden report */
export function goldenPath(name) {
  return join(GOLDEN_DIR, `${name}.json`);
}

/**
 * The `.gitignore` patterns of a fixture, in file order.
 * @param {string} dir
 * @returns {string[]}
 */
function gitignorePatterns(dir) {
  let text;
  try {
    text = readFileSync(join(dir, '.gitignore'), 'utf8');
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** @param {string} body a glob body without its leading `!` */
function globRegex(body) {
  const escaped = body
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

/**
 * The answer `git check-ignore --no-index --stdin -z` gives for one candidate path, resolved from
 * the fixture's own `.gitignore` with negations applied in order. A pattern without a `/` matches
 * the basename at any depth, as git does.
 * @param {string[]} patterns
 * @param {string} path repo-relative, POSIX separators
 * @returns {boolean}
 */
function isIgnored(patterns, path) {
  let ignored = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    const body = (negated ? pattern.slice(1) : pattern).replace(/\/+$/, '');
    if (body === '') continue;
    const target = body.includes('/') ? path : path.slice(path.lastIndexOf('/') + 1);
    if (globRegex(body).test(target)) ignored = !negated;
  }
  return ignored;
}

/**
 * The deterministic collector one golden uses (RFC 15.2).
 *
 * - file reads come from the fixture directory;
 * - `rev-parse --show-toplevel` is the fixture itself and `HEAD` is `main`;
 * - `ls-files` is the fixture's `tracked.txt`, one path per line (an absent file means no tracked
 *   paths);
 * - `check-ignore` matches the fixture's own `.gitignore` patterns;
 * - `status` reports a clean tree;
 * - pnpm answers what the fixture declares in an optional `machine.json` (`{ "version": "12.3.4",
 *   "config": {…} }`); without that file it answers nothing (`no-pnpm`). The declared machine is
 *   the only way a machine-scoped fact enters a golden, and it is a fixture, not this computer.
 *
 * @param {{ dir: string }} options
 * @returns {object} a collector of the shape `createCollector` returns
 */
export function buildFixtureCollector({ dir }) {
  const root = resolve(dir);
  const ok = (stdout) => ({ ok: true, code: 0, stdout, stderr: '' });

  const tracked = () => {
    try {
      return readFileSync(join(root, 'tracked.txt'), 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');
    } catch {
      return [];
    }
  };

  const machine = () => {
    try {
      return JSON.parse(readFileSync(join(root, 'machine.json'), 'utf8'));
    } catch {
      return null;
    }
  };

  return {
    read: async (path) => {
      try {
        return { ok: true, value: await readFile(path, 'utf8') };
      } catch (error) {
        return { ok: false, error };
      }
    },
    git: async (args, options = {}) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return ok(`${root}\n`);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return ok('main\n');
      if (args[0] === 'ls-files') return ok(tracked().map((path) => `${path}\0`).join(''));
      if (args[0] === 'check-ignore') {
        const patterns = gitignorePatterns(root);
        const candidates = String(options.input ?? '')
          .split('\0')
          .filter((path) => path !== '');
        return ok(
          candidates
            .filter((path) => isIgnored(patterns, path))
            .map((path) => `${path}\0`)
            .join(''),
        );
      }
      if (args[0] === 'status') return ok('');
      return { ok: true, code: 1, stdout: '', stderr: '' };
    },
    pnpmVersion: async () => {
      const declared = machine();
      if (declared === null || typeof declared.version !== 'string') {
        return { ok: false, reason: 'no-pnpm' };
      }
      const major = Number(declared.version.split('.')[0]);
      return { ok: true, version: declared.version, major, executable: 'pnpm', installations: [] };
    },
    pnpmConfig: async () => {
      const declared = machine();
      if (declared === null || declared.config === undefined) {
        return { ok: false, reason: 'no-pnpm' };
      }
      return { ok: true, config: declared.config };
    },
  };
}

/**
 * A golden may not carry an absolute path (RFC 10.1): the fixture directory would be one.
 * @param {string} text
 * @param {string} dir
 */
function assertNoAbsolutePath(text, dir) {
  const forms = [dir, dir.replaceAll('\\', '/'), dir.replaceAll('\\', '\\\\')];
  for (const form of forms) {
    if (text.includes(form)) {
      throw new Error(`the report leaks the absolute fixture path ${form}`);
    }
  }
}

/**
 * Regenerates one fixture's report, in memory, exactly as the golden on disk should read.
 * @param {{ name: string, dir: string }} fixture
 * @returns {Promise<string>} the rendered JSON document
 */
export async function renderGolden(fixture) {
  if (!existsSync(fixture.dir)) {
    throw new Error(`fixture directory does not exist: ${fixture.dir}`);
  }

  const { report } = await collectScan({
    cwd: fixture.dir,
    env: {},
    scope: 'all',
    catalog,
    collector: buildFixtureCollector({ dir: fixture.dir }),
  });

  const text = renderJson(report);
  assertNoAbsolutePath(text, resolve(fixture.dir));
  return text;
}

/** Writes every golden and prints what it wrote; returns the process exit code. */
export async function main() {
  mkdirSync(GOLDEN_DIR, { recursive: true });

  for (const fixture of FIXTURES) {
    let text;
    try {
      text = await renderGolden(fixture);
    } catch (error) {
      console.error(`gen-golden: cannot read fixture "${fixture.name}": ${error.message}`);
      return 1;
    }

    const path = goldenPath(fixture.name);
    writeFileSync(path, text, 'utf8');
    const report = JSON.parse(text);
    const findings = report.findings.length;
    console.log(
      `wrote ${relative(ROOT, path).replaceAll('\\', '/')}  ·  ${findings} finding${findings === 1 ? '' : 's'}  ·  verdict ${report.summary.verdict}`,
    );
  }

  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = await main();
}
