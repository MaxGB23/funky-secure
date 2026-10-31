import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { run } from '../src/cli.js';
import { FOREIGN_PIN_FLAG } from '../src/lib/foreign-pin.js';
import { BEGIN, END } from '../src/lib/managed-block.js';
import { derivePinNextSteps } from '../src/lib/plan.js';
import {
  trackedNpmrcFacts,
  workspaceBlockFacts,
  writeDevEnginesPackageManager,
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

test('the guard is written beside the pin and never carries onFail (W3b)', () => {
  // RFC 0030: npm treats the absent value as `error` and pnpm's default is its own version switch, so
  // any explicit `onFail` is a regression for one of the two managers. The key is omitted, not set to a
  // value that happens to work on one of them.
  const result = writeDevEnginesPackageManager({
    packageJsonText: '{\n  "name": "plain"\n}\n',
    version: '12.3.4',
  });

  assert.equal(result.ok, true);
  assert.equal(result.operation, 'set devEngines.packageManager');
  assert.equal(result.state, 'would-write');
  assert.equal(
    result.content,
    '{\n  "name": "plain",\n  "devEngines": {\n    "packageManager": {\n      "name": "pnpm",\n      "version": "12.3.4"\n    }\n  }\n}\n',
  );
  const written = JSON.parse(result.content).devEngines.packageManager;
  assert.deepEqual(written, { name: 'pnpm', version: '12.3.4' });
  assert.equal(Object.hasOwn(written, 'onFail'), false, 'the key is absent, never a value');
});

test('the guard keeps every other devEngines key and every other manifest key (W3b)', () => {
  const text = `{
  "name": "guarded",
  "private": true,
  "scripts": {
    "build": "next build"
  },
  "devEngines": {
    "runtime": {
      "name": "node",
      "version": ">=22"
    }
  }
}
`;

  const result = writeDevEnginesPackageManager({ packageJsonText: text, version: '12.3.4' });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'would-write');
  assert.ok(result.content.startsWith('{\n  "name"'), 'the manifest keeps its own indentation');
  assert.ok(result.content.endsWith('}\n'), 'and its trailing newline');
  assert.deepEqual(JSON.parse(result.content), {
    name: 'guarded',
    private: true,
    scripts: { build: 'next build' },
    devEngines: {
      runtime: { name: 'node', version: '>=22' },
      packageManager: { name: 'pnpm', version: '12.3.4' },
    },
  });
});

test('a guard already equal to the pin is already at policy and keeps the file bytes (W3b)', () => {
  const text = `{
  "name": "guarded",
  "devEngines": {
    "packageManager": {
      "name": "pnpm",
      "version": "12.3.4"
    }
  }
}
`;

  const result = writeDevEnginesPackageManager({ packageJsonText: text, version: '12.3.4' });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'would-skip');
  assert.equal(result.content, text, 'the file keeps its own bytes');
  assert.equal(result.reason, 'package.json already declares devEngines.packageManager "pnpm@12.3.4"');
});

test('a guard equal in name and version is already at policy whatever onFail says (W3b)', () => {
  // `pnpm init` writes `onFail: "download"`. The pair this writer owns is the name and the version, so
  // a matching pair is the equal state, and the key is left exactly as the manifest wrote it: writing
  // anything there is a regression for one of the two managers (0030).
  for (const text of [
    '{\n  "name": "guarded",\n  "devEngines": {\n    "packageManager": {\n      "name": "pnpm",\n      "version": "12.3.4",\n      "onFail": "download"\n    }\n  }\n}\n',
    '{\n  "name": "guarded",\n  "devEngines": {\n    "packageManager": {\n      "version": "12.3.4",\n      "name": "pnpm",\n      "onFail": "error"\n    }\n  }\n}\n',
  ]) {
    const result = writeDevEnginesPackageManager({ packageJsonText: text, version: '12.3.4' });

    assert.equal(result.ok, true);
    assert.equal(result.state, 'would-skip');
    assert.equal(result.content, text, 'the field keeps its own keys and its own bytes');
  }
});

test('a declared guard that differs is a conflict that names the value found (W3b)', () => {
  // A value the tool cannot interpret is never treated as absent (0027, decision I-58). Every shape
  // below is something a human wrote, and the writer has no business replacing it.
  const target = '{"name":"pnpm","version":"12.3.4"}';

  for (const value of [
    '"pnpm@12.3.4"',
    '12',
    'null',
    '["pnpm@12.3.4"]',
    '{"version":"12.3.4"}',
    '{"name":"pnpm"}',
    '{"name":"yarn","version":"4.0.0"}',
    '{"name":"pnpm","version":"12.16.0"}',
  ]) {
    const text = `{\n  "name": "declared",\n  "devEngines": {\n    "packageManager": ${value}\n  }\n}\n`;
    const result = writeDevEnginesPackageManager({ packageJsonText: text, version: '12.3.4' });

    assert.equal(result.ok, false, `${value} is not a missing guard`);
    assert.equal(result.state, 'conflict');
    assert.equal(result.key, 'devEngines.packageManager');
    assert.equal(result.content, undefined, 'a refused guard carries no bytes to write');
    assert.equal(
      result.reason,
      `package.json already declares devEngines.packageManager as ${JSON.stringify(JSON.parse(value))}; it is not overwritten with ${target}`,
    );
  }
});

