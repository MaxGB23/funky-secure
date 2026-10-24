import test from 'node:test';
import assert from 'node:assert/strict';

import {
  trackedNpmrcFacts,
  writeGitignoreBlock,
  writeQuarantineGate,
} from '../src/lib/writers.js';

const TOKENLESS = { tracked: true, hasToken: false, tokenlessTracked: true };
const UNREAD_TOKEN = { tracked: true, hasToken: false, tokenlessTracked: false };

test('writeGitignoreBlock keeps .npmrc when the tracked file was never read', () => {
  const result = writeGitignoreBlock({ trackedNpmrc: UNREAD_TOKEN });

  assert.equal(result.ok, true);
  assert.match(result.content, /^\.npmrc$/m, 'an unread file is not evidence of a tokenless one');
});

test('writeGitignoreBlock omits .npmrc only for a tokenless tracked file', () => {
  const result = writeGitignoreBlock({ trackedNpmrc: TOKENLESS });

  assert.equal(result.ok, true);
  assert.ok(!/^\.npmrc$/m.test(result.content));
});

test('an existing but unreadable target is a conflict, never a fresh write', () => {
  for (const result of [
    writeGitignoreBlock({ gitignore: null, exists: true }),
    writeQuarantineGate({ workspaceYaml: null, exists: true }),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.state, 'conflict');
    assert.match(result.reason, /could not be read/);
  }
});

test('a token written with spaces around the equals sign is not a tokenless file', () => {
  const facts = trackedNpmrcFacts({
    repo: {
      npmrc: null,
      tracked: new Set(['.npmrc']),
      files: { npmrc: { text: '_authToken = ghp_secret\n' } },
    },
  });

  assert.deepEqual(facts, { tracked: true, hasToken: true, tokenlessTracked: false });
});
