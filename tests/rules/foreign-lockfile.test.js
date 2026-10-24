import test from 'node:test';
import assert from 'node:assert/strict';

import rule from '../../src/rules/foreign-lockfile.js';

function context(present) {
  return {
    scope: 'all',
    cwd: 'C:/repo',
    root: 'C:/repo',
    env: {},
    configPath: null,
    machine: null,
    repo: {
      root: 'C:/repo',
      inGit: true,
      branch: 'main',
      files: {
        packageJson: null,
        workspaceYaml: null,
        lockfile: present.includes('pnpm-lock.yaml')
          ? { path: 'C:/repo/pnpm-lock.yaml', text: 'lockfileVersion: 9.0' }
          : null,
        npmrc: null,
        gitignore: null,
      },
      present,
      tracked: new Set(present),
      ignoreCandidates: [],
      ignored: new Set(),
      importers: [],
      workflows: [],
      botFiles: [],
      editorFiles: [],
      skippedGlobs: [],
    },
  };
}

test('the rule declares its contract', () => {
  assert.equal(rule.id, 'foreign-lockfile');
  assert.equal(rule.friction, 0);
  assert.deepEqual(rule.severity, { baseline: 'warn', strict: 'warn' });
  assert.deepEqual(rule.scope, ['repo']);
  assert.deepEqual(rule.targets, ['repo-root']);
  assert.equal(rule.docs, 'docs/rules/foreign-lockfile.md');
  assert.equal(typeof rule.detect, 'function');
});

test('a repository with only pnpm-lock.yaml passes', () => {
  const [finding] = rule.detect(context(['package.json', 'pnpm-lock.yaml']));

  assert.equal(finding.status, 'pass');
  assert.equal(finding.code, undefined);
  assert.deepEqual(finding.evidence, { files: [], pnpmLockfile: true });
});

test('package-lock.json alone fails naming the npm migration', () => {
  const [finding] = rule.detect(context(['package.json', 'package-lock.json']));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'foreign-lockfile');
  assert.match(finding.message, /package-lock\.json/);
  assert.deepEqual(finding.evidence, { files: ['package-lock.json'], pnpmLockfile: false });
  assert.deepEqual(finding.remediation, {
    kind: 'manual',
    command: 'funky-secure migrate --from npm --apply',
  });
});

test('yarn.lock coexisting with pnpm-lock.yaml fails and names the coexistence', () => {
  const [finding] = rule.detect(context(['package.json', 'pnpm-lock.yaml', 'yarn.lock']));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'foreign-lockfile');
  assert.match(finding.message, /yarn\.lock/);
  assert.match(finding.message, /pnpm-lock\.yaml/);
  assert.match(finding.message, /two lockfiles resolve two dependency trees/);
  assert.match(finding.message, /works locally and breaks in CI/);
  assert.deepEqual(finding.evidence, { files: ['yarn.lock'], pnpmLockfile: true });
  assert.deepEqual(finding.remediation, {
    kind: 'manual',
    command: 'funky-secure migrate --from yarn --apply',
  });
});

test('every foreign lockfile is listed in one finding', () => {
  const [finding] = rule.detect(
    context(['package.json', 'package-lock.json', 'yarn.lock', 'bun.lockb']),
  );

  assert.equal(finding.status, 'fail');
  assert.deepEqual(finding.evidence, {
    files: ['package-lock.json', 'yarn.lock', 'bun.lockb'],
    pnpmLockfile: false,
  });
  assert.deepEqual(finding.remediation, {
    kind: 'manual',
    command: 'funky-secure migrate --from npm --apply',
  });
});

test('a bun lockfile alone names the auto migration origin', () => {
  const [finding] = rule.detect(context(['package.json', 'bun.lock']));

  assert.equal(finding.status, 'fail');
  assert.deepEqual(finding.evidence, { files: ['bun.lock'], pnpmLockfile: false });
  assert.deepEqual(finding.remediation, {
    kind: 'manual',
    command: 'funky-secure migrate --from auto --apply',
  });
});

test('outside a repository context the rule skips', () => {
  const ctx = context([]);
  ctx.repo = null;

  const [finding] = rule.detect(ctx);

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-repo-root');
});
