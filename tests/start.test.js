import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../src/cli.js';
import { ADD_MESSAGE, START_AGAIN_STEP } from '../src/commands/start.js';

/**
 * `start` (record 0003, 11.7): the ordered path from an empty directory to a first scan. One test per
 * state of that path, over real temporary directories and an injected collector, so no git and no
 * pnpm is ever spawned and nothing touches the network.
 */

const INIT_FIXTURES = join(import.meta.dirname, 'fixtures', 'init');

/** @param {import('node:test').TestContext} t */
function scratch(t, fixture = null) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-start-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (fixture !== null) cpSync(join(INIT_FIXTURES, fixture), dir, { recursive: true });
  return dir;
}

function patternMatches(pattern, path) {
  const body = pattern.replace(/\/+$/, '');
  if (body === '') return false;
  const target = body.includes('/') ? path : path.slice(path.lastIndexOf('/') + 1);
  const regex = new RegExp(
    `^${body
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')}$`,
  );
  return regex.test(target);
}

/** The answer `git check-ignore --no-index --stdin -z` gives, resolved from the repository's bytes. */
function ignoredFromGitignore(root, input) {
  let patterns = [];
  try {
    patterns = readFileSync(join(root, '.gitignore'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
  } catch {
    patterns = [];
  }

  const ignored = [];
  for (const candidate of String(input ?? '').split('\0').filter((path) => path !== '')) {
    let here = false;
    for (const pattern of patterns) {
      const negated = pattern.startsWith('!');
      if (patternMatches(negated ? pattern.slice(1) : pattern, candidate)) here = !negated;
    }
    if (here) ignored.push(candidate);
  }
  return ignored.map((path) => `${path}\0`).join('');
}

/**
 * A collector for every probe: reads files from disk, answers git from `inGit`, resolves ignore
 * questions from the repository's own `.gitignore`, and answers the pnpm version only when the test
 * asks for one — a repository whose pin can be written is the only state that needs it.
 * @param {{ dir: string, inGit?: boolean, version?: string | null }} options
 */
function fakeCollector({ dir, inGit = true, version = null }) {
  const root = realpathSync(dir);
  const ok = (stdout) => ({ ok: true, code: 0, stdout, stderr: '' });
  const refuse = { ok: true, code: 1, stdout: '', stderr: '' };

  let tracked = [];
  try {
    tracked = readFileSync(join(root, 'tracked.txt'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch {
    tracked = [];
  }

  return {
    read: async (path) => {
      try {
        return { ok: true, value: await readFile(path, 'utf8') };
      } catch (error) {
        return { ok: false, error };
      }
    },
    git: async (args, options = {}) => {
      if (!inGit) return refuse;
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return ok(`${root}\n`);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return ok('main\n');
      if (args[0] === 'ls-files') return ok(tracked.map((path) => `${path}\0`).join(''));
      if (args[0] === 'check-ignore') return ok(ignoredFromGitignore(root, options.input));
      if (args[0] === 'status') {
        // The working-tree state is the fixture's own: the double answers what real git would answer
        // for the files the test placed, because a hard-coded "clean" would hide the case where the
        // block cannot be written over the tree.
        try {
          const stdout = execFileSync('git', args, { cwd: root, encoding: 'utf8' });
          return ok(stdout);
        } catch {
          return refuse;
        }
      }
      return refuse;
    },
    pnpmVersion: async () =>
      version === null
        ? { ok: false, reason: 'not-on-path', installations: [] }
        : {
            ok: true,
            version,
            major: Number(version.split('.')[0]),
            executable: '/tools/pnpm',
            installations: ['/tools/pnpm'],
          },
    pnpmConfig: async () => ({ ok: false, reason: 'not-on-path' }),
  };
}

function capture() {
  return {
    text: '',
    write(chunk) {
      this.text += chunk;
      return true;
    },
    isTTY: false,
  };
}

/** Runs the real CLI over one directory, with every probe injected. */
async function start(dir, { inGit = true, version = null, argv = ['start'] } = {}) {
  const streams = {
    cwd: dir,
    env: {},
    stdout: capture(),
    stderr: capture(),
    collector: fakeCollector({ dir, inGit, version }),
  };
  const code = await run(argv, streams);
  return { code, stdout: streams.stdout.text, stderr: streams.stderr.text };
}

/** The numbered step lines of one rendering, in the order printed. */
function stepLines(text) {
  return text.split('\n').filter((line) => /^ {2}\d+ {2}\S/.test(line));
}

/** The indented lines of the `why this order` block, and nothing after it. */
function whyBlock(text) {
  const lines = text.split('\n');
  const at = lines.indexOf('why this order');
  if (at === -1) return [];

  const block = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.startsWith('  ') || line.trim() === '') break;
    block.push(line);
  }
  return block;
}

/** The printed step numbers, in order: the numbering has to be continuous, with no gaps. */
function stepNumbers(text) {
  return stepLines(text).map((line) => Number(line.trim().split(/\s+/)[0]));
}

/**
 * A repository shaped like the one a framework generator leaves behind (record 0003, L10): a manifest
 * carrying ranges, an app directory, a `.gitignore`, and the lockfile of the manager that generated
 * it. Nothing else — no managed block, no workspace file, no commit of the ignore rules.
 *
 * @param {string} dir
 * @param {{ lockfile: string, ranges?: boolean, committed?: boolean }} options the lockfile the
 *   generating manager wrote, and whether the manifest it wrote carries ranges
 */
function generatedBy(dir, { lockfile, ranges = true, committed = true }) {
  writeManifest(dir, ranges);
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.next\n');
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app', 'page.jsx'), 'export default function Page() {\n  return null;\n}\n');
  writeFileSync(join(dir, lockfile), '');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  if (committed) commitAll(dir, 'generated');
}

/**
 * The manifest a framework generator writes, with the ranges it leaves behind — or the exact versions
 * a repository that already pinned its ranges carries.
 *
 * @param {string} dir
 * @param {boolean} ranges
 */
function writeManifest(dir, ranges) {
  const carets = { next: '^15.5.4', react: '^19.2.0', 'react-dom': '^19.2.0' };
  const exact = { next: '15.5.4', react: '19.2.0', 'react-dom': '19.2.0' };
  const manifest = { name: 'app', private: true, dependencies: ranges ? carets : exact };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Records the working tree, so the next writer lands on a clean one. @param {string} dir */
function commitAll(dir, message) {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync(
    'git',
    ['-c', 'user.email=82458865+MaxGB23@users.noreply.github.com', '-c', 'user.name=MaxGB23', 'commit', '-qm', message],
    { cwd: dir },
  );
}

const SCAN_STEP = 'funky-secure scan --preset starter';
// The branch the plan names, so a reader never has to invent one: `migrate --apply` refuses on the
// default branch, and a step that requires a state has to print how to reach it (0018).
const FEATURE_BRANCH = 'chore/supply-chain-bootstrap';
const BASELINE_COMMIT = 'chore: baseline before funky-secure';
const APPLY_COMMIT = 'chore: apply funky-secure';
const PIN_COMMIT = 'chore: pin the ranges';
const TRACK_COMMIT = 'chore: track the lockfile';
const ADD_STEP = 'pnpm add <your first dependency>';
const ADD_COMMIT_STEP = `git add package.json && git commit -m "${ADD_MESSAGE}"`;

test('a directory that is not a repository stops at the step that asks again', async (t) => {
  const dir = scratch(t);
  const { code, stdout } = await start(dir, { inGit: false });

  assert.equal(code, 0, 'start is guidance: it exits 0 when nothing is in place');
  // No plan, no counts, no commit: R7 declares `outside git, skip`, so W2 is not planned until a
  // repository exists and the dirty-tree question has no git to answer it (0031).
  assert.deepEqual(stepLines(stdout), [
    '  1  git init',
    '  2  pnpm init',
    `  3  ${START_AGAIN_STEP}`,
  ]);
  assert.equal(stdout.includes('init --apply'), false, 'no write plan is asserted from a directory');
  assert.equal(stdout.includes('writes'), false, 'no count is printed that the next run contradicts');
  assert.equal(stdout.includes('git commit'), false, 'no commit step is printed without a plan');
  assert.equal(stdout.includes('scan'), false, 'the first run does not prescribe the last step');
  assert.equal(stdout.includes(dir), false, 'no absolute path reaches the steps');
});

test('a directory with a manifest and no repository is git init, then start again', async (t) => {
  const dir = scratch(t);
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'probe', private: true, dependencies: { 'is-number': '^7.0.0' } }, null, 2)}\n`,
  );
  const { code, stdout } = await start(dir, { inGit: false });

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), ['  1  git init', `  2  ${START_AGAIN_STEP}`]);
  assert.equal(stdout.includes('pnpm init'), false, 'the manifest is already there');
});

test('a repository without a manifest starts at pnpm init', async (t) => {
  const dir = scratch(t);
  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    '  1  pnpm init',
    '  2  funky-secure init --apply  plan the 2 writes',
    `  3  git add pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`,
    `  4  ${ADD_STEP}`,
    `  5  ${ADD_COMMIT_STEP}`,
    `  6  git add pnpm-lock.yaml && git commit -m "${TRACK_COMMIT}"`,
    `  7  ${SCAN_STEP}`,
  ]);
  assert.equal(stdout.includes('git init'), false, 'it is already a repository');
});

test('a repository with a plan to write names init --apply and how many writes', async (t) => {
  const dir = scratch(t, 'below-policy');
  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    '  1  funky-secure init --apply  plan the 2 writes',
    `  2  git add pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`,
    `  3  ${SCAN_STEP}`,
  ]);
  assert.equal(stdout.includes(ADD_STEP), false, 'the lockfile is committed');
});

test('a repository missing only the lockfile starts at the first dependency', async (t) => {
  // Issue 131, the second half: the add rewrites `package.json`, and the closing commit stages only the
  // lockfile, so the path used to end with ` M package.json` in the tree it called closed. The add has
  // a commit of its own, and there is no range to clear here, so the closing commit still stages the
  // lockfile and nothing else (11.7 rows 13 and 14).
  const dir = scratch(t, 'at-policy');
  unlinkSync(join(dir, 'pnpm-lock.yaml'));
  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    `  1  ${ADD_STEP}`,
    `  2  ${ADD_COMMIT_STEP}`,
    `  3  git add pnpm-lock.yaml && git commit -m "${TRACK_COMMIT}"`,
    `  4  ${SCAN_STEP}`,
  ]);
  assert.equal(stdout.includes('init --apply'), false, 'nothing is left to write');
  assert.equal(stdout.includes('git init'), false);
  assert.equal(stdout.includes('pnpm init'), false);
  assert.equal(stdout.includes('pin --apply'), false, 'an exact manifest has no range to clear');
  assert.equal(stdout.includes(PIN_COMMIT), false, 'so no pin commit is printed either');
  assert.equal(
    stdout.includes('git add pnpm-lock.yaml package.json'),
    false,
    'the add commit carries the manifest, so the closing commit stages only the lockfile (0016)',
  );
});

test('a manifest with no lockfile commits the add before it is told to pin', async (t) => {
  // Issue 131, the first half, as the field met it: `pnpm add` records the dependency in the manifest
  // and no step committed it, so the very next writer on the path — `pin --apply` — refused the tree
  // the path itself had just made, and the printed plan offered no way out. A step that requires a
  // clean tree prints the command that produces it (0018), so the add gets a commit of its own, exactly
  // where the pin got one (0028, 11.7 row 13).
  const dir = scratch(t);
  writeManifest(dir, true);
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  commitAll(dir, 'scaffold');

  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    '  1  funky-secure init --apply  plan the 2 writes',
    `  2  git add pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`,
    `  3  ${ADD_STEP}`,
    `  4  ${ADD_COMMIT_STEP}`,
    '  5  funky-secure pin --apply  pin the 3 ranges this repository already has',
    '  6  pnpm install --lockfile-only',
    `  7  git add package.json && git commit -m "${PIN_COMMIT}"`,
    `  8  git add pnpm-lock.yaml && git commit -m "${TRACK_COMMIT}"`,
    `  9  ${SCAN_STEP}`,
  ]);
  assert.ok(stdout.indexOf(ADD_STEP) < stdout.indexOf(ADD_MESSAGE), 'the commit follows the add it covers');
  assert.ok(
    stdout.indexOf(ADD_MESSAGE) < stdout.indexOf('pin --apply'),
    'and precedes the writer that refuses a dirty tree',
  );
});

test('the add commit message is one constant, not a literal written twice', async () => {
  // The message belongs to the repository and outlives this tool's output, so it is pinned like the
  // other three: one constant, and the step spelled from it. A second hand-written copy would drift.
  assert.equal(ADD_MESSAGE, 'chore: add the first dependency', 'the message the record names');

  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'commands', 'start.js'), 'utf8');
  assert.equal(
    source.split('chore: add the first dependency').length - 1,
    1,
    'the literal lives once, in the constant the step is spelled from',
  );
});

test('a repository past the start says so in one line and names the scan', async (t) => {
  const dir = scratch(t, 'at-policy');
  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [], 'no stale checklist');
  assert.equal(
    stdout
      .split('\n')
      .filter((line) => line.includes('past the start')).length,
    1,
    'exactly one line says where the repository is',
  );
  assert.match(
    stdout,
    /^the repository is past the start; the next step is funky-secure scan --preset starter$/m,
    'the line names the same preset the path ends with',
  );
  assert.equal(
    stdout.includes('why this order'),
    false,
    'no order to explain means no order printed',
  );
});

test('both closing blocks always print: why this order, and what the starter does not run', async (t) => {
  const dir = scratch(t);
  const { stdout } = await start(dir);
  const lines = stdout.split('\n');

  const why = lines.indexOf('why this order');
  assert.notEqual(why, -1, 'the order is explained, not only printed');
  assert.ok(lines[why + 1].startsWith('  ') && lines[why + 1].trim() !== '', 'it carries a line of prose');

  const notRun = lines.findIndex((line) => line.startsWith('not run  '));
  assert.notEqual(notRun, -1, 'the reduced preset is stated');
  const sentence = [lines[notRun]];
  for (const line of lines.slice(notRun + 1)) {
    if (!line.startsWith(' '.repeat(9))) break;
    sentence.push(line);
  }
  assert.equal(
    sentence.map((line) => line.slice(9)).join(' '),
    '6 of 12 rules; off by policy: Environment files, Pinned actions, Bot auto-merge, ' +
      'CI install flags, pull_request_target, Workflow permissions',
    'the same honesty content the report renders',
  );
});

test('an npm-generated project installs once, and the gate exists before that install', async (t) => {
  // Field report F1: the old order was migrate then init --apply, while migrate prints a human
  // `pnpm install` as its third step and refuses to remove the foreign lockfile until pnpm-lock.yaml
  // exists. So the first resolve of the migration happened before the block that governs it — in every
  // repository arriving from npm or yarn, and never in greenfield. The block has to exist before the
  // install that reads it, and migrate can only run after the install it depends on, so the order is
  // init --apply, install, migrate.
  const dir = scratch(t);
  generatedBy(dir, { lockfile: 'package-lock.json' });
  const { code, stdout } = await start(dir);

  assert.equal(code, 0, 'a second package manager is guidance, not a refusal');
  assert.deepEqual(stepLines(stdout), [
    '  1  funky-secure init --apply  plan the 2 writes',
    `  2  git add pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`,
    '  3  pnpm import',
    '  4  funky-secure pin --apply  pin the 3 ranges this repository already has',
    '  5  pnpm install --lockfile-only',
    `  6  git add package.json && git commit -m "${PIN_COMMIT}"`,
    `  7  git switch -c ${FEATURE_BRANCH}`,
    '  8  funky-secure migrate --apply  on a feature branch: it refuses to remove a lockfile on main',
    `  9  git add pnpm-lock.yaml package-lock.json && git commit -m "${TRACK_COMMIT}"`,
    `  10  ${SCAN_STEP}`,
  ]);
  assert.deepEqual(stepNumbers(stdout), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'the numbering stays continuous');
  // The pin's commit sits where its own state is produced: after the resolve that re-syncs the
  // lockfile `pin` desyncs, and before the branch the migration needs (0028).
  assert.ok(
    stdout.indexOf('pnpm install --lockfile-only') < stdout.indexOf(PIN_COMMIT),
    'the commit follows the resolve it covers',
  );
  assert.ok(
    stdout.indexOf(PIN_COMMIT) < stdout.indexOf('git switch -c'),
    'the tree is clean before the branch and the migration that follow',
  );
  assert.equal(
    stdout.includes('git add pnpm-lock.yaml package.json'),
    false,
    'the closing commit stages no manifest: the pin has a commit of its own (0028)',
  );
  assert.ok(
    stdout.indexOf('init --apply') < stdout.indexOf('pnpm import'),
    'the gate is written before the resolve that reads it',
  );
  assert.ok(
    stdout.indexOf('pnpm import') < stdout.indexOf('migrate'),
    'migrate needs pnpm-lock.yaml, and pnpm-lock.yaml is what the install writes',
  );
  assert.equal(stdout.includes(ADD_STEP), false, 'a migration is not the place to add a dependency');
  assert.equal(
    whyBlock(stdout).filter((line) => line.includes('migrate')).length,
    1,
    'the migration reason appears once, never twice',
  );
});

/**
 * Declares a `packageManager` in the manifest the way a framework generator does (`create-t3-app`
 * writes `npm@11.13.0`), and records the tree so the next writer lands on a clean one.
 * @param {string} dir
 * @param {string} packageManager
 */
function pinManager(dir, packageManager) {
  const path = join(dir, 'package.json');
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.packageManager = packageManager;
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  commitAll(dir, 'pin the manager');
}

test('a foreign pin makes the pnpm steps carry the flag that lets them run, and says why', async (t) => {
  // Field report F3 (issue 111): a `create-t3-app` project declares `packageManager: npm@11.13.0`, and
  // both printed pnpm steps exit 1 with ERR_PNPM_OTHER_PM_EXPECTED under it. The tool never rewrites a
  // declaration a human made, so the step carries the flag that runs pnpm under it instead, and the
  // reason names the declaration (0018).
  const dir = scratch(t);
  generatedBy(dir, { lockfile: 'package-lock.json' });
  pinManager(dir, 'npm@11.13.0');

  const { code, stdout } = await start(dir);

  assert.equal(code, 0, 'a declared foreign manager is guidance, not a refusal');
  assert.deepEqual(stepLines(stdout), [
    '  1  funky-secure init --apply  plan the 2 writes',
    `  2  git add pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`,
    '  3  pnpm import --pm-on-fail=ignore',
    '  4  funky-secure pin --apply  pin the 3 ranges this repository already has',
    '  5  pnpm install --lockfile-only --pm-on-fail=ignore',
    `  6  git add package.json && git commit -m "${PIN_COMMIT}"`,
    `  7  git switch -c ${FEATURE_BRANCH}`,
    '  8  funky-secure migrate --apply  on a feature branch: it refuses to remove a lockfile on main',
    `  9  git add pnpm-lock.yaml package-lock.json && git commit -m "${TRACK_COMMIT}"`,
    `  10  ${SCAN_STEP}`,
  ]);
  const explained = whyBlock(stdout).filter((line) => line.includes('--pm-on-fail=ignore'));
  assert.equal(explained.length, 1, 'the flag is explained once, in why this order');
  assert.match(explained[0], /package\.json declares npm@11\.13\.0/);
});

test('a pnpm pin prints no flag, because pnpm is the manager the steps already name', async (t) => {
  const dir = scratch(t);
  generatedBy(dir, { lockfile: 'package-lock.json' });
  pinManager(dir, 'pnpm@12.3.4');

  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.equal(stdout.includes('--pm-on-fail=ignore'), false, 'the flag never leaks into a pnpm pin');
  const pnpmSteps = stepLines(stdout).filter((line) => line.includes('pnpm '));
  assert.deepEqual(pnpmSteps, ['  3  pnpm import', '  5  pnpm install --lockfile-only']);
});

/**
 * The shapes the enclosing-workspace line was written for (issue 113) and the one it falsified (issue
 * 144).
 *
 * `start` names no ancestor root any more. A project that carries no `pnpm-workspace.yaml` of its own is
 * one whose own plan writes it before any step that writes a lockfile, so that write — not a prediction
 * about pnpm's walk — is what decides where the lockfile lands. `scan`'s lockfile finding reports what
 * is on disk instead.
 *
 * A repository placed where an upward walk would travel, with the workspace files the shape needs
 * written above it. Nothing above the scratch root is written, and the operating system's temporary
 * directory is assumed to carry no `pnpm-workspace.yaml`.
 *
 * @param {import('node:test').TestContext} t
 * @param {{ ancestorAt?: string | null, own?: boolean }} options `ancestorAt` is the depth below the
 *   scratch root that carries the `pnpm-workspace.yaml` — `''` for the scratch root itself, `'work'`
 *   for one level above the project — and `null` for a tree that carries none
 * @returns {{ base: string, root: string }} the scratch root and the repository `start` runs in
 */
function insideATree(t, { ancestorAt = null, own = false } = {}) {
  const base = scratch(t);
  const root = join(base, 'work', 'apps');
  mkdirSync(root, { recursive: true });
  if (ancestorAt !== null) {
    writeFileSync(join(base, ancestorAt, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  }
  if (own) writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/other\n');
  generatedBy(root, { lockfile: 'pnpm-lock.yaml' });
  return { base, root };
}

test('the canonical path prints no line about an enclosing workspace, because its own plan writes one (issue 144)', async (t) => {
  // Issue 144, measured in two blind field sessions: the line was computed at plan time from a walk
  // that found the enclosing workspace, and step 1 of the same path writes `pnpm-workspace.yaml`, which
  // makes this repository the workspace root. `pnpm add` then wrote this project's lockfile, the commit
  // staged it first try, and the lockfile finding cleared — the line predicted the opposite of what
  // running the path does.
  const { base, root } = insideATree(t, { ancestorAt: '' });
  const { code, stdout } = await start(root);

  assert.equal(code, 0, 'an enclosing workspace is guidance, not a refusal');
  assert.deepEqual(
    stepLines(stdout),
    [
      '  1  funky-secure init --apply  plan the 2 writes',
      `  2  git add pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`,
      '  3  funky-secure pin --apply  pin the 3 ranges this repository already has',
      '  4  pnpm install --lockfile-only',
      `  5  git add package.json && git commit -m "${PIN_COMMIT}"`,
      `  6  git add pnpm-lock.yaml && git commit -m "${TRACK_COMMIT}"`,
      `  7  ${SCAN_STEP}`,
    ],
    'the steps a repository at this state is at do not move',
  );
  assert.equal(stdout.includes('workspace at'), false, 'no ancestor is named');
  assert.equal(stdout.includes('will not clear'), false, 'no resolution is predicted');
  assert.ok(
    stdout.includes(`git add pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`),
    'the block this step writes is what the next step stages, so the project becomes the workspace root',
  );
  assert.equal(stdout.includes(base), false, 'no absolute path reaches the output');
  assert.equal(stdout.includes(root), false, 'no absolute path reaches the output');
});

test('a project that carries its own workspace file prints no line', async (t) => {
  const { base, root } = insideATree(t, { ancestorAt: '', own: true });
  const { code, stdout } = await start(root);

  assert.equal(code, 0);
  assert.equal(stdout.includes('workspace at'), false, 'no ancestor is named');
  assert.equal(stdout.includes(base), false, 'no absolute path reaches the output');
});

test('a project with no workspace above it prints no line', async (t) => {
  const { root } = insideATree(t);
  const { code, stdout } = await start(root);

  assert.equal(code, 0);
  assert.equal(stdout.includes('workspace at'), false);
});

test('an ancestor workspace makes no difference to the path at all', async (t) => {
  // The read above the repository root went with the line it fed: the two shapes that never printed the
  // line and the shape that used to print it now render the same bytes, so nothing the path prints
  // depends on a fact `init --apply` is about to change (issue 144).
  const own = await start(insideATree(t, { ancestorAt: '', own: true }).root);
  const none = await start(insideATree(t).root);
  const ancestor = await start(insideATree(t, { ancestorAt: '' }).root);

  assert.equal(
    own.stdout,
    none.stdout,
    'a root with its own workspace file renders like one with no workspace above it',
  );
  assert.equal(
    ancestor.stdout,
    none.stdout,
    'an ancestor adds no line, no step and no reason, because the path writes the file that decides it',
  );
});

test('an uncommitted repository is told to commit before it is told to apply', async (t) => {
  // Remediation conformance sweep, the worst of the three: the canonical first-run path could not be
  // completed. `start` printed `init --apply` as step 1, and `init --apply` refuses to write over
  // uncommitted changes — which is the state of every freshly generated project, where nothing has been
  // committed yet. The sequence has to name the commit, or its first step cannot run.
  const dir = scratch(t);
  generatedBy(dir, { lockfile: 'pnpm-lock.yaml', committed: false });
  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    `  1  git add -A && git commit -m "${BASELINE_COMMIT}"`,
    '  2  funky-secure init --apply  plan the 2 writes',
    `  3  git add pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`,
    '  4  funky-secure pin --apply  pin the 3 ranges this repository already has',
    '  5  pnpm install --lockfile-only',
    `  6  git add package.json && git commit -m "${PIN_COMMIT}"`,
    `  7  git add pnpm-lock.yaml && git commit -m "${TRACK_COMMIT}"`,
    `  8  ${SCAN_STEP}`,
  ]);
  assert.ok(
    stdout.indexOf('git commit') < stdout.indexOf('init --apply'),
    'the tree is committed before the block is written over it',
  );
});

test('a clean tree commits after the writes, because the writes are what dirty it', async (t) => {
  // The other half of the commit rule: `init --apply` refuses a tree carrying someone else's work, and
  // it makes exactly that state itself. Without the step after it, the next writer — `pin` — refuses,
  // which is the friction a create-next-app run reported (0015).
  const dir = scratch(t);
  generatedBy(dir, { lockfile: 'pnpm-lock.yaml' });
  const { stdout } = await start(dir);

  assert.ok(stdout.includes('git commit'), 'the writes dirty the tree, so a commit step is due');
  assert.ok(
    stdout.indexOf('init --apply') < stdout.indexOf('git commit'),
    'the commit follows the writes it covers, never precedes them on a clean tree',
  );
});

test('a repository the pin can be written into counts the two writes over its manifest', async (t) => {
  // With a pnpm answering, `init --apply` plans the pin (W3) and the devEngines guard beside it
  // (W3b) over the same file. The count is the plan's item count, so it moves by one, and the commit
  // names `package.json` once because a path is staged once (11.2, 0030).
  const dir = scratch(t);
  generatedBy(dir, { lockfile: 'package-lock.json' });
  const { code, stdout } = await start(dir, { version: '12.3.4' });

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    '  1  funky-secure init --apply  plan the 4 writes',
    `  2  git add package.json pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`,
    '  3  pnpm import',
    '  4  funky-secure pin --apply  pin the 3 ranges this repository already has',
    '  5  pnpm install --lockfile-only',
    `  6  git add package.json && git commit -m "${PIN_COMMIT}"`,
    `  7  git switch -c ${FEATURE_BRANCH}`,
    '  8  funky-secure migrate --apply  on a feature branch: it refuses to remove a lockfile on main',
    `  9  git add pnpm-lock.yaml package-lock.json && git commit -m "${TRACK_COMMIT}"`,
    `  10  ${SCAN_STEP}`,
  ]);
  assert.equal(
    stdout.split('package.json pnpm-workspace.yaml .gitignore').length - 1,
    1,
    'two plan items over one file are one path to stage',
  );
});

test('a repository that already carries the pin counts the guard as a write', async (t) => {
  // The repository pinned by an earlier release, which the guard used to leave uncovered: the plan adds
  // one write over the manifest without touching the pin, and the commit names that file once.
  const dir = scratch(t);
  generatedBy(dir, { lockfile: 'pnpm-lock.yaml' });
  const path = join(dir, 'package.json');
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.packageManager = 'pnpm@12.3.4';
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  commitAll(dir, 'pin the manager');

  const { code, stdout } = await start(dir, { version: '12.3.4' });

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    '  1  funky-secure init --apply  plan the 3 writes',
    `  2  git add package.json pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`,
    '  3  funky-secure pin --apply  pin the 3 ranges this repository already has',
    '  4  pnpm install --lockfile-only',
    `  5  git add package.json && git commit -m "${PIN_COMMIT}"`,
    `  6  git add pnpm-lock.yaml && git commit -m "${TRACK_COMMIT}"`,
    `  7  ${SCAN_STEP}`,
  ]);
  assert.equal(
    stdout.split('git add package.json pnpm-workspace.yaml').length - 1,
    1,
    'the guard and the block are three writes over three files, each staged once',
  );
});

test('nothing to pin means no pin commit, and the closing commit stages no manifest', async (t) => {
  // The pin's commit prints only where `pin --apply` prints, because a commit that stages nothing is
  // not a step (0016, 0028). The closing commit keeps naming what it covers: the lockfile the install
  // writes and the foreign one the migration removes — never a manifest, which no step here writes.
  const dir = scratch(t);
  generatedBy(dir, { lockfile: 'package-lock.json', ranges: false });
  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    '  1  funky-secure init --apply  plan the 2 writes',
    `  2  git add pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`,
    '  3  pnpm import',
    `  4  git switch -c ${FEATURE_BRANCH}`,
    '  5  funky-secure migrate --apply  on a feature branch: it refuses to remove a lockfile on main',
    `  6  git add pnpm-lock.yaml package-lock.json && git commit -m "${TRACK_COMMIT}"`,
    `  7  ${SCAN_STEP}`,
  ]);
  assert.equal(stdout.includes('pin --apply'), false, 'there is no range to clear');
  assert.equal(stdout.includes(PIN_COMMIT), false, 'so there is no pin to commit either');
  assert.equal(
    stdout.includes('git add package.json'),
    false,
    'no commit on the path stages the manifest when the pin never ran',
  );
  assert.ok(
    stdout.includes('git add pnpm-lock.yaml package-lock.json'),
    'the closing commit still carries the removal the migration left in the index',
  );
});

test('a pnpm-generated project is told neither to migrate nor to add', async (t) => {
  const dir = scratch(t);
  generatedBy(dir, { lockfile: 'pnpm-lock.yaml' });
  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    '  1  funky-secure init --apply  plan the 2 writes',
    `  2  git add pnpm-workspace.yaml .gitignore && git commit -m "${APPLY_COMMIT}"`,
    '  3  funky-secure pin --apply  pin the 3 ranges this repository already has',
    '  4  pnpm install --lockfile-only',
    `  5  git add package.json && git commit -m "${PIN_COMMIT}"`,
    `  6  git add pnpm-lock.yaml && git commit -m "${TRACK_COMMIT}"`,
    `  7  ${SCAN_STEP}`,
  ]);
  assert.deepEqual(stepNumbers(stdout), [1, 2, 3, 4, 5, 6, 7], 'the numbering stays continuous');
  assert.equal(stdout.includes('funky-secure migrate'), false, 'no foreign lockfile to leave behind');
  assert.equal(stdout.includes(ADD_STEP), false, 'the lockfile the generator wrote is the one to keep');
  assert.equal(stdout.includes(ADD_MESSAGE), false, 'no add means no add commit either');
  assert.equal(
    whyBlock(stdout).filter((line) => line.includes('migrate')).length,
    0,
    'no migration means no migration reason',
  );
  assert.equal(
    whyBlock(stdout).filter((line) => line.includes('pin')).length,
    1,
    'the pin step carries its own reason',
  );
});

test('renders the same bytes twice over the same state, in every state', async (t) => {
  const states = [
    ['empty', scratch(t)],
    ['no manifest', scratch(t)],
    ['writes waiting', scratch(t, 'below-policy')],
    ['no lockfile', scratch(t, 'at-policy')],
    ['past the start', scratch(t, 'at-policy')],
  ];
  unlinkSync(join(states[3][1], 'pnpm-lock.yaml'));

  for (const [name, dir] of states) {
    const first = await start(dir, { inGit: name !== 'empty' });
    const second = await start(dir, { inGit: name !== 'empty' });

    assert.equal(first.code, 0, `${name}: exit 0`);
    assert.equal(first.stderr, '', `${name}: nothing on stderr`);
    assert.equal(first.stdout, second.stdout, `${name}: the same bytes on the second run`);
    assert.equal(first.stdout.includes(dir), false, `${name}: no absolute path`);
    assert.doesNotMatch(first.stdout, /\d{4}-\d{2}-\d{2}T/, `${name}: no timestamp`);
  }
});

test('start takes no flag beyond --help, so --preset is a usage error', async (t) => {
  const dir = scratch(t);
  const rejected = await start(dir, { argv: ['start', '--preset', 'starter'] });

  assert.equal(rejected.code, 2, 'a usage error, never a silently ignored argument');
  assert.equal(rejected.stdout, '');
  assert.match(rejected.stderr, /^funky-secure: .*\nreason: /);

  const helped = await start(dir, { argv: ['start', '--help'] });
  assert.equal(helped.code, 0);
  assert.match(helped.stdout, /^usage: funky-secure <command> \[options\]$/m);
});
