import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import rule from '../../src/rules/env-not-tracked.js';

const BIN = fileURLToPath(new URL('../../bin/funky-secure.js', import.meta.url));
// The identity the suite's other commits use: this machine carries a global hook that refuses any
// other author, and a test that fails on the developer's git config is a test nobody keeps running.
const IDENTITY = [
  '-c',
  'user.email=82458865+MaxGB23@users.noreply.github.com',
  '-c',
  'user.name=MaxGB23',
];

/**
 * Runs git in the fixture, with the identity a machine-wide hook accepts.
 * @param {string} dir
 * @param {string[]} args
 * @returns {string}
 */
function git(dir, args) {
  return execFileSync('git', [...IDENTITY, ...args], { cwd: dir, encoding: 'utf8' });
}

/**
 * A repository that committed an environment file, with an empty nested package directory to run
 * the binary from.
 * @param {import('node:test').TestContext} t
 * @returns {string} the repository directory
 */
function committedEnvironmentRepository(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'package.json'), '{\n  "name": "field-loop",\n  "private": true\n}\n');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  writeFileSync(join(dir, '.env'), 'TOKEN=not-a-real-value\n');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', 'package.json', 'pnpm-lock.yaml', '.env']);
  git(dir, ['commit', '-qm', 'the committed environment file']);
  mkdirSync(join(dir, 'packages', 'api'), { recursive: true });

  return dir;
}

/** A complete repository fact set, as `src/lib/targets.js` resolves it. */
function repo(overrides = {}) {
  return {
    root: '/repo',
    inGit: true,
    branch: 'main',
    files: {
      packageJson: null,
      workspaceYaml: null,
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
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    scope: 'repo',
    cwd: '/repo',
    root: '/repo',
    env: {},
    configPath: null,
    machine: null,
    repo: repo(),
    ...overrides,
  };
}

test('fails a committed .env and names the rotation requirement', () => {
  const findings = rule.detect(context({ repo: repo({ tracked: new Set(['.env', 'package.json']) }) }));

  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'env-tracked');
  assert.equal(finding.path, '.env');
  assert.deepEqual(finding.evidence, { path: '.env' });
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'git rm --cached .env' });
  assert.match(finding.message, /\.env/);
  assert.match(finding.message, /rotat/i);
});

