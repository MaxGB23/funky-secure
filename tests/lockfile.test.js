import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLockfile, recordedVersion, overrideTouches } from '../src/lib/lockfile.js';

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

test('reads the pnpm 8 root shape (lockfileVersion 6.0) as the root importer', () => {
  // A slice of vercel/nextjs-subscription-payments' pnpm-lock.yaml, verbatim: pnpm 8 records the root
  // importer at the top level, with no `importers:` map, and every specifier sits beside the version
  // it resolved to. Reading it as unsupported threw away all 26 of that repository's addresses.
  const text = [
    "lockfileVersion: '6.0'",
    '',
    'settings:',
    '  autoInstallPeers: true',
    '  excludeLinksFromLockfile: false',
    '',
    'dependencies:',
    "  '@radix-ui/react-toast':",
    '    specifier: ^1.1.5',
    '    version: 1.1.5(@types/react-dom@18.3.0)(@types/react@18.3.3)(react-dom@18.3.1)(react@18.3.1)',
    "  '@stripe/stripe-js':",
    '    specifier: 2.4.0',
    '    version: 2.4.0',
    '  next:',
    '    specifier: 14.2.3',
    '    version: 14.2.3(react-dom@18.3.1)(react@18.3.1)',
    '',
    'devDependencies:',
    "  '@types/node':",
    '    specifier: ^20.14.2',
    '    version: 20.14.2',
    '  autoprefixer:',
    '    specifier: ^10.4.19',
    '    version: 10.4.19(postcss@8.4.38)',
    '',
    'packages:',
    '',
    '  /@aashutoshrathi/word-wrap@1.2.6:',
    '    resolution: {integrity: sha512-1Yjs2SvM8TflER/OD3cOjhWWOZb58A2t7wpE2S9XfBYTiIl+XFhQG2bjy4Pu1I+EAlCNUzRDYDdFwFYUKvXcIA==}',
    "    engines: {node: '>=0.10.0'}",
    '    dev: true',
    '',
    '  /@next/swc-wasm-nodejs@15.5.4:',
    '    resolution: {integrity: sha512-AAAA}',
    '    bundledDependencies:',
    "      - '@napi-rs/wasm-runtime'",
    '      - tslib',
    '',
  ].join('\n');

  const result = parseLockfile(text);

  assert.equal(result.supported, true);
  assert.equal(result.version, '6.0');
  assert.deepEqual(Object.keys(result.importers), ['.']);

  const root = result.importers['.'];
  assert.deepEqual(root.dependencies['@stripe/stripe-js'], { specifier: '2.4.0', version: '2.4.0' });
  assert.deepEqual(root.devDependencies['@types/node'], { specifier: '^20.14.2', version: '20.14.2' });
  // 0014 still holds in this shape: the recorded version is the bare version, never the snapshot.
  assert.equal(recordedVersion(root, '@radix-ui/react-toast', 'dependencies'), '1.1.5');
  assert.equal(recordedVersion(root, 'next', 'dependencies'), '14.2.3');
  assert.equal(recordedVersion(root, 'autoprefixer', 'devDependencies'), '10.4.19');
  assert.deepEqual(root.specifiers, {});
  assert.deepEqual(root.peerDependencies, {});
});

test('refuses a document that describes the root importer twice', () => {
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'dependencies:',
    '  left-pad:',
    '    specifier: 1.3.0',
    '    version: 1.3.0',
    '',
    'importers:',
    '',
    '  .: {}',
    '',
  ].join('\n');

  const result = parseLockfile(text);

  assert.equal(result.supported, false);
  assert.match(result.detail, /root importer/);
});

test('reports a lockfileVersion it does not know by version', () => {
  const result = parseLockfile(["lockfileVersion: '8.0'", '', 'importers:', '', '  .: {}', ''].join('\n'));
  assert.deepEqual(result, {
    supported: false,
    reason: 'unsupported-lockfile-shape',
    detail: 'lockfileVersion "8.0" is not supported',
  });
});

test('reads a catalogs section, so the importer comparison no longer needs to be refused', () => {
  const result = parseLockfile(fixture('lockfile/unsupported-catalogs/pnpm-lock.yaml'));

  assert.equal(result.supported, true);
  assert.deepEqual(result.catalogs, {
    default: { 'left-pad': { specifier: '^1.3.0', version: '1.3.0' } },
  });
  assert.equal(result.importers['.'].dependencies['left-pad'].specifier, 'catalog:');
});

