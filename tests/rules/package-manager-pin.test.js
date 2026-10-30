import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import rule from '../../src/rules/package-manager-pin.js';

const EXECUTABLE = 'C:/tools/pnpm/bin/pnpm.cmd';

function machine(version) {
  return {
    available: version !== null,
    version,
    major: version === null ? null : Number(version.split('.')[0]),
    executable: version === null ? null : EXECUTABLE,
    installations: version === null ? [] : [EXECUTABLE],
    config: null,
    storePath: null,
    userAgent: null,
    reportedVersion: null,
    versionAmbiguous: false,
  };
}

function packageJson(packageManager) {
  const json = packageManager === undefined ? {} : { packageManager };
  return { path: 'C:/repo/package.json', text: JSON.stringify(json), json, error: null };
}

function context({ version = '12.3.4', packageManager = 'pnpm@12.3.4', packageJson: file } = {}) {
  return {
    scope: 'all',
    cwd: 'C:/repo',
    root: 'C:/repo',
    env: {},
    configPath: null,
    machine: machine(version),
    repo: {
      root: 'C:/repo',
      inGit: true,
      branch: 'main',
      files: {
        packageJson: file === undefined ? packageJson(packageManager) : file,
        workspaceYaml: null,
        lockfile: null,
        npmrc: null,
        gitignore: null,
      },
      present: ['package.json', 'pnpm-lock.yaml'],
      tracked: new Set(['package.json', 'pnpm-lock.yaml']),
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
  assert.equal(rule.id, 'package-manager-pin');
  assert.equal(rule.friction, 0);
  assert.deepEqual(rule.severity, { baseline: 'error', strict: 'error' });
  assert.deepEqual(rule.scope, ['repo']);
  assert.deepEqual(rule.targets, ['repo-root']);
  assert.equal(rule.docs, 'docs/rules/package-manager-pin.md');
  assert.equal(typeof rule.detect, 'function');
});

test('a pin matching the answering pnpm passes', () => {
  const [finding] = rule.detect(context());

  assert.equal(finding.status, 'pass');
  assert.equal(finding.code, undefined);
  assert.equal(finding.path, 'package.json');
  assert.match(finding.message, /pnpm@12\.3\.4/);
  assert.deepEqual(finding.evidence, {
    declared: 'pnpm@12.3.4',
    observed: '12.3.4',
    executable: EXECUTABLE,
  });
});

test('an absent pin fails with pin-missing and names the value to declare', () => {
  const [finding] = rule.detect(context({ packageJson: packageJson() }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'pin-missing');
  assert.equal(finding.path, 'package.json');
  assert.match(finding.message, /pnpm@12\.3\.4/);
  assert.deepEqual(finding.evidence, {
    declared: null,
    observed: '12.3.4',
    executable: EXECUTABLE,
  });
  assert.deepEqual(finding.remediation, { kind: 'auto', command: 'funky-secure init --apply' });
});

test('another manager fails with pin-conflict', () => {
  const [finding] = rule.detect(context({ packageManager: 'npm@10' }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'pin-conflict');
  assert.match(finding.message, /npm@10/);
  assert.deepEqual(finding.evidence, {
    declared: 'npm@10',
    observed: '12.3.4',
    executable: EXECUTABLE,
  });
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'corepack use pnpm@12.3.4' });
});

test('a pin the project manages itself is a skip, not a conflict (0020)', () => {
  // pnpm 12 with devEngines.packageManager answers with the version the project declares, not the
  // one on PATH: from its own directory it reported 12.16.0 while the binary answering was 12.3.4.
  // The version probe now runs outside the repository (0019), so it sees the PATH binary and used to
  // report a conflict whose remediation told the user to downgrade the project.
  const json = {
    packageManager: 'pnpm@12.16.0',
    devEngines: { packageManager: { name: 'pnpm', version: '12.16.0', onFail: 'download' } },
  };
  const [finding] = rule.detect(
    context({
      version: '12.3.4',
      packageJson: { path: 'C:/repo/package.json', text: JSON.stringify(json), json, error: null },
    }),
  );

  assert.equal(finding.status, 'skip', 'the PATH binary says nothing about a self-managed pin');
  assert.equal(finding.code, 'self-managed-pin');
  assert.equal(finding.remediation.kind, 'none', 'and it must never suggest a downgrade');
});

test('a pnpm pin without a self-managing devEngines entry is still a conflict', () => {
  const [finding] = rule.detect(context({ version: '12.3.4', packageManager: 'pnpm@12.16.0' }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'pin-conflict');
});

test('another pnpm version fails with pin-conflict', () => {
  const [finding] = rule.detect(context({ packageManager: 'pnpm@11.0.0' }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'pin-conflict');
  assert.match(finding.message, /pnpm@11\.0\.0/);
  assert.deepEqual(finding.evidence, {
    declared: 'pnpm@11.0.0',
    observed: '12.3.4',
    executable: EXECUTABLE,
  });
});

test('no pnpm answering is a skip, not a wrong pin', () => {
  const [finding] = rule.detect(context({ version: null }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-pnpm');
  assert.equal(finding.probeUnavailable, true);
  assert.match(finding.message, /^skipped: /);
  assert.deepEqual(finding.evidence, {
    declared: 'pnpm@12.3.4',
    observed: null,
    executable: null,
  });
});

test('there is no repository root to read a pin from', () => {
  const ctx = context();
  ctx.repo = null;

  const [finding] = rule.detect(ctx);

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-package-json');
  assert.equal(finding.probeUnavailable, undefined);
});

test('machine facts out of scope are a skip, not a failed required probe', () => {
  const ctx = context();
  ctx.scope = 'repo';
  ctx.machine = null;

  const [finding] = rule.detect(ctx);

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-pnpm');
  assert.equal(finding.probeUnavailable, undefined);
  assert.equal(
    finding.message,
    'skipped: the machine is out of scope, so the declared packageManager pin was not compared with the pnpm that answers; run funky-secure scan --scope all to verify it',
  );
});

test('no root package.json is a skip', () => {
  const [finding] = rule.detect(context({ packageJson: null }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-package-json');
  assert.match(finding.message, /^skipped: /);
  assert.equal(finding.probeUnavailable, undefined);
});

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-pin-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function reportFor(code) {
  return {
    findings: [
      {
        rule: 'package-manager-pin',
        status: code === null ? 'pass' : 'fail',
        code: code ?? undefined,
      },
    ],
  };
}

test('plan() writes the missing pin and leaves a passing pin alone', (t) => {
  const dir = scratch(t);

  const failing = context({ packageJson: packageJson() });
  failing.repo.root = dir;
  const items = rule.plan(failing, { report: reportFor('pin-missing') });

  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.target, 'package.json');
  assert.equal(item.operation, 'set packageManager');
  assert.equal(item.state, 'would-write');
  assert.ok(item.path.startsWith(dir));
  assert.equal(JSON.parse(item.content).packageManager, 'pnpm@12.3.4');
  assert.equal(item.digest.length, 64);
  assert.match(item.reason, /pnpm@12\.3\.4/);

  const passing = context();
  passing.repo.root = dir;
  assert.deepEqual(rule.plan(passing, { report: reportFor(null) }), []);
});

test('plan() reports a conflicting pin as a conflict item and writes nothing', (t) => {
  const dir = scratch(t);
  const ctx = context({ packageManager: 'npm@10' });
  ctx.repo.root = dir;

  const items = rule.plan(ctx, { report: reportFor('pin-conflict') });

  assert.equal(items.length, 1);
  assert.equal(items[0].state, 'conflict');
  assert.match(items[0].reason, /npm@10/);
  assert.equal(items[0].content, null);
  assert.equal(items[0].digest, null);
});

test('plan() does nothing when no pnpm answered', (t) => {
  const dir = scratch(t);
  const ctx = context({ version: null });
  ctx.repo.root = dir;

  assert.deepEqual(rule.plan(ctx, { report: reportFor('no-pnpm') }), []);
});

test('a malformed package.json is a skip, not a pass', () => {
  const file = {
    path: 'C:/repo/package.json',
    text: '{',
    json: null,
    error: 'Unexpected end of JSON input',
  };

  const [finding] = rule.detect(context({ packageJson: file }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-package-json');
});
