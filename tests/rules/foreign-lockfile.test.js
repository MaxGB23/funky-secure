import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import rule from '../../src/rules/foreign-lockfile.js';
import { run } from '../../src/cli.js';

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
  assert.deepEqual(
    rule.severityWhen,
    [
      {
        state: 'coexistence',
        evidence: 'pnpmLockfile',
        is: true,
        severity: { baseline: 'error', strict: 'error' },
      },
    ],
    'the coexistence state carries its own severity, and the rule id stays one',
  );
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

test('the message names the state in one register and never escalates with it', () => {
  const [alone] = rule.detect(context(['package.json', 'package-lock.json']));
  const [coexisting] = rule.detect(context(['package.json', 'pnpm-lock.yaml', 'package-lock.json']));

  assert.match(alone.message, /^package-lock\.json is still present; another package manager still shapes this repository$/);
  assert.match(
    coexisting.message,
    /^package-lock\.json is still present beside pnpm-lock\.yaml; another package manager still shapes this repository$/,
    'the coexistence state is named, and the severity carries the weight (0029)',
  );
  for (const message of [alone.message, coexisting.message]) {
    assert.doesNotMatch(message, /breaks in CI|two lockfiles resolve two dependency trees|coexists/);
  }
});

/// End to end: the finding's own severity decides the verdict, and `--fail-on` still compares against
/// it exactly as it does for every other finding (0029, 10.5). The rule runs in isolation here so the
/// exit code says one thing.

