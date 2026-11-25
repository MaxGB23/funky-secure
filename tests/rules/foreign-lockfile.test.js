import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import rule from '../../src/rules/foreign-lockfile.js';
import { createCollector } from '../../src/lib/probes.js';
import { run } from '../../src/cli.js';

/**
 * Whether a pnpm answers here, asked through the resolver the tool already owns: on win32 the manager
 * is a `.cmd` shim, so a bare `spawnSync('pnpm')` answers ENOENT on a machine that has it. The
 * printed remediations run pnpm, so a host without it cannot measure that obligation — and a test may
 * not claim a measurement it did not make.
 * @param {object} t the test context
 * @returns {Promise<boolean>} false when the caller must return
 */
async function pnpmAnswers(t) {
  const resolved = await createCollector({ cwd: process.cwd(), env: process.env }).pnpm();
  if (resolved.file !== null) return true;
  t.skip(`pnpm did not answer (${resolved.reason}), so the printed remediation cannot be run here`);
  return false;
}

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

test('package-lock.json alone fails naming the npm route, which creates the lockfile first', () => {
  const [finding] = rule.detect(context(['package.json', 'package-lock.json']));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'foreign-lockfile');
  assert.match(finding.message, /package-lock\.json/);
  assert.deepEqual(finding.evidence, { files: ['package-lock.json'], pnpmLockfile: false });
  assert.deepEqual(finding.remediation, {
    kind: 'manual',
    command: 'pnpm import && funky-secure migrate --from npm --apply',
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
    command: 'pnpm import && funky-secure migrate --from npm --apply',
  });
});

test('a bun lockfile alone names the auto migration origin', () => {
  const [finding] = rule.detect(context(['package.json', 'bun.lock']));

  assert.equal(finding.status, 'fail');
  assert.deepEqual(finding.evidence, { files: ['bun.lock'], pnpmLockfile: false });
  assert.deepEqual(finding.remediation, {
    kind: 'manual',
    command: 'pnpm import && funky-secure migrate --from auto --apply',
  });
});

