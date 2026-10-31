import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { packedFilename } from '../scripts/pack-smoke.js';

const ROOT = join(import.meta.dirname, '..');
const PACK_SMOKE = join(ROOT, 'scripts', 'pack-smoke.js');

/**
 * What `npm pack --pack-destination <dir> --json` writes: an array of one entry. Measured against
 * this repository with npm 11.15.0; the fields the smoke test does not read are kept because the
 * shape is the point of the test, and a trimmed one would pass a parser the real output fails.
 */
const PACKED = [
  {
    id: 'funky-secure@0.10.0',
    name: 'funky-secure',
    version: '0.10.0',
    size: 335570,
    unpackedSize: 728688,
    shasum: 'c885c824a78b056440e41e749a13a09048d06066',
    integrity: 'sha512-8H2tX+tW1ve8pcYHwaHsVkxI21ve9vELA45qv4YjDfCxiqpKpL5bjdndhl9AWUMJ7FZWSIPiIBuBcpNnRTO44A==',
    filename: 'funky-secure-0.10.0.tgz',
    files: [{ path: 'package.json', size: 1419, mode: 420 }],
    entryCount: 1,
    bundled: [],
  },
];

test('reads the tarball name from the JSON array npm writes', () => {
  assert.equal(packedFilename(JSON.stringify(PACKED, null, 2)), 'funky-secure-0.10.0.tgz');
  assert.equal(packedFilename(JSON.stringify(PACKED)), 'funky-secure-0.10.0.tgz');
});

test('names the problem instead of handing a downstream join a filename it does not have', () => {
  for (const stdout of [
    JSON.stringify([]),
    JSON.stringify([{ name: 'funky-secure', version: '0.10.0' }]),
    JSON.stringify({ filename: 'funky-secure-0.10.0.tgz' }),
  ]) {
    assert.throws(
      () => packedFilename(stdout),
      (error) => /^npm pack /.test(error.message) && !error.message.includes('\n'),
      `expected a one-line npm pack error for ${stdout}`,
    );
  }
});

test('asks npm for JSON, so the invoking npm config cannot change the output shape', () => {
  const line = readFileSync(PACK_SMOKE, 'utf8')
    .split('\n')
    .filter((text) => !/^\s*(\*|\/\/|\/\*)/.test(text))
    .find((text) => text.includes("'pack'"));

  assert.ok(line, 'scripts/pack-smoke.js must call npm pack');
  assert.match(line, /'--json'/, 'the npm pack invocation must pass --json');
  assert.match(line, /'--pack-destination'/, 'the tarball still lands in the scratch directory, not the repository');
});
