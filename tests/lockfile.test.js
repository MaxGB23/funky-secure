import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLockfile } from '../src/lib/lockfile.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @param {...string} parts */
function fixture(...parts) {
  return readFileSync(join(HERE, 'fixtures', ...parts), 'utf8');
}

const emptyImporter = () => ({
  specifiers: {},
  dependencies: {},
  devDependencies: {},
  optionalDependencies: {},
  peerDependencies: {},
});

test('parses this repository\'s own lockfile as lockfileVersion 9.0 with the root importer', () => {
  const result = parseLockfile(fixture('lockfile/v9/pnpm-lock.yaml'));
  assert.equal(result.supported, true);
  assert.equal(result.version, '9.0');
  assert.deepEqual(Object.keys(result.importers), ['.']);
  assert.deepEqual(result.importers['.'], emptyImporter());
});

test('parses two importers with exact specifiers and resolved versions', () => {
  const result = parseLockfile(fixture('lockfile/v9-workspace/pnpm-lock.yaml'));
  assert.equal(result.supported, true);
  assert.equal(result.version, '9.0');
  assert.deepEqual(Object.keys(result.importers), ['.', 'packages/api']);

  assert.deepEqual(result.importers['.'], {
    specifiers: { 'left-pad': '1.3.0' },
    dependencies: { 'left-pad': { specifier: '1.3.0', version: '1.3.0' } },
    devDependencies: { typescript: { specifier: '5.6.3', version: '5.6.3' } },
    optionalDependencies: { fsevents: { specifier: '2.3.3', version: '2.3.3' } },
    peerDependencies: { react: { specifier: '18.3.1', version: null } },
  });

  assert.deepEqual(result.importers['packages/api'], {
    specifiers: { '@scope/api': '0.1.0', 'left-pad': '^1.3.0' },
    dependencies: {
      'left-pad': { specifier: '^1.3.0', version: '1.3.0' },
      '@scope/api': { specifier: 'workspace:*', version: 'link:../..' },
    },
    devDependencies: {
      '@types/node': { specifier: '22.10.0', version: '22.10.0' },
      typescript: { specifier: '5.6.3', version: '5.6.3' },
    },
    optionalDependencies: {},
    peerDependencies: {},
  });
});

test('reads an importer key and a resolved version with colons unchanged', () => {
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  "packages/web":',
    '    dependencies:',
    '      "@scope/lib":',
    "        specifier: 'workspace:*'",
    '        version: link:../lib',
    '',
  ].join('\n');
  const result = parseLockfile(text);
  assert.equal(result.supported, true);
  assert.deepEqual(result.importers['packages/web'].dependencies, {
    '@scope/lib': { specifier: 'workspace:*', version: 'link:../lib' },
  });
});

test('reads the inline dependency form as a specifier with no resolved version', () => {
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      left-pad: ^1.3.0',
    '',
  ].join('\n');
  const result = parseLockfile(text);
  assert.equal(result.supported, true);
  assert.deepEqual(result.importers['.'].dependencies, {
    'left-pad': { specifier: '^1.3.0', version: null },
  });
});

test('rejects a catalogs section as an unsupported lockfile shape', () => {
  const result = parseLockfile(fixture('lockfile/unsupported-catalogs/pnpm-lock.yaml'));
  assert.equal(result.supported, false);
  assert.equal(result.reason, 'unsupported-lockfile-shape');
  assert.match(result.detail, /"catalogs"/);
  assert.match(result.detail, /line 3/);
});

test('reports a lockfileVersion it does not know by version', () => {
  const result = parseLockfile(["lockfileVersion: '6.0'", '', 'importers:', '', '  .: {}', ''].join('\n'));
  assert.deepEqual(result, {
    supported: false,
    reason: 'unsupported-lockfile-shape',
    detail: 'lockfileVersion "6.0" is not supported',
  });
});

test('rejects an importer entry that is not a map', () => {
  const text = ["lockfileVersion: '9.0'", '', 'importers:', '', '  .: {}', '  packages/api: null', ''].join('\n');
  const result = parseLockfile(text);
  assert.equal(result.supported, false);
  assert.equal(result.reason, 'unsupported-lockfile-shape');
  assert.match(result.detail, /importer "packages\/api"/);
  assert.match(result.detail, /line 6/);
});

test('rejects a snapshots section whose layout is a sequence, not a map', () => {
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .: {}',
    '',
    'snapshots:',
    '',
    '  - left-pad@1.3.0',
    '',
  ].join('\n');
  const result = parseLockfile(text);
  assert.equal(result.supported, false);
  assert.equal(result.reason, 'unsupported-lockfile-shape');
  assert.match(result.detail, /"snapshots"/);
  assert.match(result.detail, /line 9/);
});

test('never throws on a truncated document and reports an unsupported shape', () => {
  const text = fixture('lockfile/v9-workspace/pnpm-lock.yaml');
  const truncated = text.split('\n').slice(0, 8).join('\n');
  const result = parseLockfile(truncated);
  assert.equal(result.supported, false);
  assert.equal(result.reason, 'unsupported-lockfile-shape');
  assert.match(result.detail, /importers/);

  for (const cut of [0, 1, 37, 120, 260]) {
    const partial = parseLockfile(text.slice(0, cut));
    assert.equal(typeof partial.supported, 'boolean');
    if (!partial.supported) assert.equal(partial.reason, 'unsupported-lockfile-shape');
  }
});
