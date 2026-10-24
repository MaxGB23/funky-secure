import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONFIG_FILENAME, loadConfig, validateConfig, ConfigError } from '../src/lib/config.js';

const catalog = [{ id: 'pin' }, { id: 'exact' }];

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('accepts an empty config and the three declared keys', () => {
  assert.deepEqual(validateConfig({}, { catalog }), {});
  assert.deepEqual(
    validateConfig({ preset: 'strict', quarantineMinutes: 4320, rules: { exact: 'error' } }, { catalog }),
    { preset: 'strict', quarantineMinutes: 4320, rules: { exact: 'error' } },
  );
});

test('rejects an unknown top-level key by name', () => {
  assert.throws(
    () => validateConfig({ preset: 'strict', quarantine: 4320 }, { catalog }),
    (error) => error instanceof ConfigError && error.message.includes('quarantine'),
  );
});

test('rejects an unknown rule id, an unknown severity and a malformed quarantine', () => {
  const cases = [
    [{ rules: { nope: 'warn' } }, 'nope'],
    [{ rules: { pin: 'loud' } }, 'pin'],
    [{ preset: 'paranoid' }, 'paranoid'],
    [{ quarantineMinutes: 0 }, 'quarantineMinutes'],
    [{ quarantineMinutes: '72h' }, 'quarantineMinutes'],
    [{ rules: [] }, 'rules'],
  ];

  for (const [raw, key] of cases) {
    assert.throws(
      () => validateConfig(raw, { catalog }),
      (error) => error instanceof ConfigError && error.message.includes(key),
    );
  }
});

test('returns no config when the file is absent', (t) => {
  const dir = scratch(t);

  assert.deepEqual(loadConfig({ cwd: dir, root: dir }), { config: null, path: null });
});

test('reads the file from the repository root', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, CONFIG_FILENAME), JSON.stringify({ preset: 'strict' }));

  const loaded = loadConfig({ cwd: dir, root: dir });

  assert.deepEqual(loaded.config, { preset: 'strict' });
  assert.equal(loaded.path, join(dir, CONFIG_FILENAME));
});

test('prefers the repository root over the current directory', (t) => {
  const root = scratch(t);
  const nested = join(root, 'packages', 'api');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(root, CONFIG_FILENAME), JSON.stringify({ preset: 'strict' }));
  writeFileSync(join(nested, CONFIG_FILENAME), JSON.stringify({ preset: 'baseline' }));

  assert.equal(loadConfig({ cwd: nested, root, catalog }).config.preset, 'strict');
});

test('falls back to the current directory when the root has none', (t) => {
  const root = scratch(t);
  const nested = join(root, 'packages', 'api');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, CONFIG_FILENAME), JSON.stringify({ preset: 'strict' }));

  assert.equal(loadConfig({ cwd: nested, root, catalog }).config.preset, 'strict');
});

test('reports malformed json as a configuration error naming the file', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, CONFIG_FILENAME), '{ nope');

  assert.throws(
    () => loadConfig({ cwd: dir, root: dir, catalog }),
    (error) => error instanceof ConfigError && error.message.includes(CONFIG_FILENAME),
  );
});

test('validates the file it reads', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, CONFIG_FILENAME), JSON.stringify({ rules: { ghost: 'warn' } }));

  assert.throws(
    () => loadConfig({ cwd: dir, root: dir, catalog }),
    (error) => error instanceof ConfigError && error.message.includes('ghost'),
  );
});
