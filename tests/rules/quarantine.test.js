import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolvePolicy } from '../../src/lib/policy.js';
import { BEGIN, END } from '../../src/lib/managed-block.js';
import rule from '../../src/rules/quarantine.js';

/**
 * A plain context: the rule reads a resolved machine fact and nothing else, so no probe, no
 * filesystem and no clock are involved.
 * @param {object | null} config
 * @param {{ version?: string | null, major?: number | null }} [machine]
 */
function ctx(config, { version = '12.3.4', major = 12 } = {}) {
  return {
    scope: 'all',
    cwd: '/repo',
    root: '/repo',
    env: {},
    configPath: null,
    machine: {
      available: true,
      version,
      major,
      executable: '/usr/local/bin/pnpm',
      installations: ['/usr/local/bin/pnpm'],
      config,
      storePath: '/store',
      userAgent: version === null ? null : `pnpm/${version} npm/? node/? linux x64`,
      reportedVersion: version,
      versionAmbiguous: false,
    },
    repo: null,
  };
}

test('declares the fixed contract fields of R4', () => {
  assert.equal(rule.id, 'quarantine');
  assert.equal(rule.friction, 2);
  assert.deepEqual(rule.severity, { baseline: 'warn', strict: 'error' });
  assert.deepEqual(rule.scope, ['repo']);
  assert.deepEqual(rule.targets, ['repo-root']);
  assert.equal(rule.docs, 'docs/rules/quarantine.md');
  assert.ok(rule.question.includes('gate'));
});

test('an inherited 1440-minute default is non-strict and fails quarantine-not-strict', () => {
  const [finding] = rule.detect(ctx({ registry: 'https://registry.npmjs.org/' }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'quarantine-not-strict');
  assert.equal(
    finding.message,
    'quarantine is non-strict: pnpm auto-approves immature packages by writing minimumReleaseAgeExclude (inherited 1440)',
  );
  assert.deepEqual(finding.evidence, {
    effective: 1440,
    inherited: true,
    strict: false,
    policy: 1440,
    exclusions: [],
  });
  assert.deepEqual(finding.remediation, { kind: 'auto', command: 'funky-secure init --apply' });
});

test('the manual route names the file the value lands in, so it cannot read as an .npmrc edit', () => {
  // Measured on pnpm 12.3.4: `pnpm config set minimum-release-age-strict true --location=project`
  // writes pnpm-workspace.yaml and leaves no .npmrc behind. The specification already said so, and the
  // message did not, which is how a reader concludes that the remediation writes the file
  // sensitive-ignored requires them to ignore.
  assert.match(rule.remediation, /pnpm-workspace\.yaml/);
  assert.doesNotMatch(
    rule.remediation,
    /--location=project\./,
    'the location flag is followed by where it lands, never by a full stop',
  );
  assert.match(rule.remediation, /\.npmrc/);
});

test('a configured 4320-minute gate passes the strict preset floor', () => {
  const policy = resolvePolicy({ catalog: [rule], presetFromFlag: 'strict', major: 12 });
  const [finding] = rule.detect(ctx({ minimumReleaseAge: 4320 }), { policy });

  assert.equal(policy.quarantineMinutes, 4320);
  assert.equal(finding.status, 'pass');
  assert.equal(finding.evidence.effective, 4320);
  assert.equal(finding.evidence.inherited, false);
  assert.equal(finding.evidence.strict, true);
  assert.equal(finding.evidence.policy, 4320);
});

test('a strict 1440-minute gate fails quarantine-below-policy under the strict floor', () => {
  const policy = resolvePolicy({ catalog: [rule], presetFromFlag: 'strict', major: 12 });
  const [finding] = rule.detect(ctx({ minimumReleaseAge: 1440 }), { policy });

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'quarantine-below-policy');
  assert.equal(finding.evidence.effective, 1440);
  assert.equal(finding.evidence.strict, true);
  assert.equal(finding.evidence.policy, 4320);
  assert.ok(finding.message.includes('1440'));
  assert.ok(finding.message.includes('4320'));
});

test('without a policy argument the baseline floor of the active major is used', () => {
  const [finding] = rule.detect(ctx({ minimumReleaseAge: 1440 }));

  assert.equal(finding.status, 'pass');
  assert.equal(finding.evidence.policy, 1440);
});

test('before pnpm 11 the inherited default is 0 minutes and still non-strict', () => {
  const [finding] = rule.detect(ctx({}, { version: '10.24.0', major: 10 }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'quarantine-not-strict');
  assert.equal(finding.evidence.effective, 0);
  assert.equal(finding.evidence.inherited, true);
  assert.ok(finding.message.endsWith('(inherited 0)'));
});

test('an explicit non-strict flag fails even when the value meets the floor', () => {
  const [finding] = rule.detect(
    ctx({ minimumReleaseAge: 8640, minimumReleaseAgeStrict: false }),
    { policy: { quarantineMinutes: 4320 } },
  );

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'quarantine-not-strict');
  assert.equal(finding.evidence.effective, 8640);
  assert.equal(finding.evidence.inherited, false);
  assert.equal(finding.evidence.strict, false);
  assert.ok(finding.message.endsWith('(configured 8640)'));
});

