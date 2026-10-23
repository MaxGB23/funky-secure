import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { machineFacts, majorOf, repoFacts, workspacePackageEntries } from '../src/lib/targets.js';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-targets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, path, content) {
  const full = join(dir, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

function collectorOver({ version = '12.3.4', config = {}, tracked = [] } = {}) {
  return {
    async read(path) {
      try {
        return { ok: true, value: readFileSync(path, 'utf8') };
      } catch {
        return { ok: false };
      }
    },
    async git() {
      return { ok: true, code: 0, stdout: tracked.map((path) => `${path}\0`).join('') };
    },
    async pnpmVersion() {
      return version === null
        ? { ok: false, reason: 'not-on-path', installations: [] }
        : { ok: true, version, major: majorOf(version), executable: 'C:\\pnpm\\pnpm.exe', installations: ['C:\\pnpm\\pnpm.exe'] };
    },
    async pnpmConfig() {
      return Object.keys(config).length === 0
        ? { ok: false, reason: 'failed' }
        : { ok: true, config };
    },
  };
}

test('parses the packages list by line, ignoring comments and quotes', () => {
  const text = [
    'packages:',
    "  - 'packages/*'",
    '  - apps/web # the web app',
    '',
    'minimumReleaseAge: 1440',
  ].join('\n');

  assert.deepEqual(workspacePackageEntries(text).entries, ['packages/*', 'apps/web']);
  assert.deepEqual(workspacePackageEntries('catalog:\n  react: 19.0.0\n').entries, []);
});

test('reads the major from a version and refuses to guess', () => {
  assert.equal(majorOf('12.3.4'), 12);
  assert.equal(majorOf('9.15.0'), 9);
  assert.equal(majorOf('not-a-version'), null);
  assert.equal(majorOf(undefined), null);
});

test('reports a machine without pnpm as unavailable instead of failing', async () => {
  const { facts, targets } = await machineFacts(collectorOver({ version: null }));

  assert.equal(facts.available, false);
  assert.equal(facts.version, null);
  assert.deepEqual(targets, [{ kind: 'machine', detail: 'pnpm unavailable on this machine' }]);
});

test('reports the version, the store and the version ambiguity as separate facts', async () => {
  const agreeing = await machineFacts(
    collectorOver({ config: { storeDir: 'M:/.pnpm-store', userAgent: 'pnpm/12.3.4 npm/? node/? win32 x64' } }),
  );
  const disagreeing = await machineFacts(
    collectorOver({ config: { storeDir: 'M:/.pnpm-store', userAgent: 'pnpm/11.5.0 npm/? node/? win32 x64' } }),
  );

  assert.equal(agreeing.facts.versionAmbiguous, false);
  assert.equal(agreeing.facts.major, 12);
  assert.equal(agreeing.facts.storePath, 'M:/.pnpm-store');
  assert.equal(agreeing.targets.length, 1);
  assert.match(agreeing.targets[0].detail, /^pnpm 12\.3\.4 \(.*\) {2}· {2}store M:\/\.pnpm-store$/);

  assert.equal(disagreeing.facts.versionAmbiguous, true);
  assert.equal(disagreeing.targets.length, 2);
  assert.match(disagreeing.targets[1].detail, /^version ambiguity: pnpm --version answered 12\.3\.4, configuration reports pnpm\/11\.5\.0$/);
});

test('resolves the root package plus every single-level workspace importer', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
  write(dir, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n  - apps/**\n');
  write(dir, 'packages/api/package.json', JSON.stringify({ name: 'api' }));
  write(dir, 'packages/web/package.json', JSON.stringify({ name: 'web' }));

  const { facts, targets } = await repoFacts({
    collector: collectorOver({ tracked: ['package.json', 'pnpm-lock.yaml'] }),
    cwd: dir,
    root: dir,
  });

  assert.deepEqual(
    facts.importers.map((importer) => importer.dir),
    ['.', 'packages/api', 'packages/web'],
  );
  assert.deepEqual(facts.skippedGlobs, ['apps/**'], 'a nested glob is reported, never silently ignored');
  assert.deepEqual(
    targets.map((target) => `${target.kind}:${target.path ?? ''}`),
    ['repo-root:.', 'importer:.', 'importer:packages/api/package.json', 'importer:packages/web/package.json'],
  );
  assert.equal(facts.inGit, true);
  assert.deepEqual([...facts.tracked], ['package.json', 'pnpm-lock.yaml']);
});

test('records a malformed package.json instead of throwing', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', '{ nope');

  const { facts } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.equal(facts.files.packageJson.json, null);
  assert.match(facts.files.packageJson.error, /JSON/);
});

test('works outside git, checking only what exists', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'lonely' }));

  const { facts, targets } = await repoFacts({ collector: collectorOver({ tracked: null }), cwd: dir, root: null });

  assert.equal(facts.inGit, false);
  assert.equal(facts.tracked, null);
  assert.equal(facts.root, dir);
  assert.deepEqual(facts.present.sort(), ['package.json']);
  assert.deepEqual(targets.map((target) => target.kind), ['repo-root', 'importer']);
});

test('lists workflows and bot configs as ci targets', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, '.github/workflows/ci.yml', 'name: ci\n');
  write(dir, '.github/workflows/notes.txt', 'ignored\n');
  write(dir, '.github/dependabot.yml', 'version: 2\n');

  const { facts, targets } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(facts.workflows.map((file) => file.path), ['.github/workflows/ci.yml']);
  assert.deepEqual(facts.botFiles, ['.github/dependabot.yml']);
  assert.ok(targets.some((target) => target.kind === 'ci'));
});
