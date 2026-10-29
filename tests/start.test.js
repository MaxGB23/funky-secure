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
 * questions from the repository's own `.gitignore`, and reports no pnpm version at all.
 * @param {{ dir: string, inGit?: boolean }} options
 */
function fakeCollector({ dir, inGit = true }) {
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
    pnpmVersion: async () => ({ ok: false, reason: 'not-on-path', installations: [] }),
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
async function start(dir, { inGit = true, argv = ['start'] } = {}) {
  const streams = {
    cwd: dir,
    env: {},
    stdout: capture(),
    stderr: capture(),
    collector: fakeCollector({ dir, inGit }),
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
 * @param {{ lockfile: string }} options the lockfile the generating manager wrote
 */
function generatedBy(dir, { lockfile, committed = true }) {
  const manifest = {
    name: 'app',
    private: true,
    dependencies: { next: '^15.5.4', react: '^19.2.0', 'react-dom': '^19.2.0' },
  };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.next\n');
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app', 'page.jsx'), 'export default function Page() {\n  return null;\n}\n');
  writeFileSync(join(dir, lockfile), '');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  if (committed) {
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync(
      'git',
      ['-c', 'user.email=82458865+MaxGB23@users.noreply.github.com', '-c', 'user.name=MaxGB23', 'commit', '-qm', 'generated'],
      { cwd: dir },
    );
  }
}

const SCAN_STEP = 'funky-secure scan --preset starter';
const BASELINE_COMMIT = 'chore: baseline before funky-secure';
const ADD_STEP = 'pnpm add <your first dependency>';

test('an empty directory is five steps, numbered from one', async (t) => {
  const dir = scratch(t);
  const { code, stdout } = await start(dir, { inGit: false });

  assert.equal(code, 0, 'start is guidance: it exits 0 when nothing is in place');
  assert.deepEqual(stepLines(stdout), [
    '  1  git init',
    '  2  pnpm init',
    '  3  funky-secure init --apply  plan the 1 write (nothing is written)',
    `  4  ${ADD_STEP}`,
    `  5  ${SCAN_STEP}`,
  ]);
  assert.equal(stdout.includes(dir), false, 'no absolute path reaches the steps');
});

test('a repository without a manifest starts at pnpm init', async (t) => {
  const dir = scratch(t);
  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    '  1  pnpm init',
    '  2  funky-secure init --apply  plan the 2 writes (nothing is written)',
    `  3  ${ADD_STEP}`,
    `  4  ${SCAN_STEP}`,
  ]);
  assert.equal(stdout.includes('git init'), false, 'it is already a repository');
});

test('a repository with a plan to write names init --apply and how many writes', async (t) => {
  const dir = scratch(t, 'below-policy');
  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    '  1  funky-secure init --apply  plan the 2 writes (nothing is written)',
    `  2  ${SCAN_STEP}`,
  ]);
  assert.equal(stdout.includes(ADD_STEP), false, 'the lockfile is committed');
});

test('a repository missing only the lockfile starts at the first dependency', async (t) => {
  const dir = scratch(t, 'at-policy');
  unlinkSync(join(dir, 'pnpm-lock.yaml'));
  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [`  1  ${ADD_STEP}`, `  2  ${SCAN_STEP}`]);
  assert.equal(stdout.includes('init --apply'), false, 'nothing is left to write');
  assert.equal(stdout.includes('git init'), false);
  assert.equal(stdout.includes('pnpm init'), false);
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
    '  1  funky-secure init --apply  plan the 2 writes (nothing is written)',
    '  2  pnpm install',
    '  3  funky-secure migrate --apply',
    `  4  ${SCAN_STEP}`,
  ]);
  assert.deepEqual(stepNumbers(stdout), [1, 2, 3, 4], 'the numbering stays continuous');
  assert.ok(
    stdout.indexOf('init --apply') < stdout.indexOf('pnpm install'),
    'the gate is written before the resolve that reads it',
  );
  assert.ok(
    stdout.indexOf('pnpm install') < stdout.indexOf('migrate'),
    'migrate needs pnpm-lock.yaml, and pnpm-lock.yaml is what the install writes',
  );
  assert.equal(stdout.includes(ADD_STEP), false, 'a migration is not the place to add a dependency');
  assert.equal(whyBlock(stdout).length, 3, 'why this order grows by one line, never two');
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
    '  2  funky-secure init --apply  plan the 2 writes (nothing is written)',
    `  3  ${SCAN_STEP}`,
  ]);
  assert.ok(
    stdout.indexOf('git commit') < stdout.indexOf('init --apply'),
    'the tree is committed before the block is written over it',
  );
});

test('a committed repository is not told to commit', async (t) => {
  const dir = scratch(t);
  generatedBy(dir, { lockfile: 'pnpm-lock.yaml' });
  const { stdout } = await start(dir);

  assert.equal(stdout.includes('git commit'), false, 'a clean tree needs no commit step');
});

test('a pnpm-generated project is told neither to migrate nor to add', async (t) => {
  const dir = scratch(t);
  generatedBy(dir, { lockfile: 'pnpm-lock.yaml' });
  const { code, stdout } = await start(dir);

  assert.equal(code, 0);
  assert.deepEqual(stepLines(stdout), [
    '  1  funky-secure init --apply  plan the 2 writes (nothing is written)',
    `  2  ${SCAN_STEP}`,
  ]);
  assert.deepEqual(stepNumbers(stdout), [1, 2], 'the numbering stays continuous');
  assert.equal(stdout.includes('funky-secure migrate'), false, 'no foreign lockfile to leave behind');
  assert.equal(stdout.includes(ADD_STEP), false, 'the lockfile the generator wrote is the one to keep');
  assert.equal(whyBlock(stdout).length, 2, 'no migration means no extra reason');
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
