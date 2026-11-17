import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../../src/cli.js';
import { resolvePolicy } from '../../src/lib/policy.js';
import { collectScan } from '../../src/lib/scan.js';
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
  assert.ok(item.content.includes('minimumReleaseAge: 1440'));
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

/// S3's four sides and S4's obligations, measured with the real probes. `pnpm config list --json`
/// runs with `cwd` = the invocation directory, so a fixture's own `pnpm-workspace.yaml` is the
/// effective gate: that is what makes the failing side reachable at all (the plan's L3).

/**
 * The fixture bytes the field loop measured: a workspace file that sets the flag false. Recorded
 * here byte for byte because a fixture retyped from prose exercises only the shape its author
 * imagined (S5).
 */
const NOT_STRICT = 'minimumReleaseAge: 4320\nminimumReleaseAgeStrict: false\n';
/** A real gate, shorter than the strict preset's 4320-minute floor. */
const BELOW_FLOOR = 'minimumReleaseAge: 1440\nminimumReleaseAgeStrict: true\n';
/** The shape `init --apply` writes: the managed block carries the gate and the baseline floor. */
const GATE_BLOCK = [BEGIN, 'minimumReleaseAgeStrict: true', 'minimumReleaseAge: 4320', END, ''].join('\n');
const IDENTITY = [
  '-c',
  'user.email=82458865+MaxGB23@users.noreply.github.com',
  '-c',
  'user.name=MaxGB23',
];

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

/**
 * One CLI run over a fixture, with the real probes.
 * @param {string} dir
 * @param {string[]} argv
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function cliOn(dir, argv) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(argv, { cwd: dir, env: process.env, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

function scanOn(dir, argv) {
  return cliOn(dir, ['scan', ...argv]);
}

async function reportOf(dir, argv) {
  const { code, stdout, stderr } = await scanOn(dir, [...argv, '--format', 'json']);
  assert.equal(stderr, '');
  return { code, report: JSON.parse(stdout) };
}

/**
 * The counts and verdict the human report prints, read back out of its own lines: a parity test that
 * trusted the JSON alone would compare a format with itself.
 * @param {string} text
 * @returns {{ error: number, warn: number, info: number, pass: number, skip: number, verdict: string }}
 */
function humanSummary(text) {
  const counts = /^summary {2}(\d+) errors? · (\d+) warnings? · (\d+) info · (\d+) passing · (\d+) skipped$/m.exec(text);
  assert.ok(counts !== null, `the human report printed no summary line:\n${text}`);
  const verdict = /^verdict {2}(PASS|FAIL)/m.exec(text);
  assert.ok(verdict !== null, `the human report printed no verdict line:\n${text}`);
  const [error, warn, info, pass, skip] = counts.slice(1).map(Number);
  return { error, warn, info, pass, skip, verdict: verdict[1] };
}

const collapsed = (text) => text.replace(/\s+/g, ' ').trim();

function fixtureDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-quarantine-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A directory whose own `pnpm-workspace.yaml` holds `workspace`; no repository is needed. */
function workspaceFixture(t, workspace) {
  const dir = fixtureDir(t);
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), workspace);
  return dir;
}

/** A committed repository, for the scopes and the commands that need one. */
function repositoryFixture(t, workspace, { config = null } = {}) {
  const dir = fixtureDir(t);
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "quarantine-fixture",\n  "private": true\n}\n');
  if (workspace !== null) writeFileSync(join(dir, 'pnpm-workspace.yaml'), workspace);
  if (config !== null) writeFileSync(join(dir, 'funky-secure.config.json'), config);
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-qm', 'fixture']]) {
    execFileSync('git', [...IDENTITY, ...args], { cwd: dir, encoding: 'utf8' });
  }
  return dir;
}

test('fails with quarantine-not-strict from a fixture whose own pnpm-workspace.yaml sets the flag false', async (t) => {
  const dir = workspaceFixture(t, NOT_STRICT);
  assert.equal(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'), NOT_STRICT);

  const { code, report } = await reportOf(dir, ['--scope', 'machine', '--only', 'quarantine']);
  const [finding] = report.findings;

  assert.equal(code, 0, 'a warning at the default threshold does not fail the run');
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'quarantine-not-strict');
  assert.equal(finding.severity, 'warn');
  assert.equal(
    finding.message,
    'quarantine is non-strict: pnpm auto-approves immature packages by writing minimumReleaseAgeExclude (configured 4320)',
  );
  assert.deepEqual(finding.evidence, {
    effective: 4320,
    inherited: false,
    strict: false,
    policy: 1440,
    exclusions: [],
  });
  assert.deepEqual(finding.remediation, { kind: 'auto', command: 'funky-secure init --apply' });
  assert.deepEqual(report.summary, { error: 0, warn: 1, info: 0, pass: 0, skip: 0, verdict: 'pass' });

  // `--fail-on warn` is the flag a CI uses to make this a gate; the default lets a warning through.
  assert.equal((await scanOn(dir, ['--scope', 'machine', '--only', 'quarantine', '--fail-on', 'warn'])).code, 1);

  const human = await scanOn(dir, ['--scope', 'machine', '--only', 'quarantine']);
  assert.equal(human.code, code);
  assert.match(human.stdout, /^ {2}⚠ {2}Quarantine$/m);
  assert.ok(
    collapsed(human.stdout).includes(collapsed(finding.message)),
    'the human report carries the message the JSON document carries',
  );
  assert.deepEqual(humanSummary(human.stdout), {
    error: 0,
    warn: 1,
    info: 0,
    pass: 0,
    skip: 0,
    verdict: 'PASS',
  });
});