test('reads the named and default catalogues a workspace lockfile records', () => {
  // primefaces/primevue pnpm-lock.yaml lines 7-55, verbatim: a `default` map and named ones.
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'catalogs:',
    '  app:',
    "    '@docsearch/js':",
    '      specifier: ^3',
    '      version: 3.9.0',
    '    chart.js:',
    '      specifier: 3.3.2',
    '      version: 3.3.2',
    '  default:',
    "    '@primeuix/forms':",
    '      specifier: ^0.1.0',
    '      version: 0.1.0',
    '    primeicons:',
    '      specifier: ^7.0.0',
    '      version: 7.0.0',
    '',
    'importers:',
    '',
    '  .: {}',
    '',
  ].join('\n');

  const result = parseLockfile(text);

  assert.equal(result.supported, true);
  assert.deepEqual(Object.keys(result.catalogs), ['app', 'default']);
  assert.deepEqual(result.catalogs.app['chart.js'], { specifier: '3.3.2', version: '3.3.2' });
  assert.deepEqual(result.catalogs.app['@docsearch/js'], { specifier: '^3', version: '3.9.0' });
  assert.deepEqual(result.catalogs.default['primeicons'], { specifier: '^7.0.0', version: '7.0.0' });
});

test('refuses a catalogue entry that is not the {specifier, version} map pnpm writes', () => {
  // A scalar entry cannot say whether the value is the declared range or the resolution, so it is
  // refused by name. Guessing either way would put a range where a pin belongs (RFC 4.9).
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'catalogs:',
    '  default:',
    '    react: 18.3.1',
    '',
    'importers:',
    '',
    '  .: {}',
    '',
  ].join('\n');

  const result = parseLockfile(text);

  assert.equal(result.supported, false);
  assert.equal(result.reason, 'unsupported-lockfile-shape');
  assert.match(result.detail, /"catalogs"/);
  assert.match(result.detail, /"react"/);
  assert.match(result.detail, /line 5/);
});

test('reads overrides as the dependency names an override can rewrite', () => {
  // shadcn-ui/ui pnpm-lock.yaml lines 1-10, verbatim: an `overrides` section rewrites a specifier, so
  // the importer record disagrees with the manifest by construction, and `packageExtensionsChecksum`
  // is a scalar the reader must accept rather than refuse as an unknown key.
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'settings:',
    '  autoInstallPeers: true',
    '  excludeLinksFromLockfile: false',
    '',
    'overrides:',
    "  '@types/react': 19.2.2",
    "  '@types/react-dom': 19.2.2",
    '',
    'packageExtensionsChecksum: sha256-5xwqV0Xm0bna/9c3RXU7OvpTUl7eZ8rqa4Oaoj+NAFs=',
    '',
    'importers:',
    '',
    '  .: {}',
    '',
  ].join('\n');

  const result = parseLockfile(text);

  assert.equal(result.supported, true);
  assert.deepEqual(result.overrides, ['@types/react', '@types/react-dom']);
});

test('an override selector states the dependency it rewrites', () => {
  // pnpm's override selector grammar: `name`, `name@range` and `parent>child`, where a range can
  // itself carry a `>` (`>=1`). The comparison asks one question of it, and it errs towards exempting:
  // an exemption that is too wide loses a finding, the other way round invents one.
  const selectors = ['react@^18.3.1>react-dom', '@scope/pkg@>=1', '@types/react'];

  assert.equal(overrideTouches(selectors, 'react-dom'), true);
  assert.equal(overrideTouches(selectors, '@scope/pkg'), true);
  assert.equal(overrideTouches(selectors, '@types/react'), true);
  assert.equal(overrideTouches(selectors, 'react'), false, 'a parent selector is not the rewritten dependency');
  assert.equal(overrideTouches(selectors, '@types/react-dom'), false);
  assert.equal(overrideTouches([], 'left-pad'), false);
});

test('reads an override selector as it is written, so the grammar stays in one place', () => {
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'overrides:',
    "  'react@^18.3.1>react-dom': 18.3.1",
    "  '@scope/pkg@>=1': 1.0.0",
    '',
    'importers:',
    '',
    '  .: {}',
    '',
  ].join('\n');

  const result = parseLockfile(text);

  assert.equal(result.supported, true);
  assert.deepEqual(result.overrides, ['react@^18.3.1>react-dom', '@scope/pkg@>=1']);
});

