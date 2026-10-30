import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

import { run } from '../src/cli.js';
import { createCollector } from '../src/lib/probes.js';

// Spec 7.3: "Never writes any file, anywhere". The tool reported it for eight releases while
// `pnpm --version`, spawned with the scanned repository as cwd, made pnpm 12 rewrite the project's
// own lockfile whenever `packageManager` was declared. The test that would have caught it is this
// file, and nobody had written it: every other test asserted what the tool printed, never what it
// left behind on disk (0019).

const LOCKFILE = [
  "lockfileVersion: '9.0'",
  '',
  'importers:',
  '',
  '  .:',
  '    dependencies:',
  '      is-number:',
  '        specifier: 7.0.0',
  '        version: 7.0.0',
  '',
].join('\n');

const MANIFEST = `${JSON.stringify(
  {
    name: 'read-only',
    packageManager: 'pnpm@12.3.4',
    dependencies: { 'is-number': '7.0.0' },
  },
  null,
  2,
)}\n`;

/**
 * A repository in the exact state that triggered the defect: a manifest pinning the package manager
 * and a lockfile on disk. The pin is what makes pnpm act on an unrelated command.
 */
function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-readonly-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), MANIFEST);
  writeFileSync(join(dir, 'pnpm-lock.yaml'), LOCKFILE);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  commit(dir);
  return dir;
}

/**
 * pnpm only rewrites the lockfile of a repository it considers the project's, and a hook on the
 * machine refuses a synthetic identity. So the fixture commits with whatever identity git already
 * has, and skips the commit when there is none: the probe still runs, the guard is just narrower.
 */
function commit(dir) {
  const config = (key) => {
    try {
      return execFileSync('git', ['config', '--get', key], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  };
  const email = config('user.email');
  const name = config('user.name') === '' ? 'fixture' : config('user.name');
  const identity = email === '' ? [] : ['-c', `user.email=${email}`, '-c', `user.name=${name}`];
  try {
    git(dir, [...identity, 'commit', '-qm', 'base']);
  } catch {
    // No identity, or a hook that refuses one: the lockfile assertion still holds.
  }
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The bytes the user would lose, read back after the command under test. */
function bytes(dir) {
  return {
    lockfile: readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8'),
    manifest: readFileSync(join(dir, 'package.json'), 'utf8'),
    dirty: git(dir, ['status', '--porcelain']),
  };
}

for (const [label, argv] of [
  ['scan, both scopes', ['scan', '--scope', 'all']],
  ['scan --scope machine', ['scan', '--scope', 'machine']],
  ['scan --scope repo', ['scan', '--scope', 'repo']],
  ['start', ['start']],
]) {
  test(`${label} leaves the repository byte-identical (7.3)`, async (t) => {
    const dir = scratch(t);
    const before = bytes(dir);
    const stdout = { text: '', write(chunk) { this.text += chunk; } };
    const stderr = { text: '', write(chunk) { this.text += chunk; } };

    await run(argv, { cwd: dir, env: process.env, stdout, stderr });

    assert.deepEqual(
      bytes(dir),
      before,
      'a command that only reads must not change a byte, and must not leave the tree dirty',
    );
  });
}

function childFor({ code = 0, stdout = '' } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { on() {}, end() {} };
  setImmediate(() => {
    if (stdout !== '') child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', code);
  });
  return child;
}

test('the version probe never runs inside the scanned repository', async () => {
  // The integration test above is the real guard, but it only bites where pnpm is installed and
  // decides to act. This one holds everywhere: reading a version is no reason to stand in the user's
  // directory, and standing there is what let pnpm rewrite the lockfile.
  const calls = [];
  const spawn = (file, args, options) => {
    calls.push({ file, args, options });
    if (file === 'which') return childFor({ stdout: '/usr/local/bin/pnpm\n' });
    if (args.includes('--version')) return childFor({ stdout: '12.3.4\n' });
    return childFor({});
  };

  const repository = '/scanned/repository';
  const collector = createCollector({
    cwd: repository,
    platform: 'linux',
    env: {},
    spawn,
    readText: async () => '',
  });
  const version = await collector.pnpmVersion();

  assert.equal(version.ok, true, 'the fixture resolves a version');
  const versionCall = calls.find((call) => call.args.includes('--version'));
  assert.ok(versionCall, 'the collector still asks for the version');
  assert.notEqual(
    versionCall.options.cwd,
    repository,
    'the version probe runs outside the repository it is inspecting',
  );
});
