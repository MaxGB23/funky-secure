import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
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
      if (args[0] === 'status') return ok('');
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

const SCAN_STEP = 'funky-secure scan --preset starter';
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
    '5 of 12 rules; off by policy: Foreign lockfile, Environment files, Pinned actions, ' +
      'Bot auto-merge, CI install flags, pull_request_target, Workflow permissions',
    'the same honesty content the report renders',
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
