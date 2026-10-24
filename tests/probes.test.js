import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  PROBES,
  executableFromShim,
  resolvePnpm,
  runProcess,
  createCollector,
} from '../src/lib/probes.js';

function childFor({ code = 0, stdout = '', stderr = '', fail = null }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { on() {}, end() {} };
  setImmediate(() => {
    if (fail !== null) {
      child.emit('error', fail);
      return;
    }
    if (stdout !== '') child.stdout.emit('data', Buffer.from(stdout));
    if (stderr !== '') child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  });
  return child;
}

function spawnTable(table) {
  const calls = [];
  const spawn = (file, args, options) => {
    calls.push({ file, args, options });
    const key = `${file} ${args.join(' ')}`;
    const entry = table[key] ?? table[file];
    if (entry === undefined) {
      const error = new Error(`no table entry for "${key}"`);
      error.code = 'ENOENT';
      return childFor({ fail: error });
    }
    return childFor(typeof entry === 'function' ? entry() : entry);
  };
  return { spawn, calls };
}

const SHIM = [
  '@ECHO off',
  'SETLOCAL',
  'SET "PNPM_EXE=%~dp0\\..\\global\\v11\\3a70-18decba95af6b8fc\\node_modules\\@pnpm\\exe\\pnpm.exe"',
  '"%PNPM_EXE%" %*',
].join('\r\n');

test('declares the closed probe list of RFC 12.1', () => {
  assert.equal(PROBES.length, 11);
  assert.ok(PROBES.includes('pnpm config list --json'));
  assert.ok(PROBES.includes('git check-ignore --no-index --stdin -z'));
});

