import test from 'node:test';
import assert from 'node:assert/strict';

import rule from '../../src/rules/lockfile-committed.js';

const LOCKFILE = 'pnpm-lock.yaml';

function context({ inGit = true, present = true, tracked = true, ignored = false } = {}) {
  const names = present ? [LOCKFILE] : [];
  return {
    scope: 'all',
    cwd: 'C:/repo',
    root: 'C:/repo',
    env: {},
    configPath: null,
    machine: null,
    repo: {
      root: 'C:/repo',
      inGit,
      branch: inGit ? 'main' : null,
      files: {
        packageJson: null,
        workspaceYaml: null,
        lockfile: present ? { path: 'C:/repo/pnpm-lock.yaml', text: 'lockfileVersion: 9.0' } : null,
        npmrc: null,
        gitignore: null,
      },
      present: names,
      tracked: inGit
        ? new Set([...(present && tracked ? [LOCKFILE] : []), 'package.json'])
        : null,
      ignoreCandidates: ['.env'],
      ignored: inGit ? new Set(ignored ? [LOCKFILE] : []) : null,
      importers: [],
      workflows: [],
      botFiles: [],
      editorFiles: [],
      skippedGlobs: [],
    },
  };
}

test('the rule declares its contract', () => {
  assert.equal(rule.id, 'lockfile-committed');
  assert.equal(rule.friction, 0);
  assert.deepEqual(rule.severity, { baseline: 'error', strict: 'error' });
  assert.deepEqual(rule.scope, ['repo']);
  assert.deepEqual(rule.targets, ['repo-root']);
  assert.equal(rule.docs, 'docs/rules/lockfile-committed.md');
  assert.equal(typeof rule.detect, 'function');
});

test('a present, tracked, not-ignored lockfile passes', () => {
  const [finding] = rule.detect(context());

  assert.equal(finding.status, 'pass');
  assert.equal(finding.code, undefined);
  assert.equal(finding.path, LOCKFILE);
  assert.match(finding.message, /present, tracked and not ignored/);
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: true,
    tracked: true,
    ignored: false,
  });
});

test('an absent lockfile fails with lockfile-missing', () => {
  const [finding] = rule.detect(context({ present: false }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-missing');
  assert.equal(finding.path, LOCKFILE);
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: false,
    tracked: false,
    ignored: false,
  });
});

test('a present but untracked lockfile fails with lockfile-untracked', () => {
  const [finding] = rule.detect(context({ tracked: false }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-untracked');
  assert.match(finding.message, /not tracked/);
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: true,
    tracked: false,
    ignored: false,
  });
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'git add pnpm-lock.yaml' });
});

test('a present, tracked but ignored lockfile fails with lockfile-ignored', () => {
  const [finding] = rule.detect(context({ ignored: true }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-ignored');
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: true,
    tracked: true,
    ignored: true,
  });
  assert.deepEqual(finding.remediation, {
    kind: 'manual',
    command: 'git check-ignore -v pnpm-lock.yaml',
  });
});

test('outside git a present lockfile passes and says the rest was not evaluated', () => {
  const [finding] = rule.detect(context({ inGit: false }));

  assert.equal(finding.status, 'pass');
  assert.match(finding.message, /not evaluated/);
  assert.match(finding.message, /not a git repository/);
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: true,
    tracked: null,
    ignored: null,
  });
});

test('outside git an absent lockfile still fails', () => {
  const [finding] = rule.detect(context({ inGit: false, present: false }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-missing');
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: false,
    tracked: null,
    ignored: null,
  });
});

test('a lockfile git cannot vouch for is a pass with the gap stated', () => {
  const ctx = context();
  ctx.repo.tracked = null;

  const [finding] = rule.detect(ctx);

  assert.equal(finding.status, 'pass');
  assert.match(finding.message, /not evaluated/);
  assert.equal(finding.evidence.tracked, null);
});

test('a missing ignore verdict is a pass with the gap stated', () => {
  const ctx = context();
  ctx.repo.ignored = null;

  const [finding] = rule.detect(ctx);

  assert.equal(finding.status, 'pass');
  assert.match(finding.message, /ignore rules were not evaluated/);
  assert.equal(finding.evidence.ignored, null);
});

test('outside a repository context the rule skips', () => {
  const ctx = context();
  ctx.repo = null;

  const [finding] = rule.detect(ctx);

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-repo-root');
});
