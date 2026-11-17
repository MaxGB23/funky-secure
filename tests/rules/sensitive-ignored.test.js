import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../../src/cli.js';
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

test('an untracked .npmrc with a token still names the action: rotate it, then delete the file', () => {
  const text = '//registry.npmjs.org/:_authToken=npm_secret_value\n';
  const [finding] = rule
    .detect(ctx({ npmrc: { path: '/repo/.npmrc', text } }))
    .filter((candidate) => candidate.code === 'npmrc-token');

  assert.equal(finding.remediation.kind, 'manual');
  assert.match(finding.remediation.command, /rotate/);
  assert.match(finding.remediation.command, /\.npmrc/);
  assert.equal(finding.remediation.command.includes('npm_secret_value'), false);
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
  for (const entry of ['.env', '.env.*', '!.env*.example', '*.pem', '*.key', '.npmrc']) {
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

/// The four sides of S3 and the three obligations of S4, driven through the binary over repositories
/// built at runtime (S5). No fixture family is committed, and the candidate names come from
/// `IGNORE_CANDIDATES` — the list the collector itself feeds to `git check-ignore` — so a fixture
/// cannot drift from the list the rule reads. Nothing is committed: the hook a development machine
/// carries refuses an identity, and a suite that commits is red for a fact it never tested. The only
/// fact this rule reads is a git fact, so a host without pnpm answers this file as one with it does.

function capture() {
  return {
    text: '',
    isTTY: false,
    write(chunk) {
      this.text += chunk;
      return true;
    },
  };
}

/** One command of the binary over a real repository, with the probes the tool ships. */
async function cli(dir, argv) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(argv, { cwd: dir, env: process.env, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/** One `scan` of this rule round. */
function scan(dir, argv = []) {
  return cli(dir, ['scan', '--only', 'sensitive-ignored', ...argv]);
}

/**
 * A repository whose ignore file holds exactly `patterns`, and no candidate file at all: the
 * by-contract side is the case where none exists.
 * @param {import('node:test').TestContext} t
 * @param {string[] | null} [patterns]
 * @returns {string}
 */
function gitRepo(t, patterns = null) {
  const dir = scratch(t);
  execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: dir, encoding: 'utf8' });
  if (patterns !== null) writeFileSync(join(dir, '.gitignore'), `${patterns.join('\n')}\n`);
  return dir;
}

/** The counts and the verdict the human report prints, read back from its own lines. */
function humanSummary(text) {
  const counts = /^summary {2}(\d+) errors? · (\d+) warnings? · (\d+) info · (\d+) passing · (\d+) skipped$/m.exec(text);
  assert.ok(counts !== null, `the human report printed no summary line:\n${text}`);
  const verdict = /^verdict {2}(PASS|FAIL) \(threshold: (\w+)/m.exec(text);
  assert.ok(verdict !== null, `the human report printed no verdict line:\n${text}`);
  const [error, warn, info, pass, skip] = counts.slice(1).map(Number);
  return { error, warn, info, pass, skip, verdict: verdict[1].toLowerCase() };
}

/// Side one: it fails by contract, for names that are not ignored — file or no file.

test('side one: a candidate name that is not ignored fails although no such file exists', async (t) => {
  const dir = gitRepo(t);
  assert.deepEqual(
    readdirSync(dir).filter((name) => name !== '.git'),
    [],
    'the by-contract case is the one with no file for the rule to find',
  );

  const { code, stdout, stderr } = await scan(dir, ['--format', 'json']);
  assert.equal(stderr, '');
  const report = JSON.parse(stdout);

  assert.deepEqual(report.summary, { error: 1, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  const [failed] = report.findings;
  assert.equal(failed.status, 'fail');
  assert.equal(failed.code, 'not-ignored');
  assert.equal(failed.severity, 'error');
  assert.equal(failed.path, '.gitignore');
  assert.deepEqual(failed.evidence, { path: '.gitignore', missing: [...IGNORE_CANDIDATES] });
  assert.equal(failed.message, `${IGNORE_CANDIDATES.join(', ')} are not ignored by git`);
  assert.deepEqual(failed.remediation, { kind: 'auto', command: 'funky-secure init --apply' });
  assert.equal(code, 1, 'an error fails the default threshold');
});

test('side one: the finding names only the names that are not ignored, in the declared order', async (t) => {
  const [ignoredName, ...missing] = IGNORE_CANDIDATES;
  const dir = gitRepo(t, [ignoredName]);

  const [failed] = JSON.parse((await scan(dir, ['--format', 'json'])).stdout).findings;

  assert.deepEqual(failed.evidence.missing, missing);
  assert.equal(failed.message, `${missing.join(', ')} are not ignored by git`);
});

/// Side two: it passes, and the pass is counted.

test('side two: every candidate ignored and untracked passes, and the pass is counted', async (t) => {
  const dir = gitRepo(t, IGNORE_CANDIDATES);

  const json = await scan(dir, ['--format', 'json']);
  const report = JSON.parse(json.stdout);
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings, [], 'a passing finding is counted and never listed');
  assert.equal(json.code, 0);

  const human = await scan(dir);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /^summary {2}0 errors · 0 warnings · 0 info · 1 passing · 0 skipped$/m);
  assert.match(human.stdout, /all 1 rule pass/);
});

test('side two: a nested directory inherits the repository root verdict', async (t) => {
  const dir = gitRepo(t, IGNORE_CANDIDATES);
  const nested = join(dir, 'packages', 'api');
  mkdirSync(nested, { recursive: true });

  const report = JSON.parse((await scan(nested, ['--format', 'json'])).stdout);

  assert.deepEqual(
    report.summary,
    { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
    'the candidates are repository-relative, so the directory they are asked from cannot answer for them',
  );
});

/// Side three: it skips for want of a fact, with the code and the fact in the message.

test('side three: outside git it skips with no-git and names the fact, and the skip is counted', async (t) => {
  const dir = scratch(t);

  const json = await scan(dir, ['--format', 'json']);
  const report = JSON.parse(json.stdout);
  assert.equal(json.code, 0, 'a skip is not a failure');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  const [skipped] = report.findings;
  assert.equal(skipped.status, 'skip');
  assert.equal(skipped.code, 'no-git');
  assert.equal(
    skipped.message,
    'skipped: not a git repository, so ignore coverage cannot be evaluated',
  );
  assert.deepEqual(skipped.remediation, { kind: 'none' }, 'a skip has no command to hand anyone');

  const human = await scan(dir);
  assert.match(human.stdout, /^summary {2}0 errors · 0 warnings · 0 info · 0 passing · 1 skipped$/m, 'the human report counts the skip too');
  assert.match(human.stdout, /1 rule not verified: sensitive-ignored/, 'and it names the rule it did not verify');
});

test('side three: a scope that excludes the repository skips with no-repo', async (t) => {
  const dir = gitRepo(t);

  const { code, stdout } = await cli(dir, [
    'scan', '--scope', 'machine', '--only', 'sensitive-ignored', '--format', 'json',
  ]);
  const [skipped] = JSON.parse(stdout).findings;

  assert.equal(code, 0);
  assert.equal(skipped.status, 'skip');
  assert.equal(skipped.code, 'no-repo');
  assert.equal(skipped.message, 'skipped: the repository was excluded by --scope machine');
});

/// Side four: off by policy, with neither a finding nor a count.

test('side four: no preset turns the rule off, and every veto leaves neither a finding nor a count', async (t) => {
  const dir = gitRepo(t);

  // `starter` runs the six day-zero rules at `baseline`, and this rule is one of them; measured, all
  // three presets answer `error` `not-ignored` here, so no preset is the off switch.
  for (const preset of ['baseline', 'strict', 'starter']) {
    const report = JSON.parse((await scan(dir, ['--preset', preset, '--format', 'json'])).stdout);
    assert.equal(report.findings.length, 1, `${preset}: no preset turns this rule off`);
    assert.equal(report.findings[0].code, 'not-ignored', `${preset}: the finding is this rule's`);
    assert.equal(report.findings[0].severity, 'error', `${preset}: the severity survives the preset`);
  }

  const ignored = JSON.parse(
    (await scan(dir, ['--ignore', 'sensitive-ignored', '--format', 'json'])).stdout,
  );
  assert.deepEqual(ignored.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(ignored.findings, [], '--ignore leaves neither a finding nor a count');
  assert.equal(
    (await scan(dir, ['--ignore', 'sensitive-ignored'])).stdout.includes('Sensitive files'),
    false,
    'and the human report does not mention it either',
  );

  const other = JSON.parse(
    (await cli(dir, ['scan', '--only', 'lockfile-committed', '--format', 'json'])).stdout,
  );
  assert.equal(
    other.findings.some((finding) => finding.rule === 'sensitive-ignored'),
    false,
    '--only another rule leaves this one with neither a finding nor a count',
  );

  const before = JSON.parse((await cli(dir, ['scan', '--format', 'json'])).stdout);
  writeFileSync(
    join(dir, 'funky-secure.config.json'),
    `${JSON.stringify({ rules: { 'sensitive-ignored': 'off' } }, null, 2)}\n`,
  );
  const turnedOff = JSON.parse((await cli(dir, ['scan', '--format', 'json'])).stdout);

  assert.equal(turnedOff.findings.some((finding) => finding.rule === 'sensitive-ignored'), false);
  assert.equal(turnedOff.summary.error, before.summary.error - 1, 'off subtracts the one error');
  assert.equal(turnedOff.summary.pass, before.summary.pass, 'and it is not counted as a pass instead');
});

/// S4, the remediation: the command a fail prints clears that fail on a disposable copy.

test('obligation: the printed funky-secure init --apply clears its own finding', async (t) => {
  const dir = gitRepo(t);

  const [failed] = JSON.parse((await scan(dir, ['--format', 'json'])).stdout).findings;
  assert.equal(failed.severity, 'error');
  assert.deepEqual(failed.remediation, { kind: 'auto', command: 'funky-secure init --apply' });

  const [command, ...flags] = failed.remediation.command.split(' ').slice(1);
  const applied = await cli(dir, [command, ...flags]);
  // The command refuses rather than guess when it cannot read the working tree, and it says so. That is
  // the product being honest about a host fact, not a failure of the obligation: on a runner whose
  // fixture cannot answer `git status`, the remediation was never run, and claiming otherwise would be
  // the exact false green this loop exists to remove.
  if (applied.code !== 0 && /cannot check the working tree: git status failed/.test(applied.stdout + applied.stderr)) {
    t.skip('this host cannot answer git status inside the fixture, so the printed command refused by design');
    return;
  }
  assert.equal(applied.code, 0, `the printed command failed:\n${applied.stdout}\n${applied.stderr}`);

  const after = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual(after.findings, [], 'the printed command did not clear its own finding');
  assert.deepEqual(
    after.summary,
    { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
    'and the cleared state is a counted pass',
  );

  // The suggestion is behavioral, not textual: the block the command appended answers the same probe
  // the rule ran, on the same paths — which still do not exist here.
  const probe = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
    cwd: dir,
    encoding: 'utf8',
    input: IGNORE_CANDIDATES.map((path) => `${path}\0`).join(''),
  });
  assert.equal(probe.status, 0, 'the written block does not answer git check-ignore');
  assert.deepEqual(
    probe.stdout.split('\0').filter(Boolean).sort(),
    [...IGNORE_CANDIDATES].sort(),
    'every candidate the rule demands is ignored by the block it suggested',
  );
});

/// S4, the `--no-index` question: the probe answers the ignore rules, never the index.

test('the probe passes --no-index, so a candidate in the index is answered by the ignore rules alone', async (t) => {
  const dir = gitRepo(t, IGNORE_CANDIDATES);
  const candidate = IGNORE_CANDIDATES[0];
  writeFileSync(join(dir, candidate), 'PLACEHOLDER=1\n');
  execFileSync('git', ['add', '-f', '--', candidate], { cwd: dir, encoding: 'utf8' });

  const plain = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
    cwd: dir, encoding: 'utf8', input: `${candidate}\0`,
  });
  assert.equal(plain.status, 1, 'without --no-index git skips a tracked path and prints nothing');
  const noIndex = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
    cwd: dir, encoding: 'utf8', input: `${candidate}\0`,
  });
  assert.equal(noIndex.status, 0, 'with --no-index the same path is answered');

  const report = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
  assert.deepEqual(
    report.summary,
    { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
    'this rule answers about ignore coverage, so a committed candidate is not its finding',
  );

  const tracked = JSON.parse(
    (await cli(dir, ['scan', '--only', 'env-not-tracked', '--format', 'json'])).stdout,
  );
  assert.equal(tracked.findings[0].code, 'env-tracked', 'the repository still fails, through the rule that answers for tracking');
});

/// S4, the two formats: same flags, same status, path, count and message.

test('obligation: both formats agree on status, path, count and message, and neither prints a code', async (t) => {
  const shapes = [
    ['fail', gitRepo(t)],
    ['pass', gitRepo(t, IGNORE_CANDIDATES)],
    ['skip', scratch(t)],
  ];

  for (const [shape, dir] of shapes) {
    const json = JSON.parse((await scan(dir, ['--format', 'json'])).stdout);
    const human = await scan(dir);

    assert.deepEqual(humanSummary(human.stdout), json.summary, `${shape}: the two formats count the same`);
    assert.equal(human.code, json.summary.verdict === 'fail' ? 1 : 0, `${shape}: the exit code follows the verdict`);

    for (const finding of json.findings) {
      const flat = human.stdout.replace(/\s+/g, ' ');
      assert.ok(flat.includes(finding.message), `${shape}: the human report does not carry ${JSON.stringify(finding.message)}`);
      if (finding.path !== undefined) {
        assert.ok(flat.includes(finding.path), `${shape}: the human report does not name ${finding.path}`);
      }
      // Never printed (L5): the human report has no code column for any rule, so parity cannot include one.
      assert.equal(human.stdout.includes(finding.code), false, `${shape}: the human report printed the code ${finding.code}`);
    }
  }
});
