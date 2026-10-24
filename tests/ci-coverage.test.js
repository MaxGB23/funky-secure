import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CI = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('every text file is checked out with LF on every platform', () => {
  const attributes = readFileSync(join(ROOT, '.gitattributes'), 'utf8');

  assert.match(
    attributes,
    /^\* text=auto eol=lf$/m,
    'without this line a CRLF checkout fails the golden gate for a reason that is not the code',
  );
});

test('the suite runs on the two platforms the code branches on', () => {
  for (const os of ['ubuntu-latest', 'windows-latest']) {
    assert.ok(CI.includes(os), `CI never runs on ${os}, so its code path is not gated`);
  }
});

test('the suite runs at the Node floor the package declares and at the current LTS', () => {
  const floor = />=(\d+\.\d+)/.exec(PACKAGE.engines.node)?.[1];
  assert.ok(floor, 'package.json declares no engines.node floor');

  const declared = /node:\s*\[([^\]]+)\]/.exec(CI);
  assert.ok(declared, 'CI declares no node matrix');
  const versions = declared[1].split(',').map((version) => version.trim());

  assert.ok(versions.includes(floor), `CI never runs the declared floor ${floor}: ${versions.join(', ')}`);
  assert.ok(versions.includes('22'), `CI never runs Node 22: ${versions.join(', ')}`);
});
