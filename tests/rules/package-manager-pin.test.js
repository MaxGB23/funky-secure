import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import rule from '../../src/rules/package-manager-pin.js';
import { run } from '../../src/cli.js';
import { buildFixtureCollector } from '../../scripts/gen-golden.js';

const EXECUTABLE = 'C:/tools/pnpm/bin/pnpm.cmd';

/**
 * The resolution probe this platform runs, spelled the way `resolvePnpm` spells it. A fixture collector
 * stands in for a machine, and *which probe ran out* is part of what a machine reports (`probes.js` is
 * the producer, #354).
 */
const RESOLUTION_PROBE = process.platform === 'win32' ? 'where pnpm' : 'which pnpm';

/**
 * The machine facts a rule receives. `unansweredProbe` is the fact #354 added: the two absences — the
 * resolution running out and `pnpm --version` failing — are different states, and the machine reports
 * which probe did not answer. A double has to name one; the default is what a machine with no pnpm
 * reports, and a test that needs the version failure says so.
 */
function machine(version, unansweredProbe = RESOLUTION_PROBE) {
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
    unansweredProbe: version === null ? unansweredProbe : null,
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

function context({ version = '12.3.4', packageManager = 'pnpm@12.3.4', packageJson: file, unansweredProbe = RESOLUTION_PROBE } = {}) {
  return {
    scope: 'all',
    cwd: 'C:/repo',
    root: 'C:/repo',
    env: {},
    configPath: null,
    machine: machine(version, unansweredProbe),
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

test('a declaration of another manager says what the manifest declares, never where the repository runs (#133)', () => {
  // A repository `migrate` just moved to pnpm still carries `packageManager: npm@...`, because the
  // tool never rewrites a declaration it did not make: W3 is a conflict, so the pin a plan cannot
  // establish is never written over one that exists (`docs/spec/commands.md:51`). The skip is right
  // and the sentence was not: "this repository is not on pnpm" is a claim about the repository, and the
  // only claim the tool can support is the narrower one — the manifest still declares npm.
  const [finding] = rule.detect(context({ packageManager: 'npm@11.13.0' }));

  assert.equal(finding.code, 'not-pnpm');
  assert.match(finding.message, /declares npm@11\.13\.0/, 'it names the declaration it read');
  assert.match(finding.message, /this manifest/, 'the claim is about the manifest');
  assert.doesNotMatch(
    finding.message,
    /repository is not on pnpm/,
    'the repository may be on pnpm while its manifest still declares another manager',
  );
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

test('a guard that names another version than the pin is a skip, whatever pnpm answers (#104)', () => {
  // The defect in #104: the pin equalled the answering pnpm, so the pair passed and the guard was
  // never compared. The guard is read before the machine, and it is compared by name and by version,
  // so a declaration that differs is the declared-and-different state even when the pin matches.
  const json = {
    packageManager: 'pnpm@12.3.4',
    devEngines: { packageManager: { name: 'pnpm', version: '11.0.0' } },
  };
  const [finding] = rule.detect(context({ version: '12.3.4', packageJson: manifest(json) }));

  assert.equal(finding.status, 'skip', 'the guard differs from the pin, so the pin is not verified');
  assert.equal(finding.code, 'self-managed-pin');
  assert.deepEqual(finding.remediation, { kind: 'none' });
});

test('a guard that names another manager than the pin is a skip, whatever pnpm answers (#104)', () => {
  // The two declarations name different managers, which is the declared-and-different state: the pin
  // matching the answering pnpm says nothing about a project whose guard declares another manager.
  const json = {
    packageManager: 'pnpm@12.3.4',
    devEngines: { packageManager: { name: 'npm', version: '11.13.0' } },
  };
  const [finding] = rule.detect(context({ version: '12.3.4', packageJson: manifest(json) }));

  assert.equal(finding.status, 'skip', 'the guard names another manager, so the pin is not verified');
  assert.equal(finding.code, 'self-managed-pin');
  assert.deepEqual(finding.remediation, { kind: 'none' });
});

test('a pin that names another manager is not-pnpm before the guard is read (#104)', () => {
  // A guard does not make an npm repository a pnpm one, and the sentence the rule printed for this
  // state — "declares npm@11.13.0 and manages its own pnpm" — is false on its face.
  const json = {
    packageManager: 'npm@11.13.0',
    devEngines: { packageManager: { name: 'pnpm', version: '12.3.4' } },
  };
  const [finding] = rule.detect(context({ version: '12.3.4', packageJson: manifest(json) }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'not-pnpm', 'the pin names another manager, which the guard cannot change');
  assert.match(finding.message, /npm@11\.13\.0/);
  assert.doesNotMatch(
    finding.message,
    /manages its own pnpm/,
    'the project is on npm: the guard does not make it a pnpm repository',
  );
  assert.deepEqual(finding.remediation, { kind: 'none' });
});

test('a guard equal to the pin is still verified when the answering pnpm matches (#104)', () => {
  // The pair `init --apply` writes, unchanged: equal in name and in version, and the machine agrees.
  const json = {
    packageManager: 'pnpm@12.3.4',
    devEngines: { packageManager: { name: 'pnpm', version: '12.3.4' } },
  };
  const [finding] = rule.detect(context({ version: '12.3.4', packageJson: manifest(json) }));

  assert.equal(finding.status, 'pass');
  assert.equal(finding.code, undefined);
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

test('a pnpm that could not be resolved names the resolution probe that ran, not one it never reached (#354)', () => {
  // The field report: `where pnpm` exited 1, and the sentence blamed `pnpm --version`, a command nobody
  // ran — the report contradicted itself in the next field, where no executable answered. An
  // unverifiable pin is still not a wrong pin, so only the sentence moves.
  const [finding] = rule.detect(context({ version: null, unansweredProbe: 'where pnpm' }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-pnpm');
  assert.equal(
    finding.message,
    'skipped: the probe "where pnpm" did not answer, so the pin cannot be verified',
  );
  assert.doesNotMatch(finding.message, /pnpm --version/, 'the version probe was never reached');
  assert.deepEqual(finding.remediation, { kind: 'none' });
  assert.equal(finding.probeUnavailable, true, 'and --strict-probes still refuses it');
});

test('a pnpm that resolved and then failed names the version probe, and reads unlike the resolution skip (#354)', () => {
  const [resolution] = rule.detect(context({ version: null, unansweredProbe: 'where pnpm' }));
  const [version] = rule.detect(context({ version: null, unansweredProbe: 'pnpm --version' }));

  assert.equal(version.status, 'skip');
  assert.equal(version.code, 'no-pnpm');
  assert.equal(
    version.message,
    'skipped: the probe "pnpm --version" did not answer, so the pin cannot be verified',
  );
  // Both states are one `no-pnpm` skip, so the sentence is the only thing that separates an exhausted
  // resolution from a version command that answered nothing: one test cannot hold that distinction.
  assert.notEqual(version.message, resolution.message);
  assert.deepEqual(version.remediation, { kind: 'none' });
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

test('a repository excluded by the scope says so instead of claiming the root has no manifest (issue 342)', () => {
  const ctx = context();
  ctx.repo = null;
  ctx.repoOutOfScope = true;

  const [finding] = rule.detect(ctx);

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-package-json');
  assert.equal(
    finding.message,
    'skipped: the repository was excluded by --scope machine, so the pin cannot be read',
  );
});

test('a root that resolved without a manifest keeps the manifest sentence (issue 342)', () => {
  const [finding] = rule.detect(context({ packageJson: null }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-package-json');
  assert.equal(
    finding.message,
    'skipped: the repository root has no package.json to read the pin from',
  );
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

  // A passing pin is never rewritten: the plan leaves `packageManager` alone. The guard beside it is
  // the other half of the write (0030), so a manifest that already carries both plans nothing at all.
  const passing = context({
    version: '12.3.4',
    packageJson: manifest({
      packageManager: 'pnpm@12.3.4',
      devEngines: { packageManager: { name: 'pnpm', version: '12.3.4' } },
    }),
  });
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

test('plan() writes the guard alone when the manifest already carries the pin (W3b)', (t) => {
  // The repository this feature exists for: pinned by an earlier release, no guard, where an accidental
  // `npm install` is stopped by nothing. The pin is not rewritten — so there is no pin item — and the
  // guard carries the version that declaration establishes, never the machine's second opinion.
  const dir = scratch(t);
  const ctx = context({ version: '12.3.4', packageManager: 'pnpm@12.3.4' });
  ctx.repo.root = dir;

  const items = rule.plan(ctx, { report: reportFor(null) });

  assert.equal(items.length, 1, 'exactly one item, and it is the guard');
  const [guard] = items;
  assert.equal(guard.target, 'package.json');
  assert.equal(guard.operation, 'set devEngines.packageManager');
  assert.equal(guard.state, 'would-write');
  assert.ok(guard.path.startsWith(dir));
  assert.deepEqual(JSON.parse(guard.content).devEngines.packageManager, {
    name: 'pnpm',
    version: '12.3.4',
  });
  assert.equal(JSON.parse(guard.content).packageManager, 'pnpm@12.3.4', 'the declared pin is kept');
});

test('plan() writes the guard at the declared version, not the machine version (W3b)', (t) => {
  const dir = scratch(t);
  const ctx = context({ version: '12.3.4', packageManager: 'pnpm@12.16.0' });
  ctx.repo.root = dir;

  const items = rule.plan(ctx, { report: reportFor(null) });

  assert.deepEqual(
    items.map((item) => [item.operation, item.state]),
    [['set devEngines.packageManager', 'would-write']],
    'a pin this rule passes is not rewritten, so only the guard is planned',
  );
  assert.equal(
    JSON.parse(items[0].content).devEngines.packageManager.version,
    '12.16.0',
    'the version the manifest ends up declaring, never the answering one',
  );
});

test('plan() plans no package.json item when both declarations are already there (W3b)', (t) => {
  const dir = scratch(t);
  const json = {
    packageManager: 'pnpm@12.3.4',
    devEngines: { packageManager: { name: 'pnpm', version: '12.3.4' } },
  };
  const ctx = context({ version: '12.3.4', packageJson: manifest(json) });
  ctx.repo.root = dir;

  assert.deepEqual(rule.plan(ctx, { report: reportFor(null) }), [], 'nothing to write, so no item');
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

test('an unversioned pin that carries a versioned guard is answered by the guard order (#119)', () => {
  // §8.2 R1 reads the guard before the pin: a guard that declares a `version` is not equal to a pin
  // that declares none, and a differing guard is `skip` whatever pnpm answers. The row before this
  // one still states that an unversioned pin fails, so the intersection of the two is pinned here
  // instead of being left to whichever sentence a reader meets first.
  const json = {
    packageManager: 'pnpm',
    devEngines: { packageManager: { name: 'pnpm', version: '12.3.4' } },
  };
  const [finding] = rule.detect(context({ version: '12.3.4', packageJson: manifest(json) }));

  assert.equal(finding.status, 'skip', 'the guard branch is read first, so the unversioned row loses');
  assert.equal(finding.code, 'self-managed-pin');
  assert.deepEqual(finding.remediation, { kind: 'none' });
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

// The field loop (odd/tasks/field-loop-every-rule.md, T1): the four sides of S3 and the three
// obligations of S4, measured through `scan` — the command a person runs — over
// `tests/fixtures/package-manager-pin/`, because a fixture its author retyped exercises only the shape
// its author imagined (S5).
//
// Where each fixture came from, so a later reader can check it against reality instead of trusting this
// file: every `package.json` there is this repository's own manifest, read from the checkout this suite
// runs in, and each is either those exact bytes or those bytes with one field taken out or set to the
// value its directory is named after. The two unreadable fixtures are the same bytes written the two
// ways a real file stops being JSON: a byte-order mark in front (what an editor on Windows writes) and
// a cut at 20% (what an interrupted write leaves). The integrity hash in `pass-pin-hashed` is the one
// `corepack use pnpm@12.3.4` printed on this machine, which is the shape pnpm itself writes into
// `packageManager`. `machine.json` is the fixture's declared machine, the mechanism
// `scripts/gen-golden.js` already uses, so no fact of this computer enters an assertion.

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'package-manager-pin');
/** Every fixture, so the parity test covers a side a later change adds. */
const SIDES = [
  'fail-unparseable-bom',
  'fail-unparseable-truncated',
  'fail-pin-missing',
  'fail-pin-unversioned',
  'fail-pin-conflict',
  'pass-pin-agrees',
  'pass-pin-differs-from-machine',
  'pass-pin-hashed',
  'skip-no-package-json',
  'skip-no-pnpm',
  'skip-not-pnpm',
  'skip-self-managed-pin',
  'off-by-policy',
];

function stream() {
  return {
    text: '',
    write(chunk) {
      this.text += chunk;
      return true;
    },
    isTTY: false,
  };
}

/** One `scan` over one fixture, through the CLI and the collector the golden gate uses. */
async function scanFixture(name, args = []) {
  const dir = join(FIXTURES, name);
  const stdout = stream();
  const stderr = stream();
  // The fixture collector stands in for a machine, and which probe ran out is part of what a machine
  // reports (`probes.js` is the producer, #354). The double predates that fact — this fixture carries
  // no `machine.json` at all, so its pnpm never resolved — and it is completed here rather than in
  // `scripts/gen-golden.js`, which belongs to the golden gate.
  const base = buildFixtureCollector({ dir });
  const collector = {
    ...base,
    pnpmVersion: async () => {
      const version = await base.pnpmVersion();
      return version.ok ? version : { ...version, probe: RESOLUTION_PROBE };
    },
  };
  const code = await run(['scan', ...args], {
    cwd: dir,
    env: {},
    stdout,
    stderr,
    collector,
  });
  return { name, code, stdout: stdout.text, stderr: stderr.text };
}

/** The report, and this rule's findings, from one `--format json` run. */
function answered(result) {
  const report = JSON.parse(result.stdout);
  return {
    code: result.code,
    report,
    findings: report.findings.filter((finding) => finding.rule === 'package-manager-pin'),
  };
}

/** The counts the human header printed, read back as numbers a machine can compare. */
function humanSummary(text) {
  const line = /^summary {2}(.+)$/m.exec(text);
  assert.ok(line !== null, 'the human report carries a summary line');
  const count = (pattern) => Number(new RegExp(`(\\d+) ${pattern}`).exec(line[1])?.[1] ?? NaN);
  return {
    error: count('errors?'),
    warn: count('warnings?'),
    info: count('info'),
    pass: count('passing'),
    skip: count('skipped'),
  };
}

/** The verdict word the human header printed, as the report spells it. */
function humanVerdict(text) {
  const word = /^verdict {2}(PASS|FAIL)/m.exec(text);
  assert.ok(word !== null, 'the human report carries a verdict line');
  return word[1] === 'PASS' ? 'pass' : 'fail';
}

/** The fixture's own manifest and declared machine, as the context a rule receives. */
function contextFor(name) {
  const dir = join(FIXTURES, name);
  let text;
  try {
    text = readFileSync(join(dir, 'package.json'), 'utf8');
  } catch {
    text = null;
  }
  let json = null;
  let error = null;
  if (text !== null) {
    try {
      json = JSON.parse(text);
    } catch (parseError) {
      error = parseError.message;
    }
  }
  let version = null;
  try {
    version = JSON.parse(readFileSync(join(dir, 'machine.json'), 'utf8')).version;
  } catch {
    version = null;
  }

  const ctx = context({
    version,
    packageJson:
      text === null ? null : { path: join(dir, 'package.json'), text, json, error },
  });
  ctx.cwd = dir;
  ctx.root = dir;
  ctx.repo.root = dir;
  return ctx;
}

/** The manifest a plan item or a command leaves behind, read the way the next run reads it. */
function applied(file, content) {
  return { path: file.path, text: content, json: JSON.parse(content), error: null };
}

test('a package.json that exists and cannot be interpreted fails at package.json, naming what is wrong (S3, 0027)', async () => {
  const cases = [
    { name: 'fail-unparseable-bom', problem: 'byte-order-mark', message: /byte-order mark \(U\+FEFF\)/ },
    { name: 'fail-unparseable-truncated', problem: 'invalid-json', message: /is not valid JSON/ },
  ];

  for (const expected of cases) {
    const { code, findings } = answered(
      await scanFixture(expected.name, ['--only', 'package-manager-pin', '--format', 'json']),
    );

    assert.equal(code, 1, `${expected.name}: an unreadable manifest is not a passing run`);
    assert.equal(findings.length, 1, `${expected.name}: one finding, and not ${findings.length}`);
    const [finding] = findings;
    assert.equal(finding.status, 'fail', expected.name);
    assert.equal(finding.code, 'unparseable-package-json', expected.name);
    assert.equal(finding.path, 'package.json', `${expected.name}: the path is repo-relative`);
    assert.equal(finding.line, undefined, `${expected.name}: a whole-file fact names no line (10.1)`);
    assert.match(finding.message, expected.message, `${expected.name}: the message names the defect`);
    assert.equal(finding.evidence.problem, expected.problem, `${expected.name}: the class is in the report`);
    assert.deepEqual(finding.remediation, { kind: 'none' }, `${expected.name}: nothing is written to it`);
  }
});

test('a manifest that declares no manager fails with pin-missing at package.json (S3)', async () => {
  const { code, findings } = answered(
    await scanFixture('fail-pin-missing', ['--only', 'package-manager-pin', '--format', 'json']),
  );

  assert.equal(code, 1);
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'pin-missing');
  assert.equal(finding.path, 'package.json');
  assert.equal(finding.line, undefined, 'the whole manifest is the fact, so there is no line to name');
  assert.match(
    finding.message,
    /^package\.json declares no packageManager; declare "packageManager": "pnpm@12\.3\.4"/,
  );
  assert.deepEqual(finding.remediation, { kind: 'auto', command: 'funky-secure init --apply' });
});

test('a declaration that names pnpm and pins nothing fails with pin-unversioned at package.json (S3)', async () => {
  const { code, findings } = answered(
    await scanFixture('fail-pin-unversioned', ['--only', 'package-manager-pin', '--format', 'json']),
  );

  assert.equal(code, 1);
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'pin-unversioned');
  assert.equal(finding.path, 'package.json');
  assert.equal(finding.line, undefined);
  assert.equal(finding.remediation.kind, 'manual');
});

test('a pnpm declaration this rule cannot compare fails with pin-conflict at package.json (S3)', async () => {
  const { code, findings } = answered(
    await scanFixture('fail-pin-conflict', ['--only', 'package-manager-pin', '--format', 'json']),
  );

  assert.equal(code, 1);
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'pin-conflict');
  assert.equal(finding.path, 'package.json');
  assert.equal(finding.line, undefined);
  assert.match(finding.message, /pnpm@latest/);
});

test('the ordinary pin that agrees passes, and the pass is counted rather than merely absent (S3)', async () => {
  const human = await scanFixture('pass-pin-agrees', ['--only', 'package-manager-pin']);
  const { report, findings } = answered(
    await scanFixture('pass-pin-agrees', ['--only', 'package-manager-pin', '--format', 'json']),
  );

  assert.equal(human.code, 0, 'a pin that agrees is a passing run');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(findings, [], 'a pass is counted in summary.pass and never listed (10.1)');
  assert.match(human.stdout, /1 passing/, 'the human header counts it');
  assert.match(human.stdout, /all 1 rule pass/, 'and the target block says which');
});

test('a pin the machine does not answer passes with pin-differs-from-machine and carries the machine version as evidence (S3)', async () => {
  const { report, findings } = answered(
    await scanFixture('pass-pin-differs-from-machine', ['--only', 'package-manager-pin', '--format', 'json']),
  );
  const [finding] = rule.detect(contextFor('pass-pin-differs-from-machine'));

  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(findings, [], 'the pass is information: it is counted, not serialized (10.1)');
  assert.equal(finding.status, 'pass');
  assert.equal(finding.code, 'pin-differs-from-machine');
  assert.equal(finding.evidence.declared, 'pnpm@12.3.4');
  assert.equal(finding.evidence.observed, '12.16.0', 'the machine version rides along as evidence');
  assert.deepEqual(finding.remediation, { kind: 'none' }, 'a declared pin is never rewritten');
});

test('a pin that carries its own integrity hash names the version the machine answers, not a difference (S3, S4)', () => {
  // The shape `corepack use pnpm@12.3.4` printed on this machine, and the shape pnpm itself writes into
  // `packageManager`: the version, then `+sha512.…`, the hash of the tarball. The machine answers 12.3.4,
  // so nothing about the machine differs — and the page's table promises `pin-differs-from-machine`
  // "when the machine answers another version". Calling the hash a machine difference is false on its
  // face, and it is the sentence the branch before this one printed.
  const [finding] = rule.detect(contextFor('pass-pin-hashed'));

  assert.equal(finding.status, 'pass', 'the pin is honoured inside the project, so it passes');
  assert.equal(finding.code, undefined, 'the machine answers the same version, so there is no difference');
  assert.equal(finding.evidence.observed, '12.3.4');
  assert.match(finding.message, /\+sha512\./, 'the message names the declaration it read');
  assert.doesNotMatch(finding.message, /that difference describes the machine/, 'there is no such difference');
  assert.deepEqual(finding.remediation, { kind: 'none' });
});

test('a repository root with no manifest skips with no-package-json and says which absence it measured (S3)', async () => {
  const { code, findings } = answered(
    await scanFixture('skip-no-package-json', ['--only', 'package-manager-pin', '--format', 'json']),
  );

  assert.equal(code, 0, 'a skip is not a failure');
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-package-json');
  assert.equal(finding.path, 'package.json');
  assert.equal(
    finding.message,
    'skipped: the repository root has no package.json to read the pin from',
    'the repository resolved and carries no manifest, which is the fact this names',
  );
});

test('a version probe that never answered skips with no-pnpm, and is never a wrong pin (S3)', async () => {
  const skipped = answered(await scanFixture('skip-no-pnpm', ['--only', 'package-manager-pin', '--format', 'json']));
  const strict = answered(
    await scanFixture('skip-no-pnpm', ['--only', 'package-manager-pin', '--format', 'json', '--strict-probes']),
  );

  assert.equal(skipped.code, 0);
  assert.equal(skipped.findings.length, 1);
  const [finding] = skipped.findings;
  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-pnpm');
  assert.equal(
    finding.message,
    `skipped: the probe "${RESOLUTION_PROBE}" did not answer, so the pin cannot be verified`,
    'the absence of a version is the fact, and the probe named is the one that ran (#354)',
  );
  assert.doesNotMatch(finding.message, /pnpm --version/, 'the version probe was never reached');
  assert.deepEqual(finding.remediation, { kind: 'none' });

  // The page's claim: under `--strict-probes` the engine turns that skip into an error.
  const [required] = strict.findings;
  assert.equal(required.status, 'error');
  assert.match(required.message, /\(required probe unavailable\)$/);
  assert.equal(strict.code, 1);
});

test('a manifest that declares another manager skips with not-pnpm, because the pnpm question does not apply (S3)', async () => {
  const human = await scanFixture('skip-not-pnpm', ['--only', 'package-manager-pin']);
  const { report, findings } = answered(
    await scanFixture('skip-not-pnpm', ['--only', 'package-manager-pin', '--format', 'json']),
  );

  assert.equal(human.code, 0);
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  const [finding] = findings;
  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'not-pnpm');
  assert.match(finding.message, /declares npm@11\.13\.0/);
  assert.match(human.stdout, /1 rule not verified: package-manager-pin/, 'the human verdict counts it');
});

test('a pin the project manages elsewhere skips with self-managed-pin, whatever the machine answers (S3)', async () => {
  const { report, findings } = answered(
    await scanFixture('skip-self-managed-pin', ['--only', 'package-manager-pin', '--format', 'json']),
  );

  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  const [finding] = findings;
  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'self-managed-pin');
  assert.match(finding.message, /declares pnpm@12\.16\.0/);
  assert.match(finding.message, /devEngines\.packageManager declares pnpm@12\.3\.4/);
  assert.deepEqual(finding.remediation, { kind: 'none' }, 'and it must never suggest a downgrade');
});

test('no preset turns the rule off: baseline, strict and starter each run it (S3)', async () => {
  // The plan asks which preset turns it off. None does, and a deferral is never the answer when a run
  // can decide it: `starter` names this rule among its six (docs/spec/policy.md), and the other two
  // presets take the rule's own severity. The shapes that do exclude it are the two flags and the
  // repository's own config, tested below.
  for (const preset of ['baseline', 'strict', 'starter']) {
    const { report, findings } = answered(
      await scanFixture('fail-pin-missing', ['--preset', preset, '--only', 'package-manager-pin', '--format', 'json']),
    );

    assert.equal(report.policy.preset, preset);
    assert.equal(findings.length, 1, `${preset} runs the rule and reports its failure`);
    assert.equal(findings[0].code, 'pin-missing', preset);
    assert.equal(report.summary.error, 1, `${preset} counts it`);
  }
});

test('--ignore leaves the rule with neither a finding nor a count, exactly as turning it off in the config does (S3)', async () => {
  const narrowed = await scanFixture('fail-pin-missing', ['--ignore', 'package-manager-pin']);
  const ignored = answered(await scanFixture('fail-pin-missing', ['--ignore', 'package-manager-pin', '--format', 'json']));
  const configuredHuman = await scanFixture('off-by-policy');
  const configured = answered(await scanFixture('off-by-policy', ['--format', 'json']));

  assert.deepEqual(ignored.findings, [], 'no finding');
  assert.equal(narrowed.code, configured.code, 'the run exits the way the config-off run does');
  assert.equal(narrowed.code, 1, 'the two other rules that fail still fail, and only those');
  assert.deepEqual(
    ignored.report.summary,
    configured.report.summary,
    'a rule the policy excludes contributes nothing: the counts are the ones the config-off run prints',
  );
  assert.equal(ignored.report.summary.error, 2);

  // The honesty line belongs to the config, not the flag: 10.3 keeps `not run` for a policy that
  // disables a rule, and a run narrowed by `--only`/`--ignore` never prints it.
  assert.match(configuredHuman.stdout, /^not run {2}12 of 13 rules; off by policy: Package manager$/m);
  assert.doesNotMatch(narrowed.stdout, /^not run /m);
});

test('--only another rule leaves this rule with neither a finding nor a count (S3)', async () => {
  const full = JSON.parse((await scanFixture('fail-pin-missing', ['--format', 'json'])).stdout);
  const narrowed = JSON.parse(
    (await scanFixture('fail-pin-missing', ['--only', 'lockfile-committed', '--format', 'json'])).stdout,
  );

  assert.ok(
    full.findings.some((finding) => finding.rule === 'package-manager-pin'),
    'the full run reports it, so its absence below is a narrowing and not a fixture that never failed',
  );
  assert.ok(narrowed.findings.length > 0, 'the narrowed catalog still reports something');
  assert.ok(narrowed.findings.every((finding) => finding.rule === 'lockfile-committed'));
  assert.equal(
    narrowed.summary.error,
    narrowed.findings.filter(
      (finding) => finding.severity === 'error' && (finding.status === 'fail' || finding.status === 'error'),
    ).length,
    'every error the narrowed run counts belongs to the rule that ran',
  );
});

test('the remediation pin-missing carries is the write that clears it (S4)', (t) => {
  const ctx = contextFor('fail-pin-missing');
  ctx.repo.root = scratch(t);
  const [finding] = rule.detect(ctx);
  assert.deepEqual(finding.remediation, { kind: 'auto', command: 'funky-secure init --apply' });

  // `funky-secure init --apply` performs exactly these two items over one file, and the guard item
  // carries the file the pin item leaves, so applying both is applying the second.
  const items = rule.plan(ctx, {
    report: { findings: [{ rule: 'package-manager-pin', status: 'fail', code: 'pin-missing' }] },
  });
  assert.deepEqual(
    items.map((item) => [item.operation, item.state]),
    [
      ['set packageManager', 'would-write'],
      ['set devEngines.packageManager', 'would-write'],
    ],
  );

  const after = (content) => {
    const file = applied(ctx.repo.files.packageJson, content);
    return rule.detect({ ...ctx, repo: { ...ctx.repo, files: { ...ctx.repo.files, packageJson: file } } })[0];
  };

  assert.equal(after(items[0].content).status, 'pass', 'the pin write alone already clears the finding');
  assert.equal(after(items[1].content).status, 'pass', 'and the pair the plan applies leaves it cleared');
});

test('the command pin-unversioned prints is the command that clears it (S4)', () => {
  const ctx = contextFor('fail-pin-unversioned');
  const [finding] = rule.detect(ctx);

  assert.equal(finding.remediation.kind, 'manual');
  assert.equal(finding.remediation.command, 'pnpm pkg set packageManager="pnpm@12.3.4"');

  // The effect of that command: the value it sets, written into the same manifest.
  const value = /packageManager="([^"]+)"/.exec(finding.remediation.command)[1];
  const file = ctx.repo.files.packageJson;
  const written = `${JSON.stringify({ ...file.json, packageManager: value }, null, 2)}\n`;
  const [after] = rule.detect({
    ...ctx,
    repo: { ...ctx.repo, files: { ...ctx.repo.files, packageJson: applied(file, written) } },
  });

  assert.equal(after.status, 'pass', 'the value that command writes is the pin that verifies');
});

test('the command pin-conflict prints is the command that clears it (S4)', () => {
  const [finding] = rule.detect(contextFor('fail-pin-conflict'));

  assert.equal(finding.remediation.kind, 'manual');
  assert.equal(finding.remediation.command, 'corepack use pnpm@12.3.4');

  // What that command leaves behind, measured on this machine: `pnpm@12.3.4+sha512.…`, the version and
  // the tarball hash. That is the `pass-pin-hashed` fixture, so the conflict is gone and the pin verifies.
  const hashed = JSON.parse(readFileSync(join(FIXTURES, 'pass-pin-hashed', 'package.json'), 'utf8'));
  assert.equal(
    hashed.packageManager.startsWith('pnpm@12.3.4+sha512.'),
    true,
    'the fixture is the shape corepack writes',
  );
  const [after] = rule.detect(contextFor('pass-pin-hashed'));

  assert.equal(after.status, 'pass', 'the conflict is cleared');
  assert.equal(after.code, undefined, 'and the pin is the ordinary verified pass');
});

test('the states with nothing to run say none, and no command would clear them (S4)', () => {
  const cases = [
    ['skip-not-pnpm', 'not-pnpm'],
    ['skip-self-managed-pin', 'self-managed-pin'],
    ['skip-no-pnpm', 'no-pnpm'],
    ['skip-no-package-json', 'no-package-json'],
    ['pass-pin-differs-from-machine', 'pin-differs-from-machine'],
  ];

  for (const [fixture, code] of cases) {
    const [finding] = rule.detect(contextFor(fixture));
    assert.equal(finding.code, code, fixture);
    assert.deepEqual(finding.remediation, { kind: 'none' }, `${code} reports and never writes`);
  }
});

test('both formats report the same verdict, message, path and counts on every side (S4)', async () => {
  const collapsed = (text) => text.replace(/\s+/g, ' ').trim();

  for (const name of SIDES) {
    const human = await scanFixture(name, ['--only', 'package-manager-pin']);
    const json = await scanFixture(name, ['--only', 'package-manager-pin', '--format', 'json']);
    const { report, findings } = answered(json);

    assert.equal(human.code, json.code, `${name}: the two formats exit the same way`);
    assert.equal(human.stderr, '', `${name}: the human run wrote to stderr`);
    assert.equal(json.stderr, '', `${name}: the json run wrote to stderr`);
    assert.equal(humanVerdict(human.stdout), report.summary.verdict, `${name}: the verdicts agree`);
    assert.deepEqual(
      humanSummary(human.stdout),
      {
        error: report.summary.error,
        warn: report.summary.warn,
        info: report.summary.info,
        pass: report.summary.pass,
        skip: report.summary.skip,
      },
      `${name}: the counts agree`,
    );

    for (const finding of findings) {
      assert.ok(
        collapsed(human.stdout).includes(collapsed(finding.message)),
        `${name}: the human report carries the message under the same code (${finding.code})`,
      );
      assert.ok(
        human.stdout.includes(finding.path),
        `${name}: ${finding.code} names ${finding.path} in both formats`,
      );
    }
  }
});

test('the page says the report carries the answering binary path, and the run does (S4)', () => {
  const page = readFileSync(
    join(import.meta.dirname, '..', '..', 'docs', 'rules', 'package-manager-pin.md'),
    'utf8',
  );
  const [finding] = rule.detect(contextFor('fail-pin-missing'));

  // The evidence the rule returns is the evidence the report serializes, verbatim: on a machine that
  // answered, it is an absolute path, and the page used to say a report body never carries one.
  assert.match(finding.evidence.executable, /^[A-Za-z]:[\\/]/, 'the answering binary is an absolute path');
  assert.doesNotMatch(page, /a report body never carries an absolute path/);
  assert.match(page, /absolute path/, 'the page must say which scope produces one');
  assert.match(page, /machine scope/);
});

test('the page names the command pin-unversioned prints, and the guard order that beats that row (S4)', () => {
  const page = readFileSync(
    join(import.meta.dirname, '..', '..', 'docs', 'rules', 'package-manager-pin.md'),
    'utf8',
  );
  const [finding] = rule.detect(contextFor('fail-pin-unversioned'));

  // The run carries a runnable command, so "this one is a hand edit" described a remediation the rule
  // does not print. The page states the command the finding states.
  assert.equal(finding.remediation.command, 'pnpm pkg set packageManager="pnpm@12.3.4"');
  assert.match(page, /pnpm pkg set packageManager="pnpm@<observed version>"/);
  assert.doesNotMatch(page, /This one is a hand edit/);

  // And the table's `pin-unversioned` row is not the whole answer: a differing guard is read first, so
  // `"packageManager": "pnpm"` beside one is a `self-managed-pin` skip and not a failure.
  const [guarded] = rule.detect(
    context({
      version: '12.3.4',
      packageJson: manifest({
        packageManager: 'pnpm',
        devEngines: { packageManager: { name: 'pnpm', version: '12.3.4' } },
      }),
    }),
  );
  assert.equal(guarded.code, 'self-managed-pin');
  assert.match(page, /before the `pin-unversioned` row/, 'the page must say which row wins');
});
