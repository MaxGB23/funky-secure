import test from 'node:test';
import assert from 'node:assert/strict';

import { BEGIN, END } from '../src/lib/managed-block.js';
import {
  trackedNpmrcFacts,
  workspaceBlockFacts,
  writeGitignoreBlock,
  writePackageManagerPin,
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
  assert.equal(
    baseline.content,
    `${BEGIN}\nminimumReleaseAgeStrict: true\nminimumReleaseAge: 1440\nsavePrefix: ''\n${END}\n`,
  );
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

test('a packageManager that is not a string is a conflict, never an absent pin (S1)', () => {
  // `init --apply` rewrote `"packageManager": {"name":"pnpm","version":"10.0.0"}` to
  // `"packageManager": "pnpm@12.3.4"` and exited 0: a value the tool cannot interpret was read as a
  // value the user never wrote, and the user's own bytes were destroyed.
  for (const value of [
    '{"name":"pnpm","version":"10.0.0"}',
    '["pnpm@10.0.0"]',
    'null',
    '10',
    'true',
  ]) {
    const text = `{\n  "name": "object",\n  "packageManager": ${value}\n}\n`;
    const result = writePackageManagerPin({ packageJsonText: text, version: '12.3.4' });

    assert.equal(result.ok, false, `${value} is not a missing pin`);
    assert.equal(result.state, 'conflict');
    assert.equal(result.key, 'packageManager');
    assert.equal(result.content, undefined, 'a refused pin carries no bytes to write');
    assert.equal(
      result.reason,
      `package.json already declares packageManager as ${value}, which is not a string; it is not overwritten`,
    );
  }
});

test('a missing, matching and different pin keep their three answers (W3)', () => {
  const missing = writePackageManagerPin({
    packageJsonText: '{\n  "name": "plain"\n}\n',
    version: '12.3.4',
  });
  assert.equal(missing.state, 'would-write');
  assert.equal(missing.content, '{\n  "name": "plain",\n  "packageManager": "pnpm@12.3.4"\n}\n');

  const text = '{\n  "name": "pinned",\n  "packageManager": "pnpm@12.3.4"\n}\n';
  const same = writePackageManagerPin({ packageJsonText: text, version: '12.3.4' });
  assert.equal(same.state, 'would-skip');
  assert.equal(same.content, text, 'the file keeps its own bytes');

  const different = writePackageManagerPin({
    packageJsonText: '{\n  "name": "other",\n  "packageManager": "npm@10.0.0"\n}\n',
    version: '12.3.4',
  });
  assert.equal(different.state, 'conflict');
  assert.equal(
    different.reason,
    'package.json already declares packageManager "npm@10.0.0"; it is not overwritten',
  );
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
