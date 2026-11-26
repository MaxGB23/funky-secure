/**
 * The applier's own guard rails (RFC 11.2, 10.4).
 *
 * The two `ConfigError`s in `applyPlan` are invariants: a plan item is built by this tool with its
 * content and its digest, so neither can fail on the printed path. That is exactly why they are worth
 * one test — the assertion is not that the tool is wrong, it is that the guard throws the class the
 * contract names, so a failure surfaces as exit `2` with a message instead of a `ReferenceError` with
 * a stack (issue 142).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { ConfigError } from '../src/lib/errors.js';
import { applyPlan, planItem } from '../src/lib/plan.js';
import { createCollector } from '../src/lib/probes.js';

/**
 * A collector whose git answers the two questions the write path asks, and records where each one was
 * asked from: the coordinate system is the assertion, and a fake that ignored it would assert itself.
 * `root: null` is a git that cannot say which worktree it is in.
 * @param {{ root: string | null, entries?: string[], statusCode?: number }} options
 */
function gitCollector({ root = null, entries = [], statusCode = 0 }) {
  const calls = [];
  return {
    calls,
    async git(args, options = {}) {
      calls.push({ args, cwd: options.cwd });
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        if (root === null) return { ok: true, code: 128, stdout: '', stderr: 'fatal: not a git repository' };
        return { ok: true, code: 0, stdout: `${root}\n`, stderr: '' };
      }
      if (args[0] === 'status') {
        return { ok: true, code: statusCode, stdout: entries.map((entry) => `${entry}\0`).join(''), stderr: '' };
      }
      return { ok: true, code: 1, stdout: '', stderr: '' };
    },
  };
}

test('a plan item with no content is a ConfigError, and nothing is written (10.4, issue 142)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'funky-plan-'));
  try {
    const item = join(dir, 'pnpm-workspace.yaml');
    const plan = [
      { state: 'would-write', path: item, relative: 'pnpm-workspace.yaml', operation: 'create', content: null, digest: 'x' },
    ];

    await assert.rejects(
      () =>
        applyPlan({
          plan,
          allowDirty: true,
          cwd: dir,
          collector: createCollector({ cwd: dir }),
          stdout: { write() {} },
        }),
      (error) => {
        assert.ok(
          error instanceof ConfigError,
          `a guard the contract maps to exit 2 threw ${error.name}: ${error.message}`,
        );
        assert.match(error.message, /carries no content/);
        return true;
      },
    );

    assert.deepEqual(readdirSync(dir), [], 'an item that cannot be applied writes nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a plan item that declares no name is a ConfigError, and nothing is written (issue 567)', async (t) => {
  // The guard's whole job is to ask git about a file before overwriting it, and the question is asked
  // with the name the catalog declared. An item with no name was silently left out of the probe and
  // written anyway - so a plan item without a name is a broken item, not an item nothing writes.
  const dir = mkdtempSync(join(tmpdir(), 'funky-plan-root-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const named = join(dir, 'package.json');
  const unnamed = join(dir, 'pnpm-workspace.yaml');
  writeFileSync(named, '{"name":"fixture"}\n');

  const plan = [
    planItem({ target: 'package.json', operation: 'pin', path: named, relative: 'package.json', content: '{"name":"pinned"}\n' }),
    planItem({ target: 'pnpm-workspace.yaml', operation: 'create', path: unnamed, content: 'packages: []\n' }),
  ];

  await assert.rejects(
    () =>
      applyPlan({
        plan,
        cwd: dir,
        collector: gitCollector({ root: dir, entries: [] }),
        stdout: { write() {} },
      }),
    (error) => {
      assert.ok(
        error instanceof ConfigError,
        `a guard the contract maps to exit 2 threw ${error.name}: ${error.message}`,
      );
      assert.match(error.message, /carries no repository-relative name/);
      return true;
    },
  );

  assert.deepEqual(readdirSync(dir), ['package.json'], 'neither the undeclared item nor its neighbour is written');
  assert.equal(readFileSync(named, 'utf8'), '{"name":"fixture"}\n', 'the named target is untouched too');
});

test('a dirty target is refused, and the probe runs in the repository\'s own coordinate system (issue 567)', async (t) => {
  // The plan declares the name; git answers in that coordinate system from the root it reports. The two
  // are one set intersection (I-71), so no path arithmetic between two spellings of one directory is
  // involved - which is what a repository reached through an alias used to break.
  const root = mkdtempSync(join(tmpdir(), 'funky-plan-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, 'package.json');
  writeFileSync(target, '{"name":"fixture"}\n');
  const collector = gitCollector({ root, entries: [' M package.json'] });
  const plan = [planItem({ target: 'package.json', operation: 'pin', path: target, relative: 'package.json', content: 'x' })];

  await assert.rejects(
    () => applyPlan({ plan, cwd: `${root}${sep}`, collector, stdout: { write() {} } }),
    (error) => {
      assert.equal(error.action, 'commit package.json or pass --allow-dirty, then re-run');
      assert.equal(error.message, 'refusing to write over uncommitted changes: package.json');
      return true;
    },
  );

  const status = collector.calls.find((call) => call.args[0] === 'status');
  assert.deepEqual(status.args, ['status', '--porcelain', '-z', '--', 'package.json']);
  assert.equal(status.cwd, root, 'the pathspec is read from the root the plan\'s names are relative to');
  assert.equal(readFileSync(target, 'utf8'), '{"name":"fixture"}\n', 'a refused plan writes nothing');
});

test('a git that cannot report the working tree is refused with the action that lifts it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'funky-plan-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, 'package.json');
  writeFileSync(target, '{"name":"fixture"}\n');
  const plan = [planItem({ target: 'package.json', operation: 'pin', path: target, relative: 'package.json', content: 'x' })];

  await assert.rejects(
    () =>
      applyPlan({
        plan,
        cwd: root,
        collector: gitCollector({ root, statusCode: 128 }),
        stdout: { write() {} },
      }),
    (error) => {
      assert.equal(error.action, 'pass --allow-dirty, or fix git so git status answers, then re-run');
      assert.equal(error.message, 'cannot check the working tree: git status failed');
      return true;
    },
  );

  assert.equal(readFileSync(target, 'utf8'), '{"name":"fixture"}\n', 'a refusal writes nothing');
});

test('a git that cannot name the root is refused, not asked from the invocation directory (issue 567)', async (t) => {
  // The plan's names are relative to the worktree root, and a pathspec is read relative to the
  // directory git runs in. With `rev-parse` failing, falling back to the invocation directory asked
  // git about the right names in the wrong coordinate system, got an empty answer, and wrote over a
  // dirty file: a missing fact was reported as a clean tree.
  const root = mkdtempSync(join(tmpdir(), 'funky-plan-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, 'package.json');
  writeFileSync(target, '{"name":"fixture"}\n');
  const plan = [
    planItem({ target: 'package.json', operation: 'pin', path: target, relative: 'package.json', content: 'x' }),
  ];
  const collector = gitCollector({ root: null, entries: [] });

  await assert.rejects(
    () => applyPlan({ plan, cwd: root, collector, stdout: { write() {} } }),
    (error) => {
      assert.equal(error.action, 'pass --allow-dirty, or fix git so git status answers, then re-run');
      assert.equal(error.message, 'cannot check the working tree: git status failed');
      return true;
    },
  );

  assert.equal(
    collector.calls.some((call) => call.args[0] === 'status'),
    false,
    'a root the tool could not name is never replaced by the directory it was invoked from',
  );
  assert.equal(readFileSync(target, 'utf8'), '{"name":"fixture"}\n', 'a refusal writes nothing');
});