test('runs with an argument array and shell disabled, and collects both streams', async () => {
  const { spawn, calls } = spawnTable({ 'git rev-parse': { code: 0, stdout: '/repo\n' } });

  const result = await runProcess('git', ['rev-parse'], { spawn, env: {}, cwd: '/repo' });

  assert.deepEqual(result, { ok: true, code: 0, stdout: '/repo\n', stderr: '' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['rev-parse']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsVerbatimArguments, false);
});

test('turns a spawn failure into a fact instead of an exception', async () => {
  const error = new Error('spawn EINVAL');
  error.code = 'EINVAL';
  const { spawn } = spawnTable({ 'pnpm.cmd --version': { fail: error } });

  const result = await runProcess('pnpm.cmd', ['--version'], { spawn, env: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EINVAL');
});

test('expands %~dp0 to the real executable behind a win32 shim', () => {
  const target = executableFromShim(SHIM, 'C:\\Users\\me\\AppData\\Local\\pnpm\\bin\\pnpm.cmd');

  assert.equal(
    target,
    'C:\\Users\\me\\AppData\\Local\\pnpm\\bin\\..\\global\\v11\\3a70-18decba95af6b8fc\\node_modules\\@pnpm\\exe\\pnpm.exe',
  );
});

test('returns null when a shim names no executable', () => {
  assert.equal(executableFromShim('@ECHO off\r\necho hello\r\n', 'C:\\x\\pnpm.cmd'), null);
});

test('resolves the native executable from the shim, never by searching for it', async () => {
  const { spawn } = spawnTable({
    'where pnpm': {
      code: 0,
      stdout: 'C:\\Users\\me\\AppData\\Local\\pnpm\\bin\\pnpm\nC:\\Users\\me\\AppData\\Local\\pnpm\\bin\\pnpm.cmd\n',
    },
  });
  const readText = async (path) => {
    if (path.endsWith('pnpm.cmd')) return SHIM;
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };

  const resolved = await resolvePnpm({ platform: 'win32', spawn, readText, env: {} });

  assert.equal(resolved.file?.endsWith('@pnpm\\exe\\pnpm.exe'), true);
  assert.equal(resolved.installations.length, 2);
  assert.equal(resolved.source, 'where pnpm');
});

test('reports an unresolved shim instead of guessing', async () => {
  const { spawn } = spawnTable({
    'where pnpm': { code: 0, stdout: 'C:\\Users\\me\\AppData\\Local\\pnpm\\bin\\pnpm.cmd\n' },
  });

  const resolved = await resolvePnpm({
    platform: 'win32',
    spawn,
    readText: async () => {
      throw new Error('EACCES');
    },
    env: {},
  });

  assert.deepEqual({ file: resolved.file, reason: resolved.reason }, {
    file: null,
    reason: 'unresolved-shim',
  });
});

test('uses the POSIX shim directly, because a shebang is enough', async () => {
  const { spawn } = spawnTable({ 'which pnpm': { code: 0, stdout: '/usr/local/bin/pnpm\n' } });

  const resolved = await resolvePnpm({ platform: 'linux', spawn, env: {} });

  assert.equal(resolved.file, '/usr/local/bin/pnpm');
});

test('reports pnpm as not on PATH rather than failing', async () => {
  const { spawn } = spawnTable({ 'where pnpm': { code: 1, stdout: '' } });

  const resolved = await resolvePnpm({ platform: 'win32', spawn, env: {}, readText: async () => '' });

  assert.equal(resolved.file, null);
  assert.equal(resolved.reason, 'not-on-path');
  assert.deepEqual(resolved.installations, []);
});

test('parses the version and its major, and caches the probe', async () => {
  const { spawn, calls } = spawnTable({
    'where pnpm': { code: 0, stdout: 'C:\\pnpm\\bin\\pnpm.exe\n' },
    'C:\\pnpm\\bin\\pnpm.exe --version': { code: 0, stdout: '12.3.4\n' },
  });
  const collector = createCollector({ cwd: '.', platform: 'win32', spawn, env: {}, readText: async () => '' });

  const first = await collector.pnpmVersion();
  const second = await collector.pnpmVersion();

  assert.deepEqual(first, {
    ok: true,
    version: '12.3.4',
    major: 12,
    executable: 'C:\\pnpm\\bin\\pnpm.exe',
    installations: ['C:\\pnpm\\bin\\pnpm.exe'],
  });
  assert.equal(second, first);
  assert.equal(calls.filter((call) => call.args.includes('--version')).length, 1);
});

test('reads the effective configuration as JSON and rejects a malformed answer', async () => {
  const good = spawnTable({
    'where pnpm': { code: 0, stdout: 'C:\\pnpm\\bin\\pnpm.exe\n' },
    'C:\\pnpm\\bin\\pnpm.exe config list --json': { code: 0, stdout: '{"minimumReleaseAge": 1440}' },
  });
  const bad = spawnTable({
    'where pnpm': { code: 0, stdout: 'C:\\pnpm\\bin\\pnpm.exe\n' },
    'C:\\pnpm\\bin\\pnpm.exe config list --json': { code: 0, stdout: 'not json' },
  });

  const configured = await createCollector({ cwd: '.', platform: 'win32', spawn: good.spawn, env: {}, readText: async () => '' }).pnpmConfig();
  const malformed = await createCollector({ cwd: '.', platform: 'win32', spawn: bad.spawn, env: {}, readText: async () => '' }).pnpmConfig();

  assert.deepEqual(configured, { ok: true, config: { minimumReleaseAge: 1440 } });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.reason, 'unparsable');
});

test('never falls back to a second command when the declared probe fails', async () => {
  const { spawn, calls } = spawnTable({
    'where pnpm': { code: 0, stdout: 'C:\\pnpm\\bin\\pnpm.exe\n' },
    'C:\\pnpm\\bin\\pnpm.exe --version': { code: 1, stdout: '' },
    'C:\\pnpm\\bin\\pnpm.exe config list --json': { code: 1, stdout: '' },
  });
  const collector = createCollector({ cwd: '.', platform: 'win32', spawn, env: {}, readText: async () => '' });

  assert.equal((await collector.pnpmVersion()).ok, false);
  assert.equal((await collector.pnpmConfig()).ok, false);
  assert.deepEqual(calls.map((call) => call.args.join(' ')), ['pnpm', '--version', 'config list --json']);
});