/** A repository on disk with `pnpm-lock.yaml` by default and the foreign lockfiles the test names. */
function repository(t, { pnpmLockfile = true, foreign = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-foreign-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'two-trees', packageManager: 'pnpm@12.3.4' }, null, 2)}\n`,
  );
  if (pnpmLockfile) writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  for (const name of foreign) writeFileSync(join(dir, name), '{}\n');
  return dir;
}

/** A collector that resolves `root` as the toplevel and reads only the files the test placed. */
function fakeCollector(root) {
  return {
    read: async (path) => {
      try {
        return { ok: true, value: await readFile(path, 'utf8') };
      } catch (error) {
        return { ok: false, error };
      }
    },
    git: async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return { ok: true, code: 0, stdout: `${root}\n`, stderr: '' };
      }
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
        return { ok: true, code: 0, stdout: 'feat/two-trees\n', stderr: '' };
      }
      if (args[0] === 'ls-files') return { ok: true, code: 0, stdout: '', stderr: '' };
      return { ok: true, code: 1, stdout: '', stderr: '' };
    },
    pnpmVersion: async () => ({ ok: false, reason: 'not-on-path', installations: [] }),
    pnpmConfig: async () => ({ ok: false, reason: 'not-on-path' }),
  };
}

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

/** One `scan` of the rule in isolation, returning its exit code and its two streams. */
async function scan(dir, argv = []) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(['scan', '--scope', 'repo', '--only', 'foreign-lockfile', ...argv], {
    cwd: dir,
    env: {},
    stdout,
    stderr,
    collector: fakeCollector(dir),
  });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

test('a foreign lockfile that stands alone exits 0 under the default --fail-on error', async (t) => {
  const dir = repository(t, { pnpmLockfile: false, foreign: ['package-lock.json'] });

  const { code, stdout, stderr } = await scan(dir);

  assert.equal(stderr, '');
  assert.equal(code, 0, 'the product recommends pnpm, it does not require it');
  assert.match(stdout, /^verdict {2}PASS \(threshold: error\)$/m);
});

test('coexistence with pnpm-lock.yaml exits 1 under the default --fail-on error', async (t) => {
  const dir = repository(t, { foreign: ['package-lock.json'] });

  const { code, stdout, stderr } = await scan(dir);

  assert.equal(stderr, '');
  assert.equal(code, 1, 'two lockfiles are two resolutions, and the default threshold is error');
  assert.match(stdout, /^verdict {2}FAIL \(threshold: error\)$/m);
});

test('--fail-on warn fails both states', async (t) => {
  const alone = repository(t, { pnpmLockfile: false, foreign: ['yarn.lock'] });
  const both = repository(t, { foreign: ['yarn.lock'] });

  const standalone = await scan(alone, ['--fail-on', 'warn']);
  const coexisting = await scan(both, ['--fail-on', 'warn']);

  assert.equal(standalone.code, 1, 'a warn finding fails a run that asks warnings to fail');
  assert.match(standalone.stdout, /^verdict {2}FAIL \(threshold: warn\)$/m);
  assert.equal(coexisting.code, 1);
  assert.match(coexisting.stdout, /^verdict {2}FAIL \(threshold: warn\)$/m);
});

test('--fail-on none passes both states', async (t) => {
  const alone = repository(t, { pnpmLockfile: false, foreign: ['yarn.lock'] });
  const both = repository(t, { foreign: ['yarn.lock'] });

  const standalone = await scan(alone, ['--fail-on', 'none']);
  const coexisting = await scan(both, ['--fail-on', 'none']);

  assert.equal(standalone.code, 0, 'none is the pure-reporting mode and is always a pass');
  assert.match(standalone.stdout, /^verdict {2}PASS \(threshold: none\)$/m);
  assert.equal(coexisting.code, 0);
  assert.match(coexisting.stdout, /^verdict {2}PASS \(threshold: none\)$/m);
});

test('starter runs the rule and inherits both severities', async (t) => {
  const alone = repository(t, { pnpmLockfile: false, foreign: ['package-lock.json'] });
  const both = repository(t, { foreign: ['package-lock.json'] });

  const standalone = await scan(alone, ['--preset', 'starter']);
  const coexisting = await scan(both, ['--preset', 'starter']);

  assert.equal(standalone.code, 0, 'the standalone case keeps the warn of baseline');
  assert.match(standalone.stdout, /^verdict {2}PASS \(threshold: error\)$/m);
  assert.equal(coexisting.code, 1, 'coexistence is the one state starter does not keep gentle');
  assert.match(coexisting.stdout, /^verdict {2}FAIL \(threshold: error\)$/m);
});

test('the JSON document carries the state severity in every preset', async (t) => {
  const alone = repository(t, { pnpmLockfile: false, foreign: ['package-lock.json'] });
  const both = repository(t, { foreign: ['package-lock.json'] });

  for (const preset of ['baseline', 'strict', 'starter']) {
    const standalone = JSON.parse((await scan(alone, ['--format', 'json', '--preset', preset])).stdout);
    const coexisting = JSON.parse((await scan(both, ['--format', 'json', '--preset', preset])).stdout);

    assert.equal(standalone.findings.length, 1, `${preset}: one finding, not two rule ids`);
    assert.equal(standalone.findings[0].rule, 'foreign-lockfile');
    assert.equal(standalone.findings[0].severity, 'warn', `${preset}: a standalone foreign lockfile is a warn`);
    assert.deepEqual(
      [standalone.summary.warn, standalone.summary.error, standalone.summary.verdict],
      [1, 0, 'pass'],
      `${preset}: the summary counts the severity the finding carries`,
    );

    assert.equal(coexisting.findings.length, 1, `${preset}: one finding, not two rule ids`);
    assert.equal(coexisting.findings[0].severity, 'error', `${preset}: coexistence is an error`);
    assert.deepEqual(
      [coexisting.summary.warn, coexisting.summary.error, coexisting.summary.verdict],
      [0, 1, 'fail'],
      `${preset}: the summary counts the severity the finding carries`,
    );
  }
});

test('a repository that turns the rule down keeps the severity it chose', async (t) => {
  const dir = repository(t, { foreign: ['package-lock.json'] });
  writeFileSync(
    join(dir, 'funky-secure.config.json'),
    `${JSON.stringify({ rules: { 'foreign-lockfile': 'warn' } }, null, 2)}\n`,
  );

  const configured = await scan(dir);

  assert.equal(configured.code, 0, 'the config severity wins over the state severity (9.2)');
  assert.match(configured.stdout, /^verdict {2}PASS \(threshold: error\)$/m);

  const ignored = await scan(dir, ['--ignore', 'foreign-lockfile']);

  assert.equal(ignored.code, 0, '--ignore still turns the rule off');
  assert.equal(ignored.stdout.includes('Foreign lockfile'), false, 'an ignored rule prints no finding');
});
