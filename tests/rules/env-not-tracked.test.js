import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  writeFileSync(join(dir, '.env'), 'TOKEN=not-a-real-value\n');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', 'package.json', '.env']);
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
