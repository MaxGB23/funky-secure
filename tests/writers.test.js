import test from 'node:test';
import assert from 'node:assert/strict';

import { BEGIN, END } from '../src/lib/managed-block.js';
import {
  trackedNpmrcFacts,
  workspaceBlockFacts,
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

test('workspaceBlockFacts reads the managed block, never a key declared outside it', () => {
  const block = [BEGIN, 'minimumReleaseAgeStrict: true', "savePrefix: ''", END, ''].join('\n');

  assert.deepEqual(workspaceBlockFacts(block), { gate: true, savePrefix: true });
  assert.deepEqual(workspaceBlockFacts(null), { gate: false, savePrefix: false });
  // The same key outside the block is not a declaration of the block: it is the duplicate source the
  // write refuses, never a reason to plan nothing.
  assert.deepEqual(workspaceBlockFacts('minimumReleaseAgeStrict: true\n'), {
    gate: false,
    savePrefix: false,
  });
  assert.deepEqual(workspaceBlockFacts(`${BEGIN}\nminimumReleaseAgeStrict: false\n${END}\n`), {
    gate: false,
    savePrefix: false,
  });
});

test('writeQuarantineGate always carries savePrefix in the same block (W1c)', () => {
  const baseline = writeQuarantineGate({});
  assert.equal(baseline.ok, true);
  assert.equal(baseline.content, `${BEGIN}\nminimumReleaseAgeStrict: true\nsavePrefix: ''\n${END}\n`);
  assert.match(baseline.reason, /caret/);

  const strict = writeQuarantineGate({ preset: 'strict' });
  assert.equal(strict.ok, true);
  assert.equal(
    strict.content,
    `${BEGIN}\nminimumReleaseAgeStrict: true\nminimumReleaseAge: 4320\nsavePrefix: ''\n${END}\n`,
  );
});

test('a savePrefix declared outside the block is a conflict, never a second source (W1c)', () => {
  const result = writeQuarantineGate({ workspaceYaml: "savePrefix: '^'\n" });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'conflict');
  assert.equal(result.key, 'savePrefix');
  assert.equal(
    result.reason,
    'pnpm-workspace.yaml already declares savePrefix outside the managed block; two sources for one setting are not written',
  );
});

test('a block that already carries every key is a would-skip with the file own bytes', () => {
  const text = `${BEGIN}\nminimumReleaseAgeStrict: true\nminimumReleaseAge: 4320\nsavePrefix: ''\n${END}\n`;
  const result = writeQuarantineGate({ workspaceYaml: text, exists: true, preset: 'strict' });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'would-skip');
  assert.equal(result.content, text);
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