test('passes when only template names are tracked, nested templates included', () => {
  const tracked = new Set([
    '.env.example',
    '.env.sample',
    '.env.template',
    '.env.dist',
    '.env.test.example',
    'packages/api/.env.example',
  ]);

  const findings = rule.detect(context({ repo: repo({ tracked }) }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'no-env-tracked');
});

/**
 * S1.3: the exception covers the template FAMILY, not two spellings of it. `vercel/nextjs-subscription-payments`
 * tracks `.env.example` and `.env.local.example`, both templates with empty or public values that its
 * README tells the reader to copy. A rule that asks for rotation over an empty template teaches
 * people to ignore the rule.
 */
test('accepts the .env*.example template family, at any depth', () => {
  const tracked = new Set([
    '.env.local.example',
    '.env.production.example',
    '.env.staging.example',
    'apps/web/.env.test.example',
    'packages/api/.env.local.example',
  ]);

  const findings = rule.detect(context({ repo: repo({ tracked }) }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, 'no-env-tracked');
});

test('a real .env and .env.local stay findings next to the templates, with the same wording', () => {
  const tracked = new Set(['.env', '.env.local', '.env.local.example', '.env.production.example']);

  const findings = rule.detect(context({ repo: repo({ tracked }) }));

  assert.deepEqual(
    findings.map((finding) => [finding.status, finding.path]),
    [
      ['fail', '.env'],
      ['fail', '.env.local'],
    ],
  );
  for (const finding of findings) {
    assert.equal(finding.code, 'env-tracked');
    assert.equal(
      finding.message,
      `${finding.path} is tracked by git; removing it from the index (git rm --cached ${finding.path}) ` +
        'does not remove it from history, so the credentials it contains must be rotated',
    );
    assert.deepEqual(finding.remediation, { kind: 'manual', command: `git rm --cached ${finding.path}` });
  }
});

test('only a name that ends with .example is a template', () => {
  const tracked = new Set([
    '.env.example.bak',
    '.env.local.example.txt',
    '.env.examples',
    '.envrc',
    '.env.local',
  ]);

  const findings = rule.detect(context({ repo: repo({ tracked }) }));

  assert.deepEqual(
    findings.map((finding) => [finding.status, finding.path]),
    [
      ['fail', '.env.example.bak'],
      ['fail', '.env.examples'],
      ['fail', '.env.local'],
      ['fail', '.env.local.example.txt'],
      ['fail', '.envrc'],
    ],
  );
});

test('fails an environment file nested at any depth', () => {
  const findings = rule.detect(
    context({ repo: repo({ tracked: new Set(['packages/api/.env', 'src/index.js']) }) }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'fail');
  assert.equal(findings[0].code, 'env-tracked');
  assert.equal(findings[0].path, 'packages/api/.env');
  assert.deepEqual(findings[0].remediation, {
    kind: 'manual',
    command: 'git rm --cached packages/api/.env',
  });
  assert.match(findings[0].message, /must be rotated/, 'the message keeps the rotation the fix does not do');
});

test('reports one finding per tracked environment file, in path order', () => {
  const findings = rule.detect(
    context({ repo: repo({ tracked: new Set(['b/.env', '.env.local', '.env']) }) }),
  );

  assert.deepEqual(
    findings.map((finding) => [finding.status, finding.path]),
    [
      ['fail', '.env'],
      ['fail', '.env.local'],
      ['fail', 'b/.env'],
    ],
  );
  assert.deepEqual(
    findings.map((finding) => finding.remediation.command),
    ['git rm --cached .env', 'git rm --cached .env.local', 'git rm --cached b/.env'],
    'every tracked environment file names its own index removal',
  );
});

test('ignores a path whose basename does not start with .env', () => {
  const findings = rule.detect(
    context({ repo: repo({ tracked: new Set(['env.example', 'docs/env.md']) }) }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
});

test('skips outside git instead of guessing the tracked set', () => {
  const findings = rule.detect(context({ repo: repo({ inGit: false, branch: null, tracked: null }) }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'skip');
  assert.equal(findings[0].code, 'no-git');
  assert.match(findings[0].message, /^skipped: /);
  assert.equal(findings[0].probeUnavailable, true);
});

test('skips when no repository facts were collected, naming the reason the context carries', () => {
  const absent = rule.detect(context({ repo: null }));

  assert.equal(absent.length, 1);
  assert.equal(absent[0].status, 'skip');
  assert.equal(absent[0].code, 'no-repo');
  assert.equal(absent[0].probeUnavailable, true);
  assert.equal(absent[0].message, 'skipped: no repository was resolved');

  // #334: the scope excluded the repository, which is not the same fact as an absent one, and the
  // decision keeps the code because the caller that passed the flag already holds it.
  const excluded = rule.detect(context({ repo: null, repoOutOfScope: true }));

  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].code, 'no-repo');
  assert.equal(excluded[0].message, 'skipped: the repository was excluded by --scope machine');
});

/// The collector resolves the tracked set from the repository root, not the invocation directory
/// (#347): a committed environment file is a failure wherever the command runs.

test('the binary fails a committed .env from a nested directory as tracked, not as untracked (#347)', async (t) => {
  const dir = committedEnvironmentRepository(t);

  const result = spawnSync(
    process.execPath,
    [BIN, 'scan', '--scope', 'repo', '--only', 'env-not-tracked', '--format', 'json'],
    { cwd: join(dir, 'packages', 'api'), encoding: 'utf8', env: process.env },
  );

  assert.equal(result.stderr, '');
  assert.equal(result.status, 1, `a committed environment file must fail the run:\n${result.stdout}`);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.summary, { error: 1, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });

  const [finding] = report.findings;
  assert.equal(finding.rule, 'env-not-tracked');
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'env-tracked', 'the file is tracked; the rule never reports an untracked env file');
  assert.equal(finding.path, '.env');
  assert.deepEqual(finding.evidence, { path: '.env' });
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'git rm --cached .env' });
});

