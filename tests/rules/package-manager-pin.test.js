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

/** A manifest carrying the fields the rule reads, both of them. @param {object} json */
function manifest(json) {
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

test('another manager is a skip, not a conflict: the pnpm question does not apply', () => {
  const [finding] = rule.detect(context({ packageManager: 'npm@10' }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'not-pnpm');
  assert.match(finding.message, /npm@10/);
  assert.deepEqual(finding.evidence, {
    declared: 'npm@10',
    observed: '12.3.4',
    executable: EXECUTABLE,
  });
  assert.deepEqual(finding.remediation, { kind: 'none' });
});

test('a pin the project manages itself is a skip, not a conflict (0020, narrowed by 0030)', () => {
  // pnpm 12 with devEngines.packageManager answers with the version the project declares, not the
  // one on PATH: from its own directory it reported another version while the binary answering was
  // 12.3.4. The version probe runs outside the repository (0019), so it sees the PATH binary, and a
  // conflict there would carry a remediation that downgrades the project.
  //
  // The skip now covers only a declaration that names a version other than the pin: when the two are
  // equal the tool wrote them itself, so that pair is verified instead (0030).
  const json = {
    packageManager: 'pnpm@12.16.0',
    devEngines: { packageManager: { name: 'pnpm', version: '12.3.4', onFail: 'download' } },
  };
  const [finding] = rule.detect(context({ version: '12.3.4', packageJson: manifest(json) }));

  assert.equal(finding.status, 'skip', 'the PATH binary says nothing about a self-managed pin');
  assert.equal(finding.code, 'self-managed-pin');
  assert.equal(finding.remediation.kind, 'none', 'and it must never suggest a downgrade');
});

test('a declared pnpm that differs from the machine is information, not a conflict', () => {
  const [finding] = rule.detect(context({ version: '12.3.4', packageManager: 'pnpm@12.16.0' }));

  assert.equal(finding.status, 'pass', 'a declared pin is correct: the repository is the authority');
  assert.equal(finding.code, 'pin-differs-from-machine');
  assert.deepEqual(finding.remediation, { kind: 'none' }, 'a declared pin is never rewritten');
});

test('a guard equal to the pin is verified when the answering pnpm matches (0030)', () => {
  // The tool writes both declarations in one plan, so the pair is a fact it owns: where the machine
  // agrees there is nothing left to skip, and an `onFail` written by `pnpm init` does not change the
  // name and version the field declares.
  const json = {
    packageManager: 'pnpm@12.3.4',
    devEngines: { packageManager: { name: 'pnpm', version: '12.3.4', onFail: 'download' } },
  };
  const [finding] = rule.detect(context({ version: '12.3.4', packageJson: manifest(json) }));

  assert.equal(finding.status, 'pass');
  assert.notEqual(finding.code, 'self-managed-pin', 'a fact the tool owns and the machine confirms is verified');
  assert.deepEqual(finding.remediation, { kind: 'none' });
});

test('a guard equal to a pin the answering pnpm does not match stays a skip (0020, 0030)', () => {
  // The declarations agree, and the machine does not: the answer is still not evidence. A project that
  // declares its own pnpm re-executes with it, so the PATH binary describes the machine (0019, 0020),
  // and naming `corepack use pnpm@<machine version>` here would be the downgrade 0020 removed.
  const json = {
    packageManager: 'pnpm@12.3.4',
    devEngines: { packageManager: { name: 'pnpm', version: '12.3.4' } },
  };
  const [finding] = rule.detect(context({ version: '12.16.0', packageJson: manifest(json) }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'self-managed-pin');
  assert.deepEqual(finding.remediation, { kind: 'none' });
});

test('another pnpm version passes, and never carries a remediation', () => {
  const [finding] = rule.detect(context({ packageManager: 'pnpm@11.0.0' }));

  assert.equal(finding.status, 'pass');
  assert.equal(finding.code, 'pin-differs-from-machine');
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

test('plan() writes the missing pin and the guard beside it, and leaves a passing pin alone', (t) => {
  const dir = scratch(t);

  const failing = context({ packageJson: packageJson() });
  failing.repo.root = dir;
  const items = rule.plan(failing, { report: reportFor('pin-missing') });

  assert.equal(items.length, 2, 'the pin and the guard are two plan items over one file');
  const [item, guard] = items;
  assert.equal(item.target, 'package.json');
  assert.equal(item.operation, 'set packageManager');
  assert.equal(item.state, 'would-write');
  assert.ok(item.path.startsWith(dir));
  assert.equal(JSON.parse(item.content).packageManager, 'pnpm@12.3.4');
  assert.equal(item.digest.length, 64);
  assert.match(item.reason, /pnpm@12\.3\.4/);

  assert.equal(guard.target, 'package.json', 'the guard rides on the same file');
  assert.equal(guard.operation, 'set devEngines.packageManager');
  assert.equal(guard.state, 'would-write');
  assert.ok(guard.path.startsWith(dir));
  assert.equal(guard.digest.length, 64);
  const guarded = JSON.parse(guard.content);
  assert.deepEqual(guarded.devEngines.packageManager, { name: 'pnpm', version: '12.3.4' });
  assert.equal(
    guarded.packageManager,
    'pnpm@12.3.4',
    'the guard carries the pin its sibling writes, so applying both leaves one consistent file',
  );

  const passing = context();
  passing.repo.root = dir;
  assert.deepEqual(rule.plan(passing, { report: reportFor(null) }), []);
});

test('plan() reports a conflicting pin as a conflict item and writes no guard', (t) => {
  const dir = scratch(t);
  const ctx = context({ packageManager: 'npm@10' });
  ctx.repo.root = dir;

  const items = rule.plan(ctx, { report: reportFor('pin-conflict') });

  assert.equal(items.length, 1, 'a pin the plan cannot establish establishes no version for the guard');
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

test('a malformed package.json is a finding the verdict names, not a pass (S4)', () => {
  const file = {
    path: 'C:/repo/package.json',
    text: '{',
    json: null,
    error: 'Unexpected end of JSON input',
  };

  const [finding] = rule.detect(context({ packageJson: file }));

  assert.equal(finding.status, 'fail', 'a repository the tool cannot read is not a passing repository');
  assert.equal(finding.code, 'unparseable-package-json');
  assert.equal(finding.path, 'package.json');
  assert.match(finding.message, /package\.json is not valid JSON/);
  assert.match(finding.message, /Unexpected end of JSON input/, 'the message says what is wrong');
  assert.deepEqual(finding.remediation, { kind: 'none' }, 'nothing is written to a file that cannot be read');
});

test('an unreadable manifest fails even when the machine is out of scope (S4)', () => {
  // The observed defect: `scan --scope repo` on a truncated package.json exited 0, because the only
  // skip that mentioned it was "no importer package.json could be parsed". The machine scope has no
  // say in whether the repository can be read, so this check comes before the machine checks.
  const ctx = context({
    packageJson: {
      path: 'C:/repo/package.json',
      text: '{ "name": "truncated"',
      json: null,
      error: 'Unexpected end of JSON input',
    },
  });
  ctx.scope = 'repo';
  ctx.machine = null;

  const [finding] = rule.detect(ctx);

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'unparseable-package-json');
});

test('a byte-order mark is said in its own words, not as invalid JSON (S4)', () => {
  const file = {
    path: 'C:/repo/package.json',
    text: '\uFEFF{ "name": "bom" }',
    json: null,
    error: "Unexpected token '\uFEFF', \"\uFEFF{ \"name\": \"bom\" }\" is not valid JSON",
  };

  const [finding] = rule.detect(context({ packageJson: file }));

  assert.equal(finding.code, 'unparseable-package-json');
  assert.match(finding.message, /byte-order mark \(U\+FEFF\)/);
  assert.doesNotMatch(finding.message, /not valid JSON/, 'a byte-order mark is not invalid JSON');
});

test('a declaration that names pnpm and no version fails, and says what to write (S5)', () => {
  // `"packageManager": "pnpm"` used to be classified as "not pnpm", printing "package.json declares
  // pnpm, so this repository is not on pnpm". The field names the manager and declares no version: that
  // is the state `pin-missing` describes — there is no pin — so it is a failure, not a skip. The fix is
  // manual because `init --apply` never rewrites a declaration it finds, and the message names the value
  // that would be verifiable, because "declare a version" is not an instruction without one.
  const [finding] = rule.detect(context({ packageManager: 'pnpm' }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'pin-unversioned');
  assert.equal(finding.path, 'package.json');
  assert.match(finding.message, /declares packageManager "pnpm"/);
  assert.match(finding.message, /no pin can be verified/);
  assert.match(finding.message, /pnpm@12\.3\.4/, 'it names the declaration that would be verifiable');
  assert.doesNotMatch(finding.message, /not on pnpm/, 'a value that names pnpm is not another manager');
  assert.equal(finding.remediation.kind, 'manual');
  assert.match(finding.remediation.command, /pnpm@12\.3\.4/);
});
