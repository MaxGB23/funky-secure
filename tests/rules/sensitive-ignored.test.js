import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IGNORE_CANDIDATES } from '../../src/lib/targets.js';
import rule from '../../src/rules/sensitive-ignored.js';

/**
 * A plain context: the ignore verdict is a resolved fact (`git check-ignore` ran before the rule),
 * the tracked list is a resolved set and the only file text is the root `.npmrc`.
 * @param {object} options
 */
function ctx({
  ignored = [...IGNORE_CANDIDATES],
  tracked = [],
  npmrc = null,
  inGit = true,
} = {}) {
  return {
    scope: 'repo',
    cwd: '/repo',
    root: inGit ? '/repo' : null,
    env: {},
    configPath: null,
    machine: null,
    repo: {
      root: '/repo',
      inGit,
      branch: inGit ? 'main' : null,
      files: { packageJson: null, workspaceYaml: null, lockfile: null, npmrc, gitignore: null },
      present: [],
      tracked: tracked === null ? null : new Set(tracked),
      ignoreCandidates: IGNORE_CANDIDATES,
      ignored: ignored === null ? null : new Set(ignored),
      importers: [],
      workflows: [],
      botFiles: [],
      editorFiles: [],
      skippedGlobs: [],
    },
  };
}

test('declares the fixed contract fields of R7', () => {
  assert.equal(rule.id, 'sensitive-ignored');
  assert.equal(rule.friction, 0);
  assert.deepEqual(rule.severity, { baseline: 'error', strict: 'error' });
  assert.deepEqual(rule.scope, ['repo']);
  assert.deepEqual(rule.targets, ['repo-root']);
  assert.equal(rule.docs, 'docs/rules/sensitive-ignored.md');
});

test('every candidate ignored and nothing sensitive tracked passes', () => {
  const findings = rule.detect(ctx({ tracked: ['.env.example', 'docs/keys.md', 'src/index.js'] }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].code, undefined);
});

test('missing ignore coverage is one finding that names every missing entry', () => {
  const ignored = IGNORE_CANDIDATES.filter((path) => path !== '.env' && path !== 'server.key');
  const findings = rule.detect(ctx({ ignored }));
  const failures = findings.filter((finding) => finding.status === 'fail');

  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 'not-ignored');
  assert.deepEqual(failures[0].evidence, {
    path: '.gitignore',
    missing: ['.env', 'server.key'],
  });
  assert.ok(failures[0].message.includes('.env'));
  assert.ok(failures[0].message.includes('server.key'));
  assert.deepEqual(failures[0].remediation, {
    kind: 'auto',
    command: 'funky-secure init --apply',
  });
});

test('a tracked .env.example is a template, not a secret', () => {
  const findings = rule.detect(
    ctx({ tracked: ['.env.example', '.env.sample', 'config/server.key.example'] }),
  );

  assert.deepEqual(
    findings.map((finding) => finding.status),
    ['pass'],
  );
});

test('a root .npmrc without a token is not a finding when it is ignored', () => {
  const findings = rule.detect(
    ctx({ npmrc: { path: '/repo/.npmrc', text: 'registry=https://registry.npmjs.org/\n' } }),
  );

  assert.deepEqual(
    findings.map((finding) => finding.status),
    ['pass'],
  );
});

test('a root .npmrc with an auth token is redacted in the evidence and absent from the message', () => {
  const text = 'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=npm_secret_value\n';
  const findings = rule.detect(ctx({ npmrc: { path: '/repo/.npmrc', text } }));
  const failures = findings.filter((finding) => finding.status === 'fail');

  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 'npmrc-token');
  assert.equal(failures[0].path, '.npmrc');
  assert.deepEqual(failures[0].evidence, { path: '.npmrc', token: '<redacted>' });
  assert.ok(!JSON.stringify(failures[0]).includes('npm_secret_value'));
});