/// The four sides of S3 and the obligations of S4, measured through the binary on a repository the
/// test builds in the OS temp directory: a constructed context is not a repository, and a fixture
/// written by the same hand as the parser proves only the shape its author imagined (S5).

/**
 * Runs `scan --scope repo --format json` in a fixture and returns its result with the report parsed.
 * @param {string} dir
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string, report: object }}
 */
function scan(dir, args) {
  const result = spawnSync(
    process.execPath,
    [BIN, 'scan', '--scope', 'repo', '--format', 'json', ...args],
    { cwd: dir, encoding: 'utf8', env: process.env },
  );
  return { ...result, report: result.stdout === '' ? null : JSON.parse(result.stdout) };
}

/**
 * The same run in the human format, which is presentation and carries no `code`.
 * @param {string} dir
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function scanHuman(dir, args) {
  return spawnSync(process.execPath, [BIN, 'scan', '--scope', 'repo', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: process.env,
  });
}

/** A repository with no environment file at all: the passing side of S3. */
function cleanRepository(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-env-clean-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'package.json'), '{\n  "name": "field-loop",\n  "private": true\n}\n');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', 'package.json', 'pnpm-lock.yaml']);
  git(dir, ['commit', '-qm', 'a repository with no environment file']);

  return dir;
}

test('the two formats agree on a committed environment file (S4)', (t) => {
  const dir = committedEnvironmentRepository(t);
  const args = ['--only', 'env-not-tracked'];

  const machine = scan(dir, args);
  const human = scanHuman(dir, args);

  assert.equal(machine.stderr, '');
  assert.equal(human.stderr, '');
  assert.equal(machine.status, 1, 'a committed environment file fails the run');
  assert.equal(human.status, 1, 'both formats agree on the status, which is the exit code');

  assert.equal(machine.report.summary.error, 1);
  assert.equal(machine.report.summary.pass, 0);
  const [finding] = machine.report.findings;
  assert.equal(finding.rule, 'env-not-tracked');
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'env-tracked');
  assert.equal(finding.path, '.env');

  // The same facts a human reads: the failing symbol, the rule's label, the path and the count.
  assert.match(human.stdout, /✖ {2}Environment files {2}· {2}\.env/);
  assert.match(human.stdout, /1 error · 0 warnings · 0 info · 0 passing · 0 skipped/);
  assert.match(human.stdout, /verdict {2}FAIL \(threshold: error\)/);
  assert.match(human.stdout, /is tracked by git/);
  assert.match(human.stdout, /must be rotated/);
  assert.ok(
    human.stdout.includes(`→ ${finding.remediation.command}`),
    'the human report prints the command the finding carries',
  );

  // The human format carries no `code` for any rule, so parity is status, path and count — never a
  // comparison of a field the format does not print.
  assert.ok(!human.stdout.includes('env-tracked'), 'the human report prints no code');
});

test('the printed remediation clears the finding and leaves the working copy byte for byte (S4)', (t) => {
  const dir = committedEnvironmentRepository(t);
  const before = readFileSync(join(dir, '.env'), 'utf8');

  const failing = scan(dir, ['--only', 'env-not-tracked']);
  assert.equal(failing.status, 1);
  const [finding] = failing.report.findings;
  assert.equal(finding.remediation.kind, 'manual');
  assert.equal(finding.remediation.command, 'git rm --cached .env');

  // The command the finding prints, run exactly as printed, in the disposable copy.
  const [executable, ...words] = finding.remediation.command.split(' ');
  const removal = spawnSync(executable, [...IDENTITY, ...words], { cwd: dir, encoding: 'utf8' });
  assert.equal(removal.status, 0, `${finding.remediation.command} failed:\n${removal.stderr}`);
  git(dir, ['commit', '-qm', 'stop tracking the environment file']);

  // S5: the absence is asserted directly, and the copy the command promised to keep is intact.
  assert.ok(!git(dir, ['ls-files']).split('\n').includes('.env'), 'the path is out of the index');
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), before, 'git rm --cached deletes nothing');

  const cleared = scan(dir, ['--only', 'env-not-tracked']);
  assert.equal(cleared.status, 0, 'the finding the command named is gone');
  assert.deepEqual(cleared.report.summary, {
    error: 0,
    warn: 0,
    info: 0,
    pass: 1,
    skip: 0,
    verdict: 'pass',
  });
  assert.deepEqual(cleared.report.findings, []);
});

