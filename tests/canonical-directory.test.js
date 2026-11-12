import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/funky-secure.js', import.meta.url));
// The identity the suite's other commits use: this machine carries a global hook that refuses any
// other author, and a test that fails on the developer's git config is a test nobody keeps running.
const IDENTITY = [
  '-c',
  'user.email=82458865+MaxGB23@users.noreply.github.com',
  '-c',
  'user.name=MaxGB23',
];

/**
 * A repository a generator left behind, with work in the tree that no commit records. The directory
 * name is long on purpose: a volume that assigns 8.3 names gives it a second, shorter spelling, which
 * is the condition this file exists to cover.
 *
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function generatorLeftover(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-canonical-directory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const dependencies = { next: '^15.5.4', react: '^19.2.0', 'react-dom': '^19.2.0' };
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'app', private: true, dependencies }, null, 2)}\n`,
  );
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app', 'page.jsx'), 'export default function Page() {\n  return null;\n}\n');
  writeFileSync(join(dir, '.gitignore'), '# deps\n/node_modules\n# next.js\n/.next/\n/out/\n/build\n');
  writeFileSync(
    join(dir, 'package-lock.json'),
    `${JSON.stringify(
      { name: 'app', lockfileVersion: 3, requires: true, packages: { '': { name: 'app', dependencies } } },
      null,
      2,
    )}\n`,
  );

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', [...IDENTITY, 'commit', '-qm', 'generated'], { cwd: dir });
  appendFileSync(join(dir, 'package.json'), '\n');
  return dir;
}

/** The numbered step lines of a rendered plan. @param {string} text */
function stepLines(text) {
  return text
    .split('\n')
    .filter((line) => /^\s+\d+\s+\S/.test(line))
    .map((line) => line.trimEnd());
}

test('the plan does not depend on how the directory it was asked from is spelled', async (t) => {
  // Issue 210. A Windows volume can name one directory twice — `runneradmin` and `RUNNER~1` — and the
  // two are the same directory. When the tool subtracted one spelling from the other, the step that
  // stages the writes printed `../../../..` paths nobody can paste, and the baseline commit vanished,
  // because the dirty-tree check compared git's long-form entries with paths built from the short-form
  // cwd and concluded the tree was clean. The property that covers both is invariance: what a reader
  // is told cannot depend on the spelling of the directory they are standing in.
  if (process.platform !== 'win32') return t.skip('8.3 short names are a feature of Windows volumes');

  const dir = generatorLeftover(t);
  const fromLong = execFileSync(process.execPath, [BIN, 'start'], { cwd: dir, encoding: 'utf8' });

  const short = execFileSync('cmd', ['/c', 'for %I in (.) do @echo %~sfI'], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
  if (short.toLowerCase() === dir.toLowerCase()) {
    return t.skip('this volume gives the fixture no short name to compare with');
  }

  const fromShort = execFileSync(process.execPath, [BIN, 'start'], { cwd: short, encoding: 'utf8' });
  assert.deepEqual(
    stepLines(fromShort),
    stepLines(fromLong),
    `a directory spelled ${short} is the directory spelled ${dir}`,
  );
});

test('no step names a path outside the repository it was printed for', async (t) => {
  // The invariance above is the property; this is the answer a reader would have pasted. It is stated
  // separately because a plan that varies between two spellings could still be wrong in both.
  if (process.platform !== 'win32') return t.skip('8.3 short names are a feature of Windows volumes');

  const dir = generatorLeftover(t);
  const short = execFileSync('cmd', ['/c', 'for %I in (.) do @echo %~sfI'], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
  if (short.toLowerCase() === dir.toLowerCase()) {
    return t.skip('this volume gives the fixture no short name to compare with');
  }

  const printed = execFileSync(process.execPath, [BIN, 'start'], { cwd: short, encoding: 'utf8' });
  assert.deepEqual(
    stepLines(printed).filter((line) => line.includes('..')),
    [],
    `every path in the plan has to be one a reader can paste:\n${printed}`,
  );
});
