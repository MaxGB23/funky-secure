import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../src/cli.js';
import { collectPins, applyPins } from '../src/lib/pins.js';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-pin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const MANIFEST = (dependencies = { left: '^1.3.0' }) =>
  `${JSON.stringify({ name: 'fixture', private: true, dependencies }, null, 2)}\n`;

const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      left:
        specifier: ^1.3.0
        version: 1.3.0
`;

/** The injected collector: reads the real files, and answers git from the test's declared state. */
function fakeCollector({ root, dirty = [] } = {}) {
  return {
    read: async (path) => {
      try {
        return { ok: true, value: readFileSync(path, 'utf8') };
      } catch (error) {
        return { ok: false, error };
      }
    },
    git: async (args) => {
      const [head, second] = args;
      if (head === 'rev-parse' && second === '--show-toplevel') return { ok: true, code: 0, stdout: `${root}\n`, stderr: '' };
      if (head === 'rev-parse' && second === '--abbrev-ref') return { ok: true, code: 0, stdout: 'main\n', stderr: '' };
      if (head === 'ls-files') return { ok: true, code: 0, stdout: '', stderr: '' };
      if (head === 'check-ignore') return { ok: true, code: 1, stdout: '', stderr: '' };
      if (head === 'status') return { ok: true, code: 0, stdout: dirty.map((path) => ` M ${path}\0`).join(''), stderr: '' };
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

async function pin(t, argv, files, { dirty = [] } = {}) {
  const dir = scratch(t);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const stdout = capture();
  const stderr = capture();
  const code = await run(argv, { cwd: dir, env: {}, stdout, stderr, collector: fakeCollector({ root: dir, dirty }) });
  return { code, stdout: stdout.text, stderr: stderr.text, dir };
}

test('the plan names the write and touches nothing', async (t) => {
  const { code, stdout, dir } = await pin(t, ['pin'], { 'package.json': MANIFEST(), 'pnpm-lock.yaml': LOCK });

  assert.equal(code, 0, 'a plan is an offer');
  assert.match(stdout, /plan only \(nothing has been written\)/);
  assert.match(stdout, /set exact versions/);
  assert.match(stdout, /1\.3\.0/, 'the version the lockfile records is in the plan');
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), MANIFEST(), 'the manifest is untouched');
});

test('--apply writes the recorded version and leaves nothing floating', async (t) => {
  const { code, dir } = await pin(t, ['pin', '--apply'], { 'package.json': MANIFEST(), 'pnpm-lock.yaml': LOCK });

  assert.equal(code, 0);
  const written = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(written.dependencies.left, '1.3.0', 'the specifier is the version the lockfile records');
});

test('the plan names the install that re-records the lockfile', async (t) => {
  // Writing an exact specifier is half the change: pnpm-lock.yaml still records the range it replaced,
  // so the next scan reports a desync until the lockfile is rewritten. The tool never runs an install.
  const { code, stdout } = await pin(t, ['pin'], { 'package.json': MANIFEST(), 'pnpm-lock.yaml': LOCK });

  assert.equal(code, 0);
  const nextSteps = stdout.slice(stdout.indexOf('next steps'));
  assert.match(nextSteps, /pnpm install --lockfile-only/);
});

test('a second --apply performs no write, so the command is idempotent', async (t) => {
  const first = await pin(t, ['pin', '--apply'], { 'package.json': MANIFEST(), 'pnpm-lock.yaml': LOCK });
  assert.equal(first.code, 0);

  const stdout = capture();
  const code = await run(['pin', '--apply'], {
    cwd: first.dir,
    env: {},
    stdout,
    stderr: capture(),
    collector: fakeCollector({ root: first.dir }),
  });
  assert.equal(code, 0);
  assert.equal(stdout.text.includes('would write'), false, 'nothing is left to write');
  assert.match(
    stdout.text,
    /0 writes · 1 already at policy/,
    'the summary does not say the manifest is already at policy',
  );
  assert.match(stdout.text, /already exact/, 'the plan does not say why there is nothing to write');
});

test('a catalogue reference is left alone and the plan says so', async (t) => {
  // `catalog:` resolves to the version the catalogue in pnpm-workspace.yaml holds. Writing a version
  // into the manifest would delete the reference and freeze one dependency out of a shared catalogue
  // while its siblings kept reading it (0026), so it is counted apart from the exact ones.
  const manifest = MANIFEST({ left: 'catalog:', right: 'catalog:frontend' });
  const { code, stdout, dir } = await pin(t, ['pin'], {
    'package.json': manifest,
    'pnpm-lock.yaml': LOCK,
  });

  assert.equal(code, 0);
  assert.match(stdout, /2 catalogue references left alone/);
  assert.doesNotMatch(stdout, /set exact versions/, 'there is nothing to pin');
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), manifest, 'the manifest is untouched');
});

test('--apply does not touch a catalogue reference', async (t) => {
  const manifest = MANIFEST({ left: 'catalog:', floating: '^1.3.0' });
  const lock = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      left:
        specifier: catalog:
        version: 1.3.0
      floating:
        specifier: ^1.3.0
        version: 1.3.0
`;
  const { code, dir } = await pin(t, ['pin', '--apply'], {
    'package.json': manifest,
    'pnpm-lock.yaml': lock,
  });

  assert.equal(code, 0);
  const written = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(written.dependencies.left, 'catalog:', 'the reference survives');
  assert.equal(written.dependencies.floating, '1.3.0', 'the floating sibling is pinned');
});