test('a repository with no environment file passes, and the pass is counted (S3)', (t) => {
  const dir = cleanRepository(t);

  const machine = scan(dir, ['--only', 'env-not-tracked']);
  assert.equal(machine.status, 0);
  assert.deepEqual(machine.report.summary, {
    error: 0,
    warn: 0,
    info: 0,
    pass: 1,
    skip: 0,
    verdict: 'pass',
  });
  assert.deepEqual(machine.report.findings, [], 'a pass is counted in the summary, never listed as a finding');

  const human = scanHuman(dir, ['--only', 'env-not-tracked']);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /0 errors · 0 warnings · 0 info · 1 passing · 0 skipped/);
  assert.match(human.stdout, /all 1 rule pass/);
});

test('outside a repository the rule skips with no-git, and --strict-probes refuses the green run (S3)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-env-nogit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "field-loop",\n  "private": true\n}\n');

  const skipped = scan(dir, ['--only', 'env-not-tracked']);
  assert.equal(skipped.status, 0, 'a skip is not a policy violation');
  assert.deepEqual(skipped.report.summary, {
    error: 0,
    warn: 0,
    info: 0,
    pass: 0,
    skip: 1,
    verdict: 'pass',
  });
  const [finding] = skipped.report.findings;
  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-git');
  assert.equal(finding.message, 'skipped: git is not available, so the tracked set is unknown');

  const strict = scan(dir, ['--only', 'env-not-tracked', '--strict-probes']);
  assert.equal(strict.status, 1, '--strict-probes turns the skip into a failure');
  assert.equal(strict.report.summary.error, 1);
  assert.equal(strict.report.summary.skip, 0);
  assert.equal(strict.report.findings[0].code, 'no-git', 'the code survives the escalation');
  assert.match(strict.report.findings[0].message, /git is not available/);
});

test('policy turns the rule off, leaving neither a finding nor a count (S3)', (t) => {
  const dir = committedEnvironmentRepository(t);

  const baseline = scan(dir, []);
  assert.equal(baseline.report.policy.preset, 'baseline');
  const envFindings = baseline.report.findings.filter((finding) => finding.rule === 'env-not-tracked');
  assert.equal(envFindings.length, 1, 'the baseline preset runs the rule');
  assert.equal(envFindings[0].status, 'fail');

  // The `starter` preset lists six rules and turns every other one off (RFC 9.4).
  const starter = scan(dir, ['--preset', 'starter']);
  assert.equal(starter.report.policy.preset, 'starter');
  assert.deepEqual(
    starter.report.findings.filter((finding) => finding.rule === 'env-not-tracked'),
    [],
    'an off rule contributes no finding',
  );
  assert.equal(
    starter.report.summary.error,
    baseline.report.summary.error - 1,
    'an off rule contributes no count either',
  );

  const ignored = scan(dir, ['--ignore', 'env-not-tracked']);
  assert.deepEqual(ignored.report.findings.filter((finding) => finding.rule === 'env-not-tracked'), []);
  assert.equal(ignored.report.summary.error, baseline.report.summary.error - 1);

  // `--only` names another rule: this one is neither a finding nor a count in the narrowed run.
  const narrowed = scan(dir, ['--only', 'lockfile-committed']);
  assert.deepEqual(narrowed.report.findings, []);
  assert.deepEqual(narrowed.report.summary, {
    error: 0,
    warn: 0,
    info: 0,
    pass: 1,
    skip: 0,
    verdict: 'pass',
  });

  writeFileSync(
    join(dir, 'funky-secure.config.json'),
    '{\n  "rules": {\n    "env-not-tracked": "off"\n  }\n}\n',
  );
  const byConfig = scan(dir, []);
  assert.equal(byConfig.report.policy.preset, 'baseline');
  assert.deepEqual(byConfig.report.findings.filter((finding) => finding.rule === 'env-not-tracked'), []);
  assert.equal(byConfig.report.summary.error, baseline.report.summary.error - 1);
});
