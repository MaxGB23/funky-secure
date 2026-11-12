import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

/** A project a generator left behind, in a directory long enough to have a second spelling. */
function generatorLeftover(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-plan-spelling-long-directory-'));
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

test('a plan is the same plan from either spelling of the directory it is asked from', async (t) => {
  // Issue 210. A Windows volume with 8.3 names gives one directory two spellings, and a step printed
  // from the short one used to read `git add ../../../../../runneradmin/...` - a path nobody can paste,
  // and one that says nothing about the repository it belongs to.
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
  assert.deepEqual(
    stepLines(fromShort).filter((line) => line.includes('..')),
    [],
    `no step may name a path outside the repository:\n${fromShort}`,
  );
});