test('tracked *.pem and *.key files are findings with a manual removal command', () => {
  const findings = rule.detect(ctx({ tracked: ['certs/server.pem', 'server.key', 'src/index.js'] }));
  const failures = findings.filter((finding) => finding.status === 'fail');

  assert.deepEqual(
    failures.map((finding) => finding.code),
    ['tracked-sensitive-file', 'tracked-sensitive-file'],
  );
  assert.deepEqual(
    failures.map((finding) => finding.path),
    ['certs/server.pem', 'server.key'],
  );
  assert.deepEqual(failures[0].remediation, {
    kind: 'manual',
    command: 'git rm --cached certs/server.pem',
  });
});

test('outside git the rule skips instead of assuming ignore coverage', () => {
  const [finding] = rule.detect(ctx({ ignored: null, inGit: false }));

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-git');
  assert.equal(finding.probeUnavailable, true);
  assert.ok(finding.message.startsWith('skipped: '));
});

test('an unreadable tracked set is a skip, never an assumed empty set', () => {
  const findings = rule.detect(ctx({ tracked: null }));

  assert.deepEqual(
    findings.map((finding) => [finding.status, finding.code]),
    [['skip', 'unreadable-tracked-files']],
  );
});

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-sensitive-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function reportFor(status, code) {
  return { findings: [{ rule: 'sensitive-ignored', status, code }] };
}

function withRoot(context, dir) {
  context.root = dir;
  context.repo.root = dir;
  return context;
}

test('plan() writes the ignore block only when the rule fails', (t) => {
  const dir = scratch(t);
  const failing = withRoot(ctx({ ignored: [] }), dir);

  const items = rule.plan(failing, { report: reportFor('fail', 'not-ignored') });

  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.target, '.gitignore');
  assert.equal(item.operation, 'managed block');
  assert.equal(item.state, 'would-write');
  assert.ok(item.path.startsWith(dir));
  for (const entry of ['.env', '.env.*', '!.env.example', '!.env.test.example', '*.pem', '*.key', '.npmrc']) {
    assert.ok(item.content.split('\n').includes(entry), `missing ${entry}`);
  }

  const passing = withRoot(ctx(), dir);
  assert.deepEqual(rule.plan(passing, { report: reportFor('pass') }), []);
});

test('plan() omits .npmrc when the repository tracks a tokenless root .npmrc', (t) => {
  const dir = scratch(t);
  const context = withRoot(
    ctx({
      ignored: [],
      tracked: ['.npmrc'],
      npmrc: { path: join(dir, '.npmrc'), text: 'registry=https://registry.npmjs.org/\n' },
    }),
    dir,
  );

  const [item] = rule.plan(context, { report: reportFor('fail', 'not-ignored') });

  assert.ok(!item.content.split('\n').includes('.npmrc'));
  assert.match(item.reason, /\.npmrc is omitted/);
});

test('without a resolved repository the rule skips', () => {
  const [finding] = rule.detect({ ...ctx(), repo: null });

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-repo');
  assert.equal(finding.probeUnavailable, true);
});

test('a tracked root .npmrc without a token is not required to be ignored', () => {
  const ignored = ['.env', '.env.local', '.env.production', 'secrets.pem', 'server.key'];
  const base = ctx({ ignored, tracked: ['.npmrc'], npmrc: { path: '/repo/.npmrc', text: 'registry=https://registry.npmjs.org/\n' } });

  const withoutFact = rule.detect(base);
  assert.equal(
    withoutFact.some((finding) => finding.code === 'not-ignored'),
    true,
    'the ignore requirement stands until the collector resolves the exception',
  );

  base.repo.npmrc = { tracked: true, hasToken: false, tokenlessTracked: true };
  const withFact = rule.detect(base);

  assert.deepEqual(withFact.filter((finding) => finding.status === 'fail'), []);
});

test('a tracked .npmrc with a token is reported even when it is not ignored', () => {
  const context = ctx({
    ignored: [...IGNORE_CANDIDATES],
    tracked: ['.npmrc'],
    npmrc: { path: '/repo/.npmrc', text: '//registry.npmjs.org/:_authToken=secret\n' },
  });
  context.repo.npmrc = { tracked: true, hasToken: true, tokenlessTracked: false };

  const findings = rule.detect(context);
  const token = findings.find((finding) => finding.code === 'npmrc-token');

  assert.ok(token);
  assert.equal(JSON.stringify(findings).includes('secret'), false, 'the value never reaches the report');
});
