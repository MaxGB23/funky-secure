import test from 'node:test';
import assert from 'node:assert/strict';

import {
  currentBranch,
  defaultBranch,
  ignoredPaths,
  isTracked,
  repoRoot,
  statusPorcelain,
  trackedFiles,
} from '../src/lib/git.js';

function collectorFor(answers) {
  const calls = [];
  return {
    calls,
    async git(args, options = {}) {
      calls.push({ args, options });
      const answer = answers[args.join(' ')];
      if (answer === undefined) throw new Error(`unexpected git call: ${args.join(' ')}`);
      return { ok: true, code: 0, stdout: '', stderr: '', ...answer };
    },
  };
}

test('reads the worktree root and reports null outside git', async () => {
  const inside = collectorFor({ 'rev-parse --show-toplevel': { stdout: 'M:/repo\n' } });
  const outside = collectorFor({ 'rev-parse --show-toplevel': { code: 128, stderr: 'fatal: not a git repository' } });

  assert.equal(await repoRoot(inside), 'M:/repo');
  assert.equal(await repoRoot(outside), null);
});

test('splits tracked files on NUL, not on newlines', async () => {
  const collector = collectorFor({ 'ls-files -z': { stdout: 'a.js\0docs/b c.md\0' } });

  assert.deepEqual(await trackedFiles(collector), ['a.js', 'docs/b c.md']);
});

test('answers tracked-or-not, and refuses to guess when git errors', async () => {
  const tracked = collectorFor({ 'ls-files --error-unmatch -- pnpm-lock.yaml': { code: 0 } });
  const untracked = collectorFor({ 'ls-files --error-unmatch -- pnpm-lock.yaml': { code: 1 } });
  const broken = collectorFor({ 'ls-files --error-unmatch -- pnpm-lock.yaml': { code: 128 } });

  assert.equal(await isTracked(tracked, 'pnpm-lock.yaml'), true);
  assert.equal(await isTracked(untracked, 'pnpm-lock.yaml'), false);
  assert.equal(await isTracked(broken, 'pnpm-lock.yaml'), null);
});

test('evaluates ignore behavior without -v and reads the verdict per path', async () => {
  const collector = collectorFor({
    'check-ignore --no-index --stdin -z': { stdout: '.env\0.npmrc\0' },
  });

  const ignored = await ignoredPaths(collector, ['.env', '.npmrc', 'README.md']);

  assert.deepEqual([...ignored].sort(), ['.env', '.npmrc']);
  assert.equal(collector.calls[0].args.includes('-v'), false);
  assert.equal(collector.calls[0].options.input, '.env\0.npmrc\0README.md\0');
});

test('treats exit 1 as "none ignored" and a git failure as an unanswerable probe', async () => {
  const none = collectorFor({ 'check-ignore --no-index --stdin -z': { code: 1 } });
  const broken = collectorFor({ 'check-ignore --no-index --stdin -z': { code: 128 } });

  assert.deepEqual([...(await ignoredPaths(none, ['.env']))], []);
  assert.equal(await ignoredPaths(broken, ['.env']), null);
  assert.deepEqual([...(await ignoredPaths(collectorFor({}), []))], []);
});

test('limits the dirty-tree probe to the paths it was given', async () => {
  const collector = collectorFor({ 'status --porcelain -z -- .gitignore': { stdout: ' M .gitignore\0' } });

  assert.deepEqual(await statusPorcelain(collector, ['.gitignore']), [' M .gitignore']);
  assert.deepEqual(collector.calls[0].args, ['status', '--porcelain', '-z', '--', '.gitignore']);
});

test('reads the current branch', async () => {
  const collector = collectorFor({ 'rev-parse --abbrev-ref HEAD': { stdout: 'feat/v0.1\n' } });

  assert.equal(await currentBranch(collector), 'feat/v0.1');
});

test('reads the default branch from the remote HEAD and strips the remote name', async () => {
  const withRemote = collectorFor({ 'symbolic-ref --short refs/remotes/origin/HEAD': { stdout: 'origin/main\n' } });
  const withoutRemote = collectorFor({ 'symbolic-ref --short refs/remotes/origin/HEAD': { code: 128 } });

  assert.equal(await defaultBranch(withRemote), 'main');
  assert.equal(await defaultBranch(withoutRemote), null);
});
