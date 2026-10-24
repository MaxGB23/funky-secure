import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CI = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const RELEASE = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** The Active LTS at the time this policy was written; bumped deliberately, like an action pin. */
const ACTIVE_LTS = '24';

/** The two platforms the product branches on. */
const PLATFORMS = ['ubuntu-24.04', 'windows-2025'];

/** The binary extensions marked in `.gitattributes`. */
const BINARY_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'woff', 'woff2', 'pdf', 'zip'];

test('every text file is checked out with LF on every platform', () => {
  const attributes = readFileSync(join(ROOT, '.gitattributes'), 'utf8');

  assert.match(
    attributes,
    /^\* text=auto eol=lf$/m,
    'without this line a CRLF checkout fails the golden gate for a reason that is not the code',
  );
});

test('the binary extensions the package may ship are marked binary', () => {
  const attributes = readFileSync(join(ROOT, '.gitattributes'), 'utf8');

  for (const extension of BINARY_EXTENSIONS) {
    assert.ok(
      attributes.includes(`*.${extension} binary`),
      `.${extension} is not marked binary, so git would normalise it as text`,
    );
  }
});

test('the suite runs on the two platforms the code branches on, by exact image label', () => {
  for (const label of PLATFORMS) {
    assert.ok(CI.includes(label), `CI never runs on ${label}, so its code path is not gated`);
  }

  assert.doesNotMatch(
    CI,
    /runs-on:\s*\S*-latest/,
    'a floating runner label lets the vendor migrate the image under us',
  );
});

test('the suite runs at the Node floor the package declares and at the Active LTS', () => {
  const floor = />=(\d+)/.exec(PACKAGE.engines.node)?.[1];
  assert.ok(floor, 'package.json declares no engines.node floor');

  const declared = /node:\s*\[([^\]]+)\]/.exec(CI);
  assert.ok(declared, 'CI declares no node matrix');
  const versions = declared[1].split(',').map((version) => version.trim());

  assert.ok(versions.includes(floor), `CI never runs the declared floor ${floor}: ${versions.join(', ')}`);
  assert.ok(
    versions.includes(ACTIVE_LTS),
    `CI never runs the Active LTS ${ACTIVE_LTS}: ${versions.join(', ')}`,
  );
  assert.ok(
    !versions.includes('20'),
    'an end-of-life line is not a promise this package can keep, so it is not in the matrix',
  );
});

test('every workflow fetches the newest patch of its runtime line', () => {
  for (const [name, text] of [
    ['ci.yml', CI],
    ['release.yml', RELEASE],
  ]) {
    assert.match(
      text,
      /^\s+check-latest: true$/m,
      `${name} does not set check-latest, so setup-node may use the patch cached in the image`,
    );
  }
});

test('every action is pinned by full commit sha and says which release it is', () => {
  for (const [name, text] of [
    ['ci.yml', CI],
    ['release.yml', RELEASE],
  ]) {
    const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
    assert.ok(uses.length > 0, `${name} uses no action`);

    for (const value of uses) {
      assert.match(value, /^[^@\s]+@[0-9a-f]{40}$/, `${name}: ${value} is not pinned to a commit sha`);
      assert.ok(
        text.includes(`${value} # v`),
        `${name}: ${value} carries no trailing release comment, so the pin cannot be reviewed`,
      );
    }
  }
});
