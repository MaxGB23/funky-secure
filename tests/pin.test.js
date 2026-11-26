import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '../src/cli.js';
import { collectPins, applyPins } from '../src/lib/pins.js';

const BIN = fileURLToPath(new URL('../bin/funky-secure.js', import.meta.url));
// The identity the suite's other commits use: this machine carries a global hook that refuses any
// other author, and a test that fails on the developer's git config is a test nobody keeps running.
const IDENTITY = [
  '-c',
  'user.email=82458865+MaxGB23@users.noreply.github.com',
  '-c',
  'user.name=MaxGB23',
];

function scratch(t) {
  // Canonical, because a temporary root can come back with a second spelling: on macOS `/var` and
  // `/private/var` name the same directory, and the `test-macos` leg is what confirms the two spellings
  // it actually sees. The dirty check no longer subtracts one spelling from the other (issue 567, below,
  // where the second spelling is built on purpose), but a fixture that starts canonical keeps every
  // other test in this file answering the same question it always did.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-pin-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A committed repository and the second spelling of its own directory: `junction` is a junction on
 * win32 and a directory symlink on POSIX, which is the alias a real checkout is reached through.
 * @returns {{ root: string, alias: string }}
 */
function aliasedRepository(t, files) {
  const base = mkdtempSync(join(tmpdir(), 'funky-secure-pin-alias-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'repo');
  mkdirSync(root);
  for (const [name, text] of Object.entries(files)) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', [...IDENTITY, 'commit', '-qm', 'fixture'], { cwd: root });
  return { root, alias: join(base, 'alias') };
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

/**
 * The manifest a framework generator writes when it pins another manager: `create-t3-app` writes
 * `packageManager: npm@11.13.0`, and pnpm refuses every command under it (issue 111).
 * @param {string} manager
 */
const MANAGED = (manager) =>
  `${JSON.stringify(
    { name: 'fixture', private: true, packageManager: manager, dependencies: { left: '^1.3.0' } },
    null,
    2,
  )}\n`;

test('a foreign pin makes the resolve carry the flag that lets it run (issue 132)', async (t) => {
  // The path prints `pnpm install --lockfile-only --pm-on-fail=ignore` here, and `pin`'s own block
  // printed the same command without the flag: obeying the nearer line hits
  // ERR_PNPM_OTHER_PM_EXPECTED, the error the flag exists to avoid.
  const { code, stdout } = await pin(t, ['pin', '--apply'], {
    'package.json': MANAGED('npm@11.13.0'),
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': LOCK,
  });

  assert.equal(code, 0);
  const nextSteps = stdout.slice(stdout.indexOf('next steps'));
  assert.match(nextSteps, /pnpm install --lockfile-only --pm-on-fail=ignore/);
});

test('a pnpm pin prints the resolve without the flag, so the flag never leaks', async (t) => {
  const { code, stdout } = await pin(t, ['pin', '--apply'], {
    'package.json': MANAGED('pnpm@12.3.4'),
    'pnpm-lock.yaml': LOCK,
  });

  assert.equal(code, 0);
  const nextSteps = stdout.slice(stdout.indexOf('next steps'));
  assert.match(nextSteps, /pnpm install --lockfile-only\n/);
  assert.equal(stdout.includes('--pm-on-fail=ignore'), false);
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

test('a non-root importer is named as not pinned, not silently skipped', async (t) => {
  const lock = `${LOCK}  packages/app:
    dependencies:
      left:
        specifier: ^1.3.0
        version: 1.3.0
`;
  const { code, stdout } = await pin(t, ['pin'], { 'package.json': MANIFEST(), 'pnpm-lock.yaml': lock });

  assert.equal(code, 0);
  assert.match(stdout, /1 lockfile importer not pinned \(packages\/app\): pin writes the root importer only/);
});

test('the not-pinned note names a limit the scan actually has', async (t) => {
  // t3-create-t3-app (#331): the scan reads `cli/package.json` and `www/package.json` as importers and
  // reports findings inside them, so "outside the files the scan collects" was false; and
  // `cli/template/base` is a lockfile importer `pnpm-workspace.yaml` declares no package for, so
  // calling the three of them "workspace importers" mislabelled one. The note states the limit the code
  // really has — the root importer is the only one written — and the real set, by name.
  const lock = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      left:
        specifier: ^1.3.0
        version: 1.3.0
  cli:
    dependencies:
      left:
        specifier: ^1.3.0
        version: 1.3.0
  www:
    dependencies:
      left:
        specifier: ^1.3.0
        version: 1.3.0
  cli/template/base:
    dependencies:
      left:
        specifier: ^1.3.0
        version: 1.3.0
`;
  const { code, stdout, dir } = await pin(t, ['pin'], {
    'package.json': MANIFEST(),
    'pnpm-lock.yaml': lock,
    'pnpm-workspace.yaml': 'packages:\n  - cli\n  - www\n',
  });

  assert.equal(code, 0);
  assert.match(
    stdout,
    /3 lockfile importers not pinned \(cli, www, cli\/template\/base\): pin writes the root importer only/,
  );
  assert.doesNotMatch(stdout, /outside the files the scan collects/, 'the scan does collect those manifests');
  assert.doesNotMatch(stdout, /workspace importer/, 'cli/template/base is not a workspace member');
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), MANIFEST(), 'a plan writes nothing');
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

test('a dirty manifest is refused through an alias of the repository (issue 567)', async (t) => {
  // The defect: the write path spelled the paths it handed `git status` by subtracting `cwd` from an
  // already-canonical absolute path. Through an alias the two spellings differ, the subtraction answers
  // `../repo/package.json`, the intersection with the root-relative entries finds nothing, and the write
  // goes ahead over the bytes it promised to refuse.
  //
  // The alias spelling is the `cwd` of `run`, never a child process's working directory: a POSIX `getcwd`
  // resolves the symlink, so a spawned child sees the physical root and the pre-fix code passes on the
  // platform that hit the defect. Here the product receives the spelling itself, on every platform,
  // which is the value the arithmetic was wrong about.
  const { root, alias } = aliasedRepository(t, {
    'package.json': MANIFEST(),
    'pnpm-lock.yaml': LOCK,
  });
  try {
    symlinkSync(root, alias, 'junction');
  } catch (error) {
    return t.skip(`this ${process.platform} host refused the directory alias: ${error.code ?? error.message}`);
  }

  // The premise: the two spellings name one directory, and git answers in the root's coordinates.
  writeFileSync(join(root, 'package.json'), `${MANIFEST()}\n`);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: alias, encoding: 'utf8' }), ' M package.json\n');

  const stdout = capture();
  const stderr = capture();
  const code = await run(['pin', '--apply'], {
    cwd: alias,
    env: {},
    stdout,
    stderr,
    collector: fakeCollector({ root, dirty: ['package.json'] }),
  });

  assert.equal(code, 3, `a dirty target is a refusal, never a question: ${stdout.text}${stderr.text}`);
  assert.match(stderr.text, /^funky-secure: commit package\.json or pass --allow-dirty, then re-run$/m);
  assert.match(stderr.text, /^reason: refusing to write over uncommitted changes: package\.json$/m);
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), `${MANIFEST()}\n`, 'nothing was written');
});

test('a dirty manifest is refused from a subdirectory of the repository (issue 567)', async (t) => {
  // The same defect without an alias: from below the root the old subtraction spelled the manifest
  // `../../package.json`, git answered with the root-relative entry the plan declares, and the two never
  // met - so `pin --apply` wrote over the uncommitted changes it had promised to refuse.
  const { root } = aliasedRepository(t, {
    'package.json': MANIFEST(),
    'pnpm-lock.yaml': LOCK,
    'packages/app/index.js': '',
  });
  writeFileSync(join(root, 'package.json'), `${MANIFEST()}\n`);
  const cwd = join(root, 'packages', 'app');

  // The premise: git names the dirty manifest under the root, whatever directory it is asked from.
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }), ' M package.json\n');

  const result = spawnSync(process.execPath, [BIN, 'pin', '--apply'], { cwd, encoding: 'utf8' });

  assert.equal(result.status, 3, `a dirty target is a refusal, never a write: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /^funky-secure: commit package\.json or pass --allow-dirty, then re-run$/m);
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), `${MANIFEST()}\n`, 'nothing was written');
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