test('a devEngines that is not an object is a conflict, never an absent guard (W3b)', () => {
  for (const value of ['"npm"', '10', 'null', '[]']) {
    const text = `{\n  "name": "shaped",\n  "devEngines": ${value}\n}\n`;
    const result = writeDevEnginesPackageManager({ packageJsonText: text, version: '12.3.4' });

    assert.equal(result.ok, false, `${value} is not an absent devEngines`);
    assert.equal(result.state, 'conflict');
    assert.equal(result.key, 'devEngines');
    assert.equal(result.content, undefined);
    assert.equal(
      result.reason,
      `package.json already declares devEngines as ${JSON.stringify(JSON.parse(value))}, which is not an object; it is not overwritten`,
    );
  }
});

test('the guard is never written without a version the pin establishes (W3b)', () => {
  const missing = writeDevEnginesPackageManager({
    packageJsonText: '{\n  "name": "no-version"\n}\n',
    version: null,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.state, 'conflict');
  assert.equal(missing.reason, 'no pnpm version answered, so there is no devEngines.packageManager to write');

  const unreadable = writeDevEnginesPackageManager({ packageJsonText: null, version: '12.3.4' });
  assert.equal(unreadable.ok, false);
  assert.equal(unreadable.state, 'conflict');
  assert.equal(unreadable.reason, 'package.json could not be read, so devEngines.packageManager cannot be written');
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

/**
 * The injected collector for the drift test below: reads the real files the test placed and answers
 * the closed git probes from the test's declared state. Nothing is spawned.
 */
function fakeCollector({ root, tracked = [] }) {
  const ok = (stdout) => ({ ok: true, code: 0, stdout, stderr: '' });
  return {
    read: async (path) => {
      try {
        return { ok: true, value: readFileSync(path, 'utf8') };
      } catch (error) {
        return { ok: false, error };
      }
    },
    git: async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return ok(`${root}\n`);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return ok('feat/test\n');
      if (args[0] === 'ls-files') return ok(tracked.map((path) => `${path}\0`).join(''));
      if (args[0] === 'status') return ok('');
      return { ok: true, code: 1, stdout: '', stderr: '' };
    },
    pnpmVersion: async () => ({ ok: false, reason: 'not-on-path', installations: [] }),
    pnpmConfig: async () => ({ ok: false, reason: 'not-on-path' }),
  };
}

function capture() {
  return {
    text: '',
    write(chunk) {
      this.text += chunk;
      return true;
    },
    isTTY: false,
  };
}

/** Every pnpm command a rendering prints, without the trailing comment `migrate` adds. */
function pnpmCommands(text) {
  return [...text.matchAll(/pnpm (?:import|add|install)[^\n]*/g)].map((match) =>
    match[0].split(/\s{2,}#/)[0].trim(),
  );
}

test('one module owns the foreign-pin flag, so the three producers cannot disagree (issue 132)', async (t) => {
  // The flag was defined twice — once in `start` and once in `migrate` — and the two writers' next
  // steps printed the resolve without it. Two copies of a predicate is how the answers drift apart,
  // so the literal is allowed in exactly one module and every producer imports that one.
  const src = join(import.meta.dirname, '..', 'src');
  const offenders = [];
  for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    if (entry.name === 'foreign-pin.js') continue;
    if (readFileSync(path, 'utf8').includes(FOREIGN_PIN_FLAG)) {
      offenders.push(path.slice(src.length + 1).split(sep).join('/'));
    }
  }
  assert.deepEqual(offenders, [], 'the flag is written in more than one module, so two copies can drift');

  for (const manager of ['npm@11.13.0', 'pnpm@12.3.4']) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-foreign-pin-')));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const manifest = `${JSON.stringify(
      { name: 'app', private: true, packageManager: manager, dependencies: { next: '^15.5.4' } },
      null,
      2,
    )}\n`;
    writeFileSync(join(dir, 'package.json'), manifest);
    writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion": 3}\n');

    const repo = {
      root: dir,
      present: ['package.json', 'package-lock.json'],
      files: { packageJson: { json: JSON.parse(manifest) } },
    };
    const [pinStep] = derivePinNextSteps({ repo });
    assert.equal(pinStep, `pnpm install --lockfile-only${manager === 'npm@11.13.0' ? ` ${FOREIGN_PIN_FLAG}` : ''}`);

    for (const argv of [['start'], ['migrate']]) {
      const stdout = capture();
      const collector = fakeCollector({ root: dir, tracked: ['package.json', 'package-lock.json'] });
      assert.equal(await run(argv, { cwd: dir, env: {}, stdout, stderr: capture(), collector }), 0);
      const printed = pnpmCommands(stdout.text);
      assert.ok(printed.length > 0, `${argv[0]} printed no pnpm command over ${manager}`);
      // Every pnpm command the two commands print carries the same suffix the pin step carries: one
      // manifest, one answer, whichever line the reader obeys.
      const suffix = pinStep.slice('pnpm install --lockfile-only'.length);
      for (const command of printed) {
        assert.equal(
          command.endsWith(suffix),
          true,
          `${argv[0]} printed "${command}" where the pin step is "${pinStep}"`,
        );
      }
      if (argv[0] === 'start') {
        assert.ok(printed.includes(pinStep), `start does not print the resolve "${pinStep}"`);
      }
    }
  }
});
