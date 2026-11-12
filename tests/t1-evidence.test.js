import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/funky-secure.js', import.meta.url));
const IDENTITY = ['-c', 'user.email=82458865+MaxGB23@users.noreply.github.com', '-c', 'user.name=MaxGB23'];

test('T1 evidence: what the dirty check compares on this platform', async (t) => {
  if (process.platform !== 'win32') return t.skip('the question is what a Windows volume does');
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-t1-long-directory-name-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'app', private: true, dependencies: { next: '^15.5.4' } }, null, 2)}\n`);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', [...IDENTITY, 'commit', '-qm', 'generated'], { cwd: dir });
  appendFileSync(join(dir, 'package.json'), '\n');

  const short = execFileSync('cmd', ['/c', 'for %I in (.) do @echo %~sfI'], { cwd: dir, encoding: 'utf8' }).trim();
  const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim();

  for (const [label, cwd] of [['long', dir], ['short', short]]) {
    const run = spawnSync(process.execPath, [BIN, 'init', '--apply'], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, FUNKY_DEBUG_PATHS: '1' },
    });
    console.log(`T1 BEGIN ${label}`);
    console.log('T1 dir=' + JSON.stringify(dir));
    console.log('T1 short=' + JSON.stringify(short));
    console.log('T1 toplevel=' + JSON.stringify(toplevel));
    console.log('T1 exit=' + run.status);
    console.log('T1 stderr=' + (run.stderr || '').trim());
    console.log(`T1 END ${label}`);
  }
  // The assertion is not the point of this file; it makes the run fail so the log keeps the output.
  assert.fail('T1 diagnostic: read the printed coordinates');
});
