import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateWriteTarget } from '../src/lib/paths.js';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-paths-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('accepts a repository-relative target inside the root', (t) => {
  const root = scratch(t);
  const result = validateWriteTarget({
    root,
    relative: 'pnpm-workspace.yaml',
    expectedBasename: 'pnpm-workspace.yaml',
  });
  assert.deepEqual(result, { ok: true, path: join(realpathSync(root), 'pnpm-workspace.yaml') });
});

test('accepts a target inside a nested directory that exists', (t) => {
  const root = scratch(t);
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  const result = validateWriteTarget({ root, relative: '.github/workflows/ci.yml', expectedBasename: 'ci.yml' });
  assert.deepEqual(result, {
    ok: true,
    path: join(realpathSync(root), '.github', 'workflows', 'ci.yml'),
  });
});

test('refuses a path that escapes the root with a parent segment', (t) => {
  const root = scratch(t);
  assert.deepEqual(validateWriteTarget({ root, relative: '../escape.yaml' }), {
    ok: false,
    reason: 'not-relative',
  });
  assert.deepEqual(validateWriteTarget({ root, relative: 'packages/../../escape.yaml' }), {
    ok: false,
    reason: 'not-relative',
  });
});

test('refuses a path with an empty segment', (t) => {
  const root = scratch(t);
  assert.deepEqual(validateWriteTarget({ root, relative: 'packages//pnpm-workspace.yaml' }), {
    ok: false,
    reason: 'not-relative',
  });
});

test('refuses an absolute path', (t) => {
  const root = scratch(t);
  assert.deepEqual(validateWriteTarget({ root, relative: join(root, 'pnpm-workspace.yaml') }), {
    ok: false,
    reason: 'not-relative',
  });
});

test('refuses a target whose parent directory does not exist', (t) => {
  const root = scratch(t);
  assert.deepEqual(validateWriteTarget({ root, relative: 'missing/dir/pnpm-workspace.yaml' }), {
    ok: false,
    reason: 'unresolvable',
  });
});

test('refuses a symlink that resolves outside the root', (t) => {
  const outside = scratch(t);
  writeFileSync(join(outside, 'pnpm-workspace.yaml'), 'packages: []\n');
  const root = scratch(t);
  try {
    symlinkSync(outside, join(root, 'link'), 'junction');
  } catch {
    t.skip('this platform refuses to create a directory symlink');
    return;
  }
  assert.deepEqual(validateWriteTarget({ root, relative: 'link/pnpm-workspace.yaml' }), {
    ok: false,
    reason: 'outside-root',
  });
});

test('refuses a basename that is not the expected one', (t) => {
  const root = scratch(t);
  assert.deepEqual(
    validateWriteTarget({ root, relative: 'pnpm-workspace.yaml', expectedBasename: 'package.json' }),
    { ok: false, reason: 'basename-mismatch' },
  );
});