test('the route names the lockfile step only while pnpm-lock.yaml is absent', () => {
  const [alone] = rule.detect(context(['package.json', 'package-lock.json']));
  const [beside] = rule.detect(context(['package.json', 'pnpm-lock.yaml', 'package-lock.json']));

  assert.equal(
    alone.remediation.command,
    'pnpm import && funky-secure migrate --from npm --apply',
    'with no lockfile the migrate refuses, so the lockfile step comes first',
  );
  assert.equal(
    beside.remediation.command,
    'funky-secure migrate --from npm --apply',
    'coexistence already has the lockfile, so the migrate clears it alone',
  );
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
  // Canonical like `checkout()` below: this file keeps one convention for a temporary root, so a
  // future caller that reaches a real-git probe cannot inherit the second spelling.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-foreign-')));
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
  return runScan(dir, ['--scope', 'repo', '--only', 'foreign-lockfile', ...argv]);
}

/** One `scan` with flags of the test's own, still off the network: the repository facts come from disk. */
async function runScan(dir, argv) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(['scan', ...argv], {
    cwd: dir,
    env: {},
    stdout,
    stderr,
    collector: fakeCollector(dir),
  });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/** One command of the binary over a real repository, with the real probes the tool ships. */
async function runReal(dir, argv) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(argv, { cwd: dir, env: process.env, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/**
 * The route a finding prints, run as printed: every `&&`-joined step on the fixture, in order.
 *
 * A step the binary owns runs through `run`; a `pnpm` step runs the manager the tool's own resolver
 * found, because on win32 the manager is a `.cmd` shim and a bare `spawnSync('pnpm')` answers ENOENT
 * on a machine that has it. Running what the arrow prints is the only way to know a reader who obeys
 * it does not reach a refusal (rules.md R3).
 * @param {string} dir the repository the route runs in
 * @param {string} command the finding's printed `remediation.command`
 * @returns {Promise<Array<{ step: string, code: number, stdout: string, stderr: string }>>}
 */
async function runPrintedRoute(dir, command) {
  const ran = [];
  for (const step of command.split(' && ').map((piece) => piece.trim())) {
    const argv = step.split(' ').filter((word) => word !== '');
    if (argv[0] === 'pnpm') {
      const pnpm = await createCollector({ cwd: dir, env: process.env }).pnpm();
      assert.notEqual(pnpm.file, null, `the printed route names \`${step}\`, and no pnpm answers here`);
      const child = spawnSync(pnpm.file, [...pnpm.prefixArgs, ...argv.slice(1)], {
        cwd: dir,
        encoding: 'utf8',
        env: process.env,
      });
      ran.push({ step, code: child.status ?? 1, stdout: child.stdout ?? '', stderr: child.stderr ?? '' });
      continue;
    }
    assert.equal(argv[0], 'funky-secure', `the printed route names a step this test cannot run: ${step}`);
    ran.push({ step, ...(await runReal(dir, argv.slice(1))) });
  }
  return ran;
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

/// The four sides of S3 and the three obligations of S4, driven through the binary over repositories
/// built at runtime. Side two is the shape `docs/validation.md:76` measured over the ten clones at
/// `M:/pruebas/real` — eight passing, `catalogs-primefaces-primevue` and `yarnpkg-berry` failing — and
/// a suite cannot assume that machine holds them, so the shapes are built here and the row is re-run,
/// never transcribed (S5).

/** The identity the suite's commits use: a global hook on the development machine refuses others. */
const IDENTITY = [
  '-c',
  'user.email=82458865+MaxGB23@users.noreply.github.com',
  '-c',
  'user.name=MaxGB23',
];

/** A lockfile in the shape npm 11 writes, so `pnpm import` reads a real one and not a stub. */
const NPM_LOCK = '{ "name": "field-loop", "version": "1.0.0", "lockfileVersion": 3, "requires": true, "packages": {} }\n';

/**
 * A checkout the removal commands can run in: a real git repository, on a feature branch, clean, with
 * the lockfiles the test names.
 * @param {import('node:test').TestContext} t
 * @param {{ pnpmLockfile?: boolean, foreign?: string[] }} [shape]
 * @returns {string} the repository directory
 */
function checkout(t, { pnpmLockfile = true, foreign = ['package-lock.json'] } = {}) {
  // Canonical, for the reason `tests/pin.test.js` states. The darwin spellings are the leg's to confirm;
  // the arithmetic is not: `migrate` subtracts `cwd` from a root git resolved, so a mismatched pair
  // turns "is this file dirty" into a pathspec git refuses.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-field-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'field-loop', version: '1.0.0', packageManager: 'pnpm@12.3.4' }, null, 2)}\n`,
  );
  if (pnpmLockfile) writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  for (const name of foreign) writeFileSync(join(dir, name), name === 'package-lock.json' ? NPM_LOCK : '{}\n');

  execFileSync('git', [...IDENTITY, 'init', '-q', '-b', 'feat/foreign'], { cwd: dir, encoding: 'utf8' });
  execFileSync('git', [...IDENTITY, 'add', '-A'], { cwd: dir, encoding: 'utf8' });
  execFileSync('git', [...IDENTITY, 'commit', '-qm', 'the two trees'], { cwd: dir, encoding: 'utf8' });
  return dir;
}

/**
 * The counts and the verdict the human report prints, read back from its own lines.
 * @param {string} text
 * @returns {{ error: number, warn: number, info: number, pass: number, skip: number, verdict: string, failOn: string }}
 */
function humanSummary(text) {
  const counts = /^summary {2}(\d+) errors? · (\d+) warnings? · (\d+) info · (\d+) passing · (\d+) skipped$/m.exec(text);
  assert.ok(counts !== null, `the human report printed no summary line:\n${text}`);
  const verdict = /^verdict {2}(PASS|FAIL) \(threshold: (\w+)/m.exec(text);
  assert.ok(verdict !== null, `the human report printed no verdict line:\n${text}`);
  const [error, warn, info, pass, skip] = counts.slice(1).map(Number);
  return { error, warn, info, pass, skip, verdict: verdict[1].toLowerCase(), failOn: verdict[2] };
}

/// Side one: it fails, at both severities the rule uses, at the target the finding names.

test('side one: an error beside pnpm-lock.yaml and a warn with no pnpm lockfile, at the target the finding names', async (t) => {
  const beside = repository(t, { foreign: ['package-lock.json'] });
  const alone = repository(t, { pnpmLockfile: false, foreign: ['package-lock.json'] });

  const coexisting = JSON.parse((await scan(beside, ['--format', 'json'])).stdout);
  assert.deepEqual(coexisting.summary, { error: 1, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  const [failed] = coexisting.findings;
  assert.equal(failed.code, 'foreign-lockfile');
  assert.equal(failed.severity, 'error');
  assert.equal(failed.status, 'fail');
  // The spec allows a finding whose `path` is absent (report.md: a finding without a path is counted
  // in the block of its target); this rule's location is the repository root and the files it lists.
  assert.equal(failed.path, undefined, 'the finding names no path, so its target is the location');
  assert.equal(failed.target, 'repo-root');
  assert.deepEqual(failed.evidence, { files: ['package-lock.json'], pnpmLockfile: true });
  assert.match(failed.message, /^package-lock\.json is still present beside pnpm-lock\.yaml/);
  assert.equal((await scan(beside)).code, 1, 'an error fails the default threshold');

  const standalone = JSON.parse((await scan(alone, ['--format', 'json'])).stdout);
  assert.deepEqual(standalone.summary, { error: 0, warn: 1, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  const [warned] = standalone.findings;
  assert.equal(warned.code, 'foreign-lockfile');
  assert.equal(warned.severity, 'warn');
  assert.deepEqual(warned.evidence, { files: ['package-lock.json'], pnpmLockfile: false });
  assert.match(warned.message, /^package-lock\.json is still present; another package manager/);
  assert.equal((await scan(alone)).code, 0, 'a warn does not fail the default threshold');
});

/// Side two: it passes, and the pass is counted — `docs/validation.md:76`'s shape.

test('side two: a pnpm lockfile and no foreign lockfile pass, and the pass is counted and never listed', async (t) => {
  const dir = repository(t);

  const report = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings, [], 'a passing finding is counted and never listed');

  const human = await scan(dir);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /^summary {2}0 errors · 0 warnings · 0 info · 1 passing · 0 skipped$/m);
  assert.match(human.stdout, /all 1 rule pass/, 'the human report names the pass it counted');
});

/// Side three: it skips for want of a fact, with the code and the fact it names.

test('side three: with the repository out of scope it skips with no-repo-root and names the fact', async (t) => {
  const dir = repository(t, { foreign: ['package-lock.json'] });

  const json = await runScan(dir, ['--scope', 'machine', '--only', 'foreign-lockfile', '--format', 'json']);
  const report = JSON.parse(json.stdout);

  assert.equal(json.code, 0, 'a skip is not a failure');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  const [skipped] = report.findings;
  assert.equal(skipped.status, 'skip');
  assert.equal(skipped.code, 'no-repo-root');
  assert.equal(
    skipped.message,
    'skipped: the repository was excluded by --scope machine, so foreign lockfiles cannot be listed',
  );
  assert.deepEqual(skipped.remediation, { kind: 'none' }, 'a skip has no command to hand anyone');
});

/// Side four: off by policy, with neither a finding nor a count.

test('side four: no preset turns the rule off, and --ignore, --only or config off leave neither a finding nor a count', async (t) => {
  const dir = repository(t, { foreign: ['package-lock.json'] });

  // `starter` disables every rule outside its day-zero six, and this rule is one of the six. Measured:
  // all three presets answer `error` here, so no preset is the off switch.
  for (const preset of ['baseline', 'strict', 'starter']) {
    const report = JSON.parse(
      (await runScan(dir, ['--scope', 'repo', '--preset', preset, '--only', 'foreign-lockfile', '--format', 'json']))
        .stdout,
    );
    assert.equal(report.findings.length, 1, `${preset}: no preset turns this rule off`);
    assert.equal(report.findings[0].code, 'foreign-lockfile', `${preset}: the finding is this rule's`);
    assert.equal(report.findings[0].severity, 'error', `${preset}: the state severity survives the preset`);
  }

  const vetoed = [
    [
      '--ignore',
      await runScan(dir, ['--scope', 'repo', '--ignore', 'foreign-lockfile', '--only', 'foreign-lockfile', '--format', 'json']),
    ],
    [
      '--only another rule',
      await runScan(dir, ['--scope', 'repo', '--only', 'lockfile-committed', '--format', 'json']),
    ],
  ];

  const before = JSON.parse((await runScan(dir, ['--scope', 'repo', '--format', 'json'])).stdout);
  writeFileSync(
    join(dir, 'funky-secure.config.json'),
    `${JSON.stringify({ rules: { 'foreign-lockfile': 'off' } }, null, 2)}\n`,
  );
  const turnedOff = JSON.parse((await runScan(dir, ['--scope', 'repo', '--format', 'json'])).stdout);
  vetoed.push(['config off', { stdout: JSON.stringify(turnedOff) }]);

  const ignored = JSON.parse(vetoed[0][1].stdout);
  assert.deepEqual(ignored.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(ignored.findings, [], '--ignore leaves neither a finding nor a count');

  for (const [shape, result] of vetoed) {
    const report = JSON.parse(result.stdout);
    assert.equal(
      report.findings.some((finding) => finding.rule === 'foreign-lockfile'),
      false,
      `${shape}: a finding survived the policy`,
    );
  }
  assert.equal(turnedOff.summary.error, before.summary.error - 1, 'config off subtracts the one error');
  assert.equal(turnedOff.summary.pass, before.summary.pass, 'and it is not counted as a pass instead');
});

/// S4, the remediation: the command a fail prints clears that fail on a disposable copy.

test('obligation: the printed command clears the coexistence finding on a disposable copy', async (t) => {
  if (!(await pnpmAnswers(t))) return;
  const dir = checkout(t, { foreign: ['package-lock.json'] });

  const [finding] = JSON.parse((await scan(dir, ['--format', 'json'])).stdout).findings;
  assert.equal(finding.severity, 'error');
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'funky-secure migrate --from npm --apply' });

  const ran = await runReal(dir, ['migrate', '--from', 'npm', '--apply']);
  assert.equal(ran.code, 0, `the printed command failed:\n${ran.stdout}\n${ran.stderr}`);
  assert.equal(existsSync(join(dir, 'package-lock.json')), false, 'the foreign lockfile is still there');

  const after = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual(after.findings, [], 'the printed command did not clear its own finding');
  assert.equal(after.summary.pass, 1, 'and the cleared state is a counted pass');
});

test('obligation: the printed route clears the standalone finding, step by step', async (t) => {
  if (!(await pnpmAnswers(t))) return;
  const dir = checkout(t, { pnpmLockfile: false, foreign: ['package-lock.json'] });

  const [finding] = JSON.parse((await scan(dir, ['--format', 'json'])).stdout).findings;
  assert.equal(finding.code, 'foreign-lockfile');
  assert.equal(finding.severity, 'warn', 'this task moves the printed route, not the severity');

  // Run what the arrow prints, in order, and every step must exit 0 on its own. The single `migrate`
  // this finding printed before the fix refuses here with exit 3 — never delete the only lockfile —
  // so a reader who obeyed the arrow reached a refusal, which is the defect rules.md R3 names.
  const ran = await runPrintedRoute(dir, finding.remediation.command);
  for (const step of ran) {
    assert.equal(
      step.code,
      0,
      `the printed step \`${step.step}\` exited ${step.code}, so the printed route does not clear the finding:\n${step.stdout}\n${step.stderr}`,
    );
  }
  assert.deepEqual(
    ran.map((step) => step.step),
    ['pnpm import', 'funky-secure migrate --from npm --apply'],
    'the route creates pnpm-lock.yaml first and migrates after it',
  );

  assert.equal(existsSync(join(dir, 'package-lock.json')), false, 'the route did not remove the foreign lockfile');
  const after = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual(after.findings, [], 'the printed route did not clear its own finding');
  assert.equal(after.summary.pass, 1, 'and the cleared state is a counted pass');
});

/// PRESERVE: the refusal the sequence exists to avoid is unchanged. `migrate` still refuses to remove
/// the only lockfile and still names the step that creates it; only the route the rule prints moved.

test('obligation: the bare migrate on the same fixture still refuses and still names pnpm import', async (t) => {
  if (!(await pnpmAnswers(t))) return;
  const dir = checkout(t, { pnpmLockfile: false, foreign: ['package-lock.json'] });

  const refused = await runReal(dir, ['migrate', '--from', 'npm', '--apply']);

  assert.equal(refused.code, 3, 'removing the only lockfile must refuse');
  assert.match(`${refused.stdout}${refused.stderr}`, /create pnpm-lock\.yaml first \(run pnpm import\)/);
  assert.equal(existsSync(join(dir, 'package-lock.json')), true, 'a refusal writes nothing');
});

/// S4, the two formats: the same flags answer the same status, code, location and count.

test('obligation: the human report and the JSON document agree in every state the rule reaches', async (t) => {
  const states = [
    ['error', repository(t, { foreign: ['package-lock.json'] }), ['--scope', 'repo', '--only', 'foreign-lockfile']],
    ['warn', repository(t, { pnpmLockfile: false, foreign: ['yarn.lock'] }), ['--scope', 'repo', '--only', 'foreign-lockfile']],
    ['pass', repository(t), ['--scope', 'repo', '--only', 'foreign-lockfile']],
    ['skip', repository(t), ['--scope', 'machine', '--only', 'foreign-lockfile']],
  ];

  for (const [name, dir, flags] of states) {
    const json = await runScan(dir, [...flags, '--format', 'json']);
    const human = await runScan(dir, flags);
    const report = JSON.parse(json.stdout);

    assert.equal(human.code, json.code, `${name}: the two formats disagree about the exit code`);
    assert.equal(human.stderr, '', `${name}: the human run wrote to stderr`);

    const printed = humanSummary(human.stdout);
    assert.deepEqual(
      [printed.error, printed.warn, printed.info, printed.pass, printed.skip],
      [report.summary.error, report.summary.warn, report.summary.info, report.summary.pass, report.summary.skip],
      `${name}: the human counts differ from summary in the JSON document`,
    );
    assert.equal(printed.verdict, report.summary.verdict, `${name}: the verdicts differ`);
    assert.equal(printed.failOn, report.policy.failOn, `${name}: the thresholds differ`);

    const flat = human.stdout.replace(/\s+/g, ' ');
    const listed = /^ {2}[\u2716\u26a0\u2013] {2}Foreign lockfile(?<path>.*)$/m.exec(human.stdout);
    if (report.findings.length === 0) {
      assert.equal(listed, null, `${name}: the human print lists a finding the JSON does not`);
      continue;
    }

    const [finding] = report.findings;
    assert.ok(listed !== null, `${name}: the human print omits the finding the JSON carries`);
    assert.equal(finding.path, undefined, `${name}: the finding names no path`);
    assert.equal(listed.groups.path, '', `${name}: the human print puts a location where neither format has one`);
    assert.ok(flat.includes(finding.message.replace(/\s+/g, ' ')), `${name}: the message differs`);
    assert.ok(
      flat.includes(finding.remediation.kind === 'none' ? 'skipped:' : finding.remediation.command),
      `${name}: the action differs`,
    );
  }
});

/// S4, the page: it describes what the run does, or it is corrected in this change.

test('obligation: the page names the presets that run the rule, the target, and every command it prints', async () => {
  const page = await readFile(new URL('../../docs/rules/foreign-lockfile.md', import.meta.url), 'utf8');

  for (const preset of ['baseline', 'strict', 'starter']) {
    assert.ok(page.includes(preset), `the page never names the ${preset} preset, which runs this rule`);
  }
  assert.equal(
    page.includes('both presets'),
    false,
    'two presets is a claim the binary no longer makes: there are three, and starter is one of them',
  );
  assert.match(page, /repository root/, 'the page names the location the finding carries');

  const commands = new Set(
    [['package-lock.json'], ['yarn.lock'], ['bun.lock']].flatMap((foreign) =>
      rule.detect(context(['package.json', ...foreign])).map((finding) => finding.remediation.command),
    ),
  );
  assert.equal(commands.size, 3, 'the three failing shapes print three different commands');
  for (const command of commands) {
    assert.ok(page.includes(command), `the page never names \`${command}\`, which the finding prints`);
  }

  // Measured above: with no pnpm lockfile the printed command refuses and names step 3.
  assert.match(page, /pnpm import/, 'the page never names the step a standalone foreign lockfile needs first');
});