test('reports the minimumReleaseAgeExclude entries, never hiding an exemption', () => {
  const exclusions = ['react@0.0.0-experimental-a6b912fb-20261023', 'is-number@7.0.0'];
  const [finding] = rule.detect(
    ctx({ minimumReleaseAge: 4320, minimumReleaseAgeStrict: true, minimumReleaseAgeExclude: exclusions }),
    { policy: { quarantineMinutes: 4320 } },
  );

  assert.equal(finding.status, 'pass');
  assert.deepEqual(finding.evidence.exclusions, exclusions);
});

test('an absent exclusion list is reported as an empty array', () => {
  const [finding] = rule.detect(ctx({ minimumReleaseAge: 4320 }), {
    policy: { quarantineMinutes: 4320 },
  });

  assert.deepEqual(finding.evidence.exclusions, []);
});

test('no pnpm configuration is a skip, not a guessed pass', () => {
  const [finding] = rule.detect(ctx(null));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-pnpm-config');
  assert.equal(finding.probeUnavailable, true);
  assert.ok(finding.message.startsWith('skipped: '));
});

test('a machine excluded by the scope contract says what was not verified and how to verify it', () => {
  const context = ctx(null);
  context.scope = 'repo';
  context.machine = null;

  const [finding] = rule.detect(context);

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'machine-out-of-scope');
  assert.notEqual(
    finding.probeUnavailable,
    true,
    'a scope contract skip is not an unavailable required probe',
  );
  assert.equal(
    finding.message,
    'skipped: the quarantine was not verified because the machine configuration is out of scope; run funky-secure scan --scope all to verify the release-age gate',
  );
});

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-quarantine-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function reportFor(status, code) {
  return { findings: [{ rule: 'quarantine', status, code }] };
}

function withRepo(context, root, workspaceYaml = null) {
  context.repo = {
    root,
    inGit: true,
    branch: 'main',
    files: {
      packageJson: null,
      workspaceYaml: workspaceYaml === null ? null : { path: join(root, 'pnpm-workspace.yaml'), text: workspaceYaml },
      lockfile: null,
      npmrc: null,
      gitignore: null,
    },
    present: [],
    tracked: new Set(),
    ignoreCandidates: [],
    ignored: new Set(),
    importers: [],
    workflows: [],
    botFiles: [],
    editorFiles: [],
    skippedGlobs: [],
  };
  return context;
}

const DECLARED_BLOCK = [BEGIN, 'minimumReleaseAgeStrict: true', "savePrefix: ''", END, ''].join('\n');

test('plan() writes the gate for a repository that declares nothing, whatever the machine applies', (t) => {
  const dir = scratch(t);
  // The effective configuration already satisfies the policy and the report says so; the repository
  // declares nothing, so the plan still writes. This is the defect W1a closes (RFC 11.2.1).
  const satisfied = withRepo(ctx({ minimumReleaseAge: 4320, minimumReleaseAgeStrict: true }), dir);

  const items = rule.plan(satisfied, {
    policy: { preset: 'baseline' },
    report: reportFor('pass'),
  });

  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.target, 'pnpm-workspace.yaml');
  assert.equal(item.operation, 'managed block');
  assert.equal(item.state, 'would-write');
  assert.ok(item.path.startsWith(dir));
  assert.ok(item.content.includes('minimumReleaseAgeStrict: true'));
  assert.ok(item.content.includes("savePrefix: ''"), 'the same block carries savePrefix: \'\' (W1c)');
  assert.ok(!item.content.includes('minimumReleaseAge:'));
  assert.match(item.reason, /minimumReleaseAgeStrict/);
});

test('plan() plans nothing when the repository block declares the keys, and the strict floor comes from it', (t) => {
  const dir = scratch(t);
  // The machine does not satisfy the policy; the repository does. The plan reads the repository.
  const declared = withRepo(ctx({ registry: 'https://registry.npmjs.org/' }), dir, DECLARED_BLOCK);

  assert.deepEqual(
    rule.plan(declared, {
      policy: { preset: 'baseline' },
      report: reportFor('fail', 'quarantine-not-strict'),
    }),
    [],
  );

  const [item] = rule.plan(declared, {
    policy: { preset: 'strict' },
    report: reportFor('fail', 'quarantine-not-strict'),
  });
  assert.equal(item.state, 'would-write');
  assert.ok(item.content.includes('minimumReleaseAgeStrict: true'));
  assert.ok(item.content.includes('minimumReleaseAge: 4320'));
  assert.ok(item.content.includes("savePrefix: ''"));
});

test('plan() refuses to duplicate a key declared outside the managed block', (t) => {
  const dir = scratch(t);
  const context = withRepo(ctx({}), dir, 'minimumReleaseAgeStrict: false\n');

  const [item] = rule.plan(context, {
    policy: { preset: 'baseline' },
    report: reportFor('fail', 'quarantine-not-strict'),
  });

  assert.equal(item.state, 'conflict');
  assert.match(item.reason, /minimumReleaseAgeStrict/);
  assert.equal(item.content, null);
});

test('a minimumReleaseAge that is not a number is a skip, not a coerced zero', () => {
  const [finding] = rule.detect(ctx({ minimumReleaseAge: '4320' }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'unreadable-minimum-release-age');
  assert.equal(finding.probeUnavailable, true);
});