test('a floating range the lockfile never resolved is reported, never pinned', async (t) => {
  const manifest = MANIFEST({ left: '^1.3.0', ghost: '^9.9.9' });
  const { code, stdout, dir } = await pin(t, ['pin', '--apply'], { 'package.json': manifest, 'pnpm-lock.yaml': LOCK });

  assert.equal(code, 0);
  assert.match(stdout, /ghost \(dependencies\) floats and the lockfile records no version/);
  const written = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(written.dependencies.ghost, '^9.9.9', 'the tool invents nothing');
});

test('a workspace importer is named as not pinned, not silently skipped', async (t) => {
  const lock = `${LOCK}  packages/app:
    dependencies:
      left:
        specifier: ^1.3.0
        version: 1.3.0
`;
  const { code, stdout } = await pin(t, ['pin'], { 'package.json': MANIFEST(), 'pnpm-lock.yaml': lock });

  assert.equal(code, 0);
  assert.match(stdout, /1 workspace importer not pinned: their manifests are outside the files the scan collects/);
});

test('an uncommitted manifest is refused with exit 3 and the action that lifts it', async (t) => {
  const { code, stderr, dir } = await pin(
    t,
    ['pin', '--apply'],
    { 'package.json': MANIFEST(), 'pnpm-lock.yaml': LOCK },
    { dirty: ['package.json'] },
  );

  assert.equal(code, 3, 'a refusal is its own code');
  assert.match(stderr, /^funky-secure: commit package\.json or pass --allow-dirty/m);
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), MANIFEST(), 'nothing was written');
});

test('--format json prints the plan document and no prose', async (t) => {
  const { code, stdout } = await pin(t, ['pin', '--format', 'json'], {
    'package.json': MANIFEST({ left: '^1.3.0', ghost: '^9.9.9' }),
    'pnpm-lock.yaml': LOCK,
  });

  assert.equal(code, 0);
  const document = JSON.parse(stdout);
  assert.equal(document.command, 'pin');
  assert.ok(Array.isArray(document.plan), 'the plan is the document');
  assert.equal(stdout.includes('not pinned'), false, 'prose never reaches the document');
});

test('nothing to pin is stated, not implied', async (t) => {
  const exact = MANIFEST({ left: '1.3.0' });
  const { code, stdout } = await pin(t, ['pin'], { 'package.json': exact, 'pnpm-lock.yaml': LOCK });

  assert.equal(code, 0);
  // "nothing to apply" alone left the reader unable to tell an already-pinned manifest from one the
  // command never inspected; the plan now names the file and the reason (0013).
  assert.match(stdout, /would not write/);
  assert.match(stdout, /1 specifier is already exact/);
  assert.match(stdout, /0 writes · 1 already at policy/);
});

test('collectPins reads the version from the lockfile and keeps the manifest shape', () => {
  const collected = collectPins({ packageJsonText: MANIFEST(), lockfileText: LOCK });
  assert.deepEqual(collected.pins, [{ section: 'dependencies', name: 'left', from: '^1.3.0', to: '1.3.0' }]);
  assert.deepEqual(collected.unrecorded, []);

  const written = applyPins(MANIFEST(), collected.pins);
  assert.equal(written.ok, true);
  assert.equal(JSON.parse(written.content).dependencies.left, '1.3.0');
  assert.ok(written.content.endsWith('\n'), 'the trailing newline survives');
});

test('pin reads the pnpm 8 root record, so a lockfileVersion 6.0 repository is pinnable', async (t) => {
  // vercel/nextjs-subscription-payments: the versions are in the lockfile, one line below each
  // specifier, and `pin` wrote nothing because the 6.0 shape was refused. `start` step 1 is
  // `pin --apply`, so this shape could not be cleared on any pnpm 8 repository.
  const lock = [
    "lockfileVersion: '6.0'",
    '',
    'settings:',
    '  autoInstallPeers: true',
    '  excludeLinksFromLockfile: false',
    '',
    'dependencies:',
    '  left:',
    '    specifier: ^1.3.0',
    '    version: 1.3.0',
    '  right:',
    '    specifier: ~2.0.0',
    '    version: 2.0.1(postcss@8.4.38)',
    '',
  ].join('\n');
  const manifest = MANIFEST({ left: '^1.3.0', right: '~2.0.0' });

  const plan = await pin(t, ['pin'], { 'package.json': manifest, 'pnpm-lock.yaml': lock });
  assert.equal(plan.code, 0);
  assert.match(plan.stdout, /pins 2 specifiers to the version pnpm-lock\.yaml records/);
  assert.equal(plan.stdout.includes('records no version'), false, 'every range has a recorded version');
  assert.match(plan.stdout, /right  ~2\.0\.0 → 2\.0\.1/, 'the recorded version drops the peer suffix');

  const applied = await pin(t, ['pin', '--apply'], { 'package.json': manifest, 'pnpm-lock.yaml': lock });
  assert.equal(applied.code, 0);
  const written = JSON.parse(readFileSync(join(applied.dir, 'package.json'), 'utf8'));
  assert.deepEqual(written.dependencies, { left: '1.3.0', right: '2.0.1' });
});
