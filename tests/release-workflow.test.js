import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseWorkflow } from '../src/lib/workflows.js';
import { checkPackList, checkTag } from '../scripts/release-guard.js';

const ROOT = join(import.meta.dirname, '..');
const RELEASE = join(ROOT, '.github', 'workflows', 'release.yml');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** The indented block under a top-level key, comments at column 0 included. */
function topLevelBlock(text, key) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return null;
  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !/^[\s#]/.test(line)) break;
    block.push(line);
  }
  return block.join('\n');
}

test('the release workflow exists', () => {
  assert.doesNotThrow(() => readFileSync(RELEASE, 'utf8'), 'no release workflow: nothing may publish');
});

test('publication is reachable only from a version tag, never from a pull request', () => {
  const text = readFileSync(RELEASE, 'utf8');
  const on = topLevelBlock(text, 'on');

  assert.match(on, /^\s+push:/m, 'the release runs on a push');
  assert.match(on, /^\s+tags:\s*\[?'?v\*'?\]?\s*$/m, 'the push must be a v* tag');
  assert.doesNotMatch(on, /pull_request/, 'a pull request must never reach the publish job');
  assert.doesNotMatch(on, /branches:/, 'a branch push must never reach the publish job');
});

test('the publish job alone may mint an OIDC token, and no npm token exists', () => {
  const text = readFileSync(RELEASE, 'utf8');

  assert.equal((text.match(/id-token:\s*write/g) ?? []).length, 1, 'id-token: write belongs here once');
  for (const token of ['NPM_TOKEN', 'NODE_AUTH_TOKEN', '_authToken', 'npm_token']) {
    assert.doesNotMatch(text, new RegExp(token), `the release must not reference ${token}`);
  }
});

test('every action in the release workflow is pinned to a commit sha', () => {
  const parsed = parseWorkflow(readFileSync(RELEASE, 'utf8'));
  assert.equal(parsed.ok, true, 'the release workflow must be readable by the product own reader');

  const uses = parsed.jobs.flatMap((job) => (job.steps ?? []).map((step) => step.uses).filter(Boolean));
  assert.ok(uses.length > 0, 'the release workflow runs at least one action');
  for (const value of uses) {
    assert.match(value, /^[^@\s]+@[0-9a-f]{40}$/, `${value} is not pinned to a commit sha`);
  }
});

test('the publish step is preceded by the tag check', () => {
  const text = readFileSync(RELEASE, 'utf8');

  assert.match(text, /node scripts\/release-guard\.js --tag/, 'the workflow must pass the tag to the guard');
  assert.match(text, /npm publish --provenance/, 'publication must carry provenance');
  assert.ok(
    text.indexOf('release-guard.js --tag') < text.indexOf('npm publish'),
    'the tag check must run before publication',
  );
});

test('prepublishOnly runs the suite, the self-scan and the packed-file check', () => {
  const script = PACKAGE.scripts.prepublishOnly;

  assert.equal(typeof script, 'string', 'package.json declares no prepublishOnly gate');
  for (const required of ['node --test', 'scan --scope repo --fail-on warn', 'scripts/release-guard.js']) {
    assert.ok(script.includes(required), `prepublishOnly does not run ${required}`);
  }
});

test('a tag is accepted only when it names the package version', () => {
  assert.deepEqual(checkTag('v0.2.0', '0.2.0'), { ok: true, problems: [] });
  assert.match(checkTag('v0.2.1', '0.2.0').problems[0], /v0\.2\.1 does not name version 0\.2\.0/);
  assert.match(checkTag('0.2.0', '0.2.0').problems[0], /not vX\.Y\.Z/);
  assert.equal(checkTag('v0.2.0-rc.1', '0.2.0-rc.1').ok, true, 'a prerelease tag names a prerelease version');
});

test('the packed file list is the files contract, and nothing else', () => {
  const allowed = PACKAGE.files;

  assert.deepEqual(
    checkPackList(['package.json', 'LICENSE', 'README.md', 'bin/funky-secure.js', 'src/cli.js', 'docs/cli.md'], allowed),
    { ok: true, problems: [] },
  );

  for (const unwanted of ['tests/cli.test.js', 'odd/tasks/funky-secure-v0.2.md', '.env', 'node_modules/x/index.js', 'pnpm-lock.yaml']) {
    const { ok, problems } = checkPackList(['package.json', unwanted], allowed);
    assert.equal(ok, false, `${unwanted} must not ship`);
    assert.match(problems[0], /must not ship/);
  }
});