test('still refuses a patchedDependencies section, whose effect is not the importer subset', () => {
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'patchedDependencies:',
    "  'left-pad@1.3.0': patches/left-pad@1.3.0.patch",
    '',
    'importers:',
    '',
    '  .: {}',
    '',
  ].join('\n');

  const result = parseLockfile(text);

  assert.equal(result.supported, false);
  assert.equal(result.reason, 'unsupported-lockfile-shape');
  assert.match(result.detail, /"patchedDependencies"/);
  assert.match(result.detail, /line 3/);
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

test('reads a packages entry that carries a list value, as a real lockfile does', () => {
  // Next ships its wasm swc build with bundledDependencies written as a YAML sequence. The sequence
  // is inside an ignored section, so it cannot change what an importer specifier resolves to.
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    "      '@next/swc-wasm-nodejs':",
    '        specifier: 15.5.4',
    '        version: 15.5.4',
    '',
    'packages:',
    '',
    "  '@next/swc-wasm-nodejs@15.5.4':",
    '    resolution: {integrity: sha512-AAAA}',
    '    cpu: [wasm32]',
    '    bundledDependencies:',
    "      - '@napi-rs/wasm-runtime'",
    '      - tslib',
    '',
  ].join('\n');

  const result = parseLockfile(text);

  assert.equal(result.supported, true);
  assert.equal(recordedVersion(result.importers['.'], '@next/swc-wasm-nodejs', 'dependencies'), '15.5.4');
});

test('reads a snapshots entry that carries a list value, as a real lockfile does', () => {
  // vitest and its siblings record transitivePeerDependencies as a sequence; this shape used to make
  // every dependency comparison in the repository return a skip.
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    devDependencies:',
    '      vitest:',
    '        specifier: 4.1.10',
    '        version: 4.1.10',
    '',
    'snapshots:',
    '',
    '  vitest@4.1.10:',
    '    dependencies:',
    '      siginfo: 2.0.0',
    '    transitivePeerDependencies:',
    '      - msw',
    '',
  ].join('\n');

  const result = parseLockfile(text);

  assert.equal(result.supported, true);
  assert.equal(recordedVersion(result.importers['.'], 'vitest', 'devDependencies'), '4.1.10');
});

test('reads a version that records its peer suffix as the bare version', () => {
  // pnpm writes `version: 6.3.1(react-dom@19.2.3(react@19.2.3))(...)` for anything resolved with peers,
  // which is most of a real dependency set. The suffix describes the snapshot, not the version, so a
  // specifier must never carry it (0014).
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      eslint:',
    '        specifier: 9.39.5',
    '        version: 9.39.5(jiti@2.7.0)(supports-color@7.2.0)',
    '      next:',
    '        specifier: 16.0.10',
    '        version: 16.0.10(react-dom@19.2.3(react@19.2.3))(react@19.2.3)',
    '',
  ].join('\n');

  const result = parseLockfile(text);

  assert.equal(result.supported, true);
  assert.equal(recordedVersion(result.importers['.'], 'eslint', 'dependencies'), '9.39.5');
  assert.equal(recordedVersion(result.importers['.'], 'next', 'dependencies'), '16.0.10');
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

test('refuses a document that ends inside a block (S7)', () => {
  // A truncated lockfile used to be accepted as supported: the reader stops at the importer subset it
  // needs, and an ignored section is never modeled, so `packages:` with half its tail missing was
  // invisible and the rule compared every specifier against an incomplete document.
  const lines = fixture('lockfile/v9-workspace/pnpm-lock.yaml').split('\n');

  const header = parseLockfile(lines.slice(0, 46).join('\n'));
  assert.equal(header.supported, false, 'a section header with nothing under it is a truncation');
  assert.equal(header.reason, 'unsupported-lockfile-shape');
  assert.match(header.detail, /ends inside a block/);
  assert.match(header.detail, /"packages"/);
  assert.match(header.detail, /line 46/);

  const entry = parseLockfile(lines.slice(0, 48).join('\n'));
  assert.equal(entry.supported, false, 'a block that opens and never closes is a truncation');
  assert.match(entry.detail, /ends inside a block/);
  assert.match(entry.detail, /"left-pad@1\.3\.0"/);
  assert.match(entry.detail, /line 48/);
});

test('refuses a flow collection a truncated document leaves open (S7)', () => {
  const text = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .: {}',
    '',
    'packages:',
    '',
    '  left-pad@1.3.0:',
    '    resolution: {integrity: sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bFlCBy/aVx2HrNcqQGsdot8ghrjyrvMCoEA==',
    '',
  ].join('\n');

  const result = parseLockfile(text);

  assert.equal(result.supported, false);
  assert.equal(result.reason, 'unsupported-lockfile-shape');
  assert.match(result.detail, /never closed/);
  assert.match(result.detail, /line 10/);
});

test('reads every fixture lockfile as supported, so refusing truncation refuses nothing else', () => {
  for (const name of ['lockfile/v9', 'lockfile/v9-workspace', 'lockfile/unsupported-catalogs']) {
    const result = parseLockfile(fixture(`${name}/pnpm-lock.yaml`));
    assert.equal(result.supported, true, `${name} is a valid lockfile and must stay readable`);
  }
});