test('fails with quarantine-below-policy when the gate is real and shorter than the strict floor', async (t) => {
  const dir = workspaceFixture(t, BELOW_FLOOR);
  assert.equal(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'), BELOW_FLOOR);

  const { code, report } = await reportOf(dir, [
    '--scope',
    'machine',
    '--only',
    'quarantine',
    '--preset',
    'strict',
  ]);
  const [finding] = report.findings;

  assert.equal(code, 1);
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'quarantine-below-policy');
  assert.equal(finding.severity, 'error');
  assert.equal(finding.message, 'quarantine is 1440 minutes, below the 4320-minute policy floor');
  assert.deepEqual(finding.evidence, {
    effective: 1440,
    inherited: false,
    strict: true,
    policy: 4320,
    exclusions: [],
  });
  assert.deepEqual(report.summary, { error: 1, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });

  const human = await scanOn(dir, ['--scope', 'machine', '--only', 'quarantine', '--preset', 'strict']);
  assert.equal(human.code, code);
  assert.match(human.stdout, /^ {2}✖ {2}Quarantine$/m);
  assert.ok(collapsed(human.stdout).includes(finding.message));

  // The same fixture meets the baseline floor of the active major, so only the preset decides the code.
  const baseline = await reportOf(dir, ['--scope', 'machine', '--only', 'quarantine']);
  assert.deepEqual(baseline.report.summary, {
    error: 0,
    warn: 0,
    info: 0,
    pass: 1,
    skip: 0,
    verdict: 'pass',
  });
});

test('passes on this host with the pass counted, and both formats print that count', async (t) => {
  const dir = workspaceFixture(t, GATE_BLOCK);

  const { report } = await collectScan({
    cwd: dir,
    env: process.env,
    scope: 'machine',
    only: ['quarantine'],
    catalog: [rule],
  });
  const [finding] = report.findings;
  assert.equal(finding.status, 'pass');
  assert.equal(finding.message, 'quarantine is a 4320-minute strict gate (policy floor 1440)');
  assert.equal(finding.evidence.strict, true);

  const json = await reportOf(dir, ['--scope', 'machine', '--only', 'quarantine']);
  assert.deepEqual(json.report.summary, {
    error: 0,
    warn: 0,
    info: 0,
    pass: 1,
    skip: 0,
    verdict: 'pass',
  });
  assert.deepEqual(json.report.findings, [], 'a pass is counted, not listed');

  const human = await scanOn(dir, ['--scope', 'machine', '--only', 'quarantine']);
  assert.equal(human.code, json.code);
  assert.match(human.stdout, /^ {5}all 1 rule pass$/m);
  assert.deepEqual(humanSummary(human.stdout), {
    error: 0,
    warn: 0,
    info: 0,
    pass: 1,
    skip: 0,
    verdict: 'PASS',
  });
});

test('skips at repository scope with machine-out-of-scope, naming the fact it did not verify', async (t) => {
  const dir = repositoryFixture(t, NOT_STRICT);

  const { code, report } = await reportOf(dir, ['--scope', 'repo', '--only', 'quarantine']);
  const [finding] = report.findings;

  assert.equal(code, 0);
  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'machine-out-of-scope');
  assert.equal(finding.probeUnavailable, undefined, 'a scope contract skip is not an unavailable probe');
  assert.deepEqual(finding.remediation, { kind: 'none' });
  assert.equal(
    finding.message,
    'skipped: the quarantine was not verified because the machine configuration is out of scope; run funky-secure scan --scope all to verify the release-age gate',
  );
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
});

test('no preset turns it off, and the policy that does leaves neither a finding nor a count', async (t) => {
  const dir = workspaceFixture(t, NOT_STRICT);

  // `starter` runs this rule at its `baseline` severity, so the finding is still reached.
  const starter = await reportOf(dir, ['--scope', 'machine', '--only', 'quarantine', '--preset', 'starter']);
  assert.equal(starter.report.findings[0].code, 'quarantine-not-strict');

  // `--ignore` wins over `--only`, so the rule is not even narrowed back in.
  const ignored = await reportOf(dir, ['--scope', 'machine', '--ignore', 'quarantine', '--only', 'quarantine']);
  assert.deepEqual(ignored.report.findings, []);
  assert.deepEqual(ignored.report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });

  const off = repositoryFixture(t, NOT_STRICT, { config: '{\n  "rules": {\n    "quarantine": "off"\n  }\n}\n' });
  const configured = await reportOf(off, ['--scope', 'all', '--only', 'quarantine']);
  assert.deepEqual(configured.report.findings, []);
  assert.deepEqual(configured.report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  const human = await scanOn(off, ['--scope', 'all', '--only', 'quarantine']);
  assert.match(human.stdout, /off by policy: Quarantine/);
});

test('the remediation is true: init --apply writes the gate and the finding clears', async (t) => {
  const dir = repositoryFixture(t, [BEGIN, 'minimumReleaseAgeStrict: false', 'minimumReleaseAge: 4320', END, ''].join('\n'));

  const before = await reportOf(dir, ['--scope', 'machine', '--only', 'quarantine']);
  assert.equal(before.report.findings[0].code, 'quarantine-not-strict');

  const init = await cliOn(dir, ['init', '--apply']);
  assert.equal(init.code, 0, init.stderr);

  const written = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(written, /^minimumReleaseAgeStrict: true$/m);
  assert.match(written, /^minimumReleaseAge: 1440$/m);

  const after = await reportOf(dir, ['--scope', 'machine', '--only', 'quarantine']);
  assert.deepEqual(after.report.findings, []);
  assert.equal(after.report.summary.pass, 1);
});
