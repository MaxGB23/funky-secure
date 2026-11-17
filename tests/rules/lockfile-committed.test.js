import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import rule from '../../src/rules/lockfile-committed.js';
import { createCollector } from '../../src/lib/probes.js';
import { run } from '../../src/cli.js';

const LOCKFILE = 'pnpm-lock.yaml';
const BIN = fileURLToPath(new URL('../../bin/funky-secure.js', import.meta.url));

function context({ inGit = true, present = true, tracked = true, ignored = false } = {}) {
  const names = present ? [LOCKFILE] : [];
  return {
    scope: 'all',
    cwd: 'C:/repo',
    root: 'C:/repo',
    env: {},
    configPath: null,
    machine: null,
    repo: {
      root: 'C:/repo',
      inGit,
      branch: inGit ? 'main' : null,
      files: {
        packageJson: null,
        workspaceYaml: null,
        lockfile: present ? { path: 'C:/repo/pnpm-lock.yaml', text: 'lockfileVersion: 9.0' } : null,
        npmrc: null,
        gitignore: null,
      },
      present: names,
      tracked: inGit
        ? new Set([...(present && tracked ? [LOCKFILE] : []), 'package.json'])
        : null,
      ignoreCandidates: ['.env'],
      ignored: inGit ? new Set(ignored ? [LOCKFILE] : []) : null,
      importers: [],
      workflows: [],
      botFiles: [],
      editorFiles: [],
      skippedGlobs: [],
    },
  };
}

test('the rule declares its contract', () => {
  assert.equal(rule.id, 'lockfile-committed');
  assert.equal(rule.friction, 0);
  assert.deepEqual(rule.severity, { baseline: 'error', strict: 'error' });
  assert.deepEqual(rule.scope, ['repo']);
  assert.deepEqual(rule.targets, ['repo-root']);
  assert.equal(rule.docs, 'docs/rules/lockfile-committed.md');
  assert.equal(typeof rule.detect, 'function');
});

test('a present, tracked, not-ignored lockfile passes', () => {
  const [finding] = rule.detect(context());

  assert.equal(finding.status, 'pass');
  assert.equal(finding.code, undefined);
  assert.equal(finding.path, LOCKFILE);
  assert.match(finding.message, /present, tracked and not ignored/);
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: true,
    tracked: true,
    ignored: false,
  });
});

test('an absent lockfile fails with lockfile-missing', () => {
  const [finding] = rule.detect(context({ present: false }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-missing');
  assert.equal(finding.path, LOCKFILE);
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: false,
    tracked: false,
    ignored: false,
  });
});

test('a present but untracked lockfile fails with lockfile-untracked', () => {
  const [finding] = rule.detect(context({ tracked: false }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-untracked');
  assert.match(finding.message, /not tracked/);
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: true,
    tracked: false,
    ignored: false,
  });
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'git add pnpm-lock.yaml' });
});

test('an untracked lockfile that is also ignored is told to force the add, not to add', () => {
  // Remediation conformance sweep: for a lockfile that is both untracked and ignored — the state of a
  // repository that has just added "pnpm-lock.yaml" to its ignore file, which is the reason this rule
  // fires hardest — the printed `git add pnpm-lock.yaml` fails:
  //   "The following paths are ignored by one of your .gitignore files"
  // and exits 1. The command has to be the one that runs in that state.
  const [finding] = rule.detect(context({ tracked: false, ignored: true }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-untracked');
  assert.match(finding.message, /ignore rule matches it/, 'the message names the second condition');
  assert.deepEqual(finding.evidence, { path: LOCKFILE, present: true, tracked: false, ignored: true });
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'git add -f pnpm-lock.yaml' });
});

test('a present, tracked but ignored lockfile fails with lockfile-ignored', () => {
  const [finding] = rule.detect(context({ ignored: true }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-ignored');
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: true,
    tracked: true,
    ignored: true,
  });
  assert.deepEqual(finding.remediation, {
    kind: 'manual',
    // Measured in exactly the state this test describes — a lockfile that is tracked and matched by
    // an ignore rule: `git check-ignore -v pnpm-lock.yaml` exits 1 and prints nothing at all, because
    // git skips tracked paths without `--no-index`. The printed command is the one that answers.
    command: 'git check-ignore -v --no-index pnpm-lock.yaml',
  });
});

test('outside git a present lockfile passes and says the rest was not evaluated', () => {
  const [finding] = rule.detect(context({ inGit: false }));

  assert.equal(finding.status, 'pass');
  assert.match(finding.message, /not evaluated/);
  assert.match(finding.message, /not a git repository/);
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: true,
    tracked: null,
    ignored: null,
  });
});

test('outside git an absent lockfile still fails', () => {
  const [finding] = rule.detect(context({ inGit: false, present: false }));

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-missing');
  assert.deepEqual(finding.evidence, {
    path: LOCKFILE,
    present: false,
    tracked: null,
    ignored: null,
  });
});

test('a lockfile git cannot vouch for is a pass with the gap stated', () => {
  const ctx = context();
  ctx.repo.tracked = null;

  const [finding] = rule.detect(ctx);

  assert.equal(finding.status, 'pass');
  assert.match(finding.message, /not evaluated/);
  assert.equal(finding.evidence.tracked, null);
});

test('a missing ignore verdict is a pass with the gap stated', () => {
  const ctx = context();
  ctx.repo.ignored = null;

  const [finding] = rule.detect(ctx);

  assert.equal(finding.status, 'pass');
  assert.match(finding.message, /ignore rules were not evaluated/);
  assert.equal(finding.evidence.ignored, null);
});

test('outside a repository context the rule skips, naming the reason the context carries', () => {
  const ctx = context();
  ctx.repo = null;

  const [absent] = rule.detect(ctx);

  assert.equal(absent.status, 'skip');
  assert.equal(absent.code, 'no-repo-root');
  assert.equal(
    absent.message,
    'skipped: no repository was resolved, so the lockfile cannot be located',
  );

  // #334: `--scope machine` excluded the repository before anything was resolved, and the clause this
  // rule appends survives the reason it now names.
  const [excluded] = rule.detect({ ...ctx, repoOutOfScope: true });

  assert.equal(excluded.code, 'no-repo-root');
  assert.equal(
    excluded.message,
    'skipped: the repository was excluded by --scope machine, so the lockfile cannot be located',
  );
});

/// The four sides of S3, measured end to end, and the three obligations of S4: the remediation a fail
/// prints is a command that runs in the state that printed it, the two formats answer the same thing,
/// and the page names what the run prints. The unit tests above hand the rule a fact set; these drive
/// the binary over a real git repository, because the facts this rule reads — `git ls-files` and
/// `git check-ignore` — are the ones a hand-built set cannot get wrong in the way the product can.

/** The identity the suite's commits use: a global hook on the development machine refuses others. */
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
 * A repository in the shape one finding describes:
 *
 *  - `missing` — the manifest alone, which is a project that never installed.
 *  - `untracked` — an installed lockfile git never saw.
 *  - `untracked-ignored` — the same plus the `pnpm-lock.yaml` line a person adds to `.gitignore` to
 *    keep the lockfile out of a diff; plain `git add` refuses that state (measured: exit 1).
 *  - `ignored` — the lockfile committed first and the ignore rule after it, which is the state
 *    `lockfile-ignored` reports.
 *  - `tracked` — the shape the rule promises to pass.
 * @param {import('node:test').TestContext} t
 * @param {'missing'|'untracked'|'untracked-ignored'|'ignored'|'tracked'} state
 * @returns {string} the repository directory
 */
function repository(t, state) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-lockfile-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'package.json'), '{\n  "name": "field-loop",\n  "private": true\n}\n');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', 'package.json']);
  git(dir, ['commit', '-qm', 'the manifest']);

  if (state !== 'missing') writeFileSync(join(dir, LOCKFILE), "lockfileVersion: '9.0'\n");
  if (state === 'ignored' || state === 'tracked') {
    git(dir, ['add', LOCKFILE]);
    git(dir, ['commit', '-qm', 'the lockfile']);
  }
  if (state === 'untracked-ignored' || state === 'ignored') {
    writeFileSync(join(dir, '.gitignore'), `${LOCKFILE}\n`);
    git(dir, ['add', '.gitignore']);
    git(dir, ['commit', '-qm', 'ignore the lockfile']);
  }

  return dir;
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

/**
 * One `scan` over the fixture, with the flags the test passes and the real probes.
 * @param {string} dir
 * @param {string[]} argv
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function scanOn(dir, argv) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(['scan', ...argv], { cwd: dir, env: process.env, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/**
 * One scan's findings, as JSON, for a single rule.
 * @param {string} dir
 * @param {string[]} argv
 * @returns {Promise<object>} the parsed document
 */
async function reportOf(dir, argv) {
  const { stdout } = await scanOn(dir, [...argv, '--format', 'json']);
  return JSON.parse(stdout);
}

/**
 * The counts and the verdict the human report prints, read back out of its `summary` and `verdict`
 * lines. Parsing them is the point: a parity test that trusted the JSON alone would compare a format
 * with itself.
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

/**
 * The findings the human report printed, read back from the text: the label line with its subject,
 * the message the renderer wrapped, and the action under it. Unwrapping is joining the indented
 * lines, which is what makes this a comparison and not a transcription.
 * @param {string} text
 * @returns {Array<{ label: string, path: string, message: string, command: string | null }>}
 */
function humanFindings(text) {
  const findings = [];
  let current = null;

  for (const line of text.split('\n')) {
    const head = /^ {2}[✖⚠ℹ–] {2}([^·]+?) {2}· {2}(.+)$/.exec(line);
    if (head !== null) {
      current = { label: head[1].trim(), path: head[2].trim(), message: '', command: null };
      findings.push(current);
      continue;
    }
    if (current === null) continue;

    const action = /^ {5}→ (.*)$/.exec(line);
    if (action !== null) {
      current.command = action[1].trim();
      continue;
    }
    const body = /^ {5}(?!·)(\S.*)$/.exec(line);
    if (body !== null) {
      current.message = current.message === '' ? body[1] : `${current.message} ${body[1]}`;
      continue;
    }
    if (!line.startsWith('     ')) current = null;
  }

  return findings;
}

/**
 * Runs a command a finding printed, exactly as it printed it.
 * @param {string} dir
 * @param {string} command
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runPrinted(dir, command) {
  const [file, ...args] = command.split(' ');
  return spawnSync(file, args, { cwd: dir, encoding: 'utf8', env: process.env });
}

/// Side one: the three failures, each with its own code, at the path the finding names and with the
/// command a person runs.

test('the run fails with lockfile-missing on a repository that never installed, and names pnpm install', async (t) => {
  const dir = repository(t, 'missing');

  const report = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  const [finding] = report.findings;

  assert.deepEqual(report.summary, { error: 1, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'fail' });
  assert.equal(finding.rule, 'lockfile-committed');
  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-missing');
  assert.equal(finding.path, LOCKFILE);
  assert.equal(finding.line, undefined, 'a whole-file finding names no line');
  assert.deepEqual(finding.evidence, { path: LOCKFILE, present: false, tracked: false, ignored: false });
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'pnpm install' });

  const human = await scanOn(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  assert.equal(human.code, 1, 'an error at the default threshold fails the run');
  assert.equal(human.stderr, '');
  const [printed] = humanFindings(human.stdout);
  assert.equal(printed.path, LOCKFILE);
  assert.equal(printed.command, 'pnpm install');
  assert.match(printed.message, /is missing from the repository root/);
});

test('the run fails with lockfile-untracked for a lockfile git never saw, and names git add', async (t) => {
  const dir = repository(t, 'untracked');

  const report = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  const [finding] = report.findings;

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-untracked');
  assert.equal(finding.path, LOCKFILE);
  assert.deepEqual(finding.evidence, { path: LOCKFILE, present: true, tracked: false, ignored: false });
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'git add pnpm-lock.yaml' });
  assert.match(finding.message, /is present but not tracked by git/);
});

test('the run fails with lockfile-untracked and git add -f where an ignore rule also matches', async (t) => {
  const dir = repository(t, 'untracked-ignored');

  const report = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  const [finding] = report.findings;

  assert.equal(finding.code, 'lockfile-untracked');
  assert.deepEqual(finding.evidence, { path: LOCKFILE, present: true, tracked: false, ignored: true });
  assert.match(finding.message, /an ignore rule matches it/);
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'git add -f pnpm-lock.yaml' });
});

test('the run fails with lockfile-ignored for a tracked lockfile an ignore rule still matches', async (t) => {
  const dir = repository(t, 'ignored');

  const report = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  const [finding] = report.findings;

  assert.equal(finding.status, 'fail');
  assert.equal(finding.code, 'lockfile-ignored');
  assert.equal(finding.path, LOCKFILE);
  assert.deepEqual(finding.evidence, { path: LOCKFILE, present: true, tracked: true, ignored: true });
  assert.deepEqual(finding.remediation, {
    kind: 'manual',
    command: 'git check-ignore -v --no-index pnpm-lock.yaml',
  });
});

/// Side two: the pass, counted.

test('a present, tracked lockfile passes, and the pass is counted and never listed', async (t) => {
  const dir = repository(t, 'tracked');

  const report = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings, [], 'a passing finding is counted in summary.pass and never listed (10.1)');

  const human = await scanOn(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /all 1 rule pass/, 'the human report names the pass it counted');
});

/// Side three: the skip, with its code and the fact it names.

test('with the repository out of scope the run skips with no-repo-root and names the fact', async (t) => {
  const dir = repository(t, 'missing');

  const json = await scanOn(dir, ['--scope', 'machine', '--only', 'lockfile-committed', '--format', 'json']);
  const report = JSON.parse(json.stdout);
  const [finding] = report.findings;

  assert.equal(json.code, 0, 'a skip is not a failure');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-repo-root');
  assert.equal(
    finding.message,
    'skipped: the repository was excluded by --scope machine, so the lockfile cannot be located',
  );
  assert.deepEqual(finding.evidence, { path: LOCKFILE, present: null, tracked: null, ignored: null });
  assert.deepEqual(finding.remediation, { kind: 'none' }, 'a skip has no command to hand anyone');
});

/// Side four: off by policy, with neither a finding nor a count.

test('no preset turns the rule off, and --ignore or --only leaves it with neither a finding nor a count', async (t) => {
  const dir = repository(t, 'missing');

  // `starter` is the only preset that disables anything, and the lockfile is one of the six questions
  // it keeps (9.1), so the answer to "which preset turns this rule off" is: none of them.
  for (const preset of ['baseline', 'strict', 'starter']) {
    const report = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed', '--preset', preset]);
    assert.deepEqual(report.findings.map((finding) => finding.code), ['lockfile-missing'], `${preset} dropped a rule it keeps`);
    assert.equal(report.summary.error, 1, `${preset} stopped counting the finding`);
  }

  // `--ignore` means the rule does not run: no finding, and nothing in any counter.
  const ignored = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed', '--ignore', 'lockfile-committed']);
  assert.deepEqual(ignored.findings, [], '--ignore left a finding behind');
  assert.deepEqual(ignored.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });

  // `--only` naming another rule excludes it the same way, while the rule it did name is still counted.
  const narrowed = await reportOf(dir, ['--scope', 'repo', '--only', 'package-manager-pin']);
  assert.equal(
    narrowed.findings.every((finding) => finding.rule === 'package-manager-pin'),
    true,
    '--only package-manager-pin ran a rule it does not name',
  );
  assert.ok(
    narrowed.summary.error + narrowed.summary.warn + narrowed.summary.info + narrowed.summary.pass + narrowed.summary.skip > 0,
    'the rule that was named contributed nothing, so the absence proves nothing',
  );
});

test('a repository that turns the rule off gets no finding, no count, and the not run line naming it', async (t) => {
  const dir = repository(t, 'tracked');

  const on = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  assert.equal(on.summary.pass, 1, 'the state this test turns off is a counted pass');

  writeFileSync(
    join(dir, 'funky-secure.config.json'),
    `${JSON.stringify({ rules: { 'lockfile-committed': 'off' } }, null, 2)}\n`,
  );

  const off = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  assert.deepEqual(off.findings, [], 'a rule at off still produced a finding');
  assert.deepEqual(off.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });

  const human = await scanOn(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  assert.match(human.stdout, /^not run {2}12 of 13 rules; off by policy: Lockfile$/m, 'the run states the coverage it does not have (10.3)');
});

/// S4, the remediation: each printed command, run on a disposable copy of the state that printed it.

test('a pass and a skip offer no command by design, and no fail of this rule does', () => {
  const [passing] = rule.detect(context());
  const [skipped] = rule.detect({ ...context(), repo: null });

  assert.equal(passing.status, 'pass');
  assert.deepEqual(passing.remediation, { kind: 'none' }, 'a pass has nothing to hand anyone');
  assert.equal(skipped.status, 'skip');
  assert.deepEqual(skipped.remediation, { kind: 'none' }, 'a skip has nothing to hand anyone');

  // The promise this rule is singled out for: every fail carries the command a person runs.
  for (const state of [{ present: false }, { tracked: false }, { tracked: false, ignored: true }, { ignored: true }]) {
    const [finding] = rule.detect(context(state));
    assert.equal(finding.status, 'fail');
    assert.equal(finding.remediation.kind, 'manual', `${finding.code} remediates with none`);
    assert.equal(typeof finding.remediation.command, 'string');
  }
});

test('the printed git add clears lockfile-untracked in the state that printed it', async (t) => {
  const dir = repository(t, 'untracked');

  const [finding] = (await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed'])).findings;
  assert.equal(finding.code, 'lockfile-untracked');

  const ran = runPrinted(dir, finding.remediation.command);
  assert.equal(ran.status, 0, `the printed command failed: ${ran.stderr}`);

  const after = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  assert.deepEqual(after.findings, [], 'the printed command did not clear its own finding');
  assert.equal(after.summary.pass, 1, 'and the state it leaves is the one the rule promises to pass');
});

test('the printed git add -f is the one that runs where a plain git add refuses', async (t) => {
  const dir = repository(t, 'untracked-ignored');

  const [finding] = (await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed'])).findings;
  assert.deepEqual(finding.remediation, { kind: 'manual', command: 'git add -f pnpm-lock.yaml' });

  // The reason the command carries -f: this is the state where the plain form exits 1.
  const plain = spawnSync('git', ['add', LOCKFILE], { cwd: dir, encoding: 'utf8', env: process.env });
  assert.notEqual(plain.status, 0, 'a plain git add succeeded on an ignored path');
  assert.match(plain.stderr, /ignored/);

  const ran = runPrinted(dir, finding.remediation.command);
  assert.equal(ran.status, 0, `the printed command failed: ${ran.stderr}`);

  const after = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  assert.equal(
    after.findings.some((entry) => entry.code === 'lockfile-untracked'),
    false,
    'the printed command did not clear the finding it was printed for',
  );
  assert.deepEqual(
    after.findings.map((entry) => entry.code),
    ['lockfile-ignored'],
    'the ignore rule is now the whole finding, and its own command is the next step',
  );
});

test('the printed git check-ignore reports the rule in the state lockfile-ignored describes', async (t) => {
  const dir = repository(t, 'ignored');

  const [finding] = (await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed'])).findings;
  assert.equal(finding.code, 'lockfile-ignored');

  const ran = runPrinted(dir, finding.remediation.command);
  assert.equal(
    ran.status,
    0,
    `the printed command answered ${ran.status} in the state that printed it, with no output to read: ${ran.stderr}`,
  );
  assert.equal(ran.stdout.trim(), `.gitignore:1:${LOCKFILE}\t${LOCKFILE}`, 'and it names the file, line and pattern');

  // The finding says "remove it", so removing the line the command named is the rest of the action.
  writeFileSync(join(dir, '.gitignore'), '');
  const after = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  assert.deepEqual(after.findings, [], 'removing the named rule did not clear the finding');
  assert.equal(after.summary.pass, 1);
});

test('the printed pnpm install writes the lockfile the finding says is missing', async (t) => {
  const dir = repository(t, 'missing');

  const [finding] = (await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed'])).findings;
  assert.equal(finding.code, 'lockfile-missing');
  assert.equal(finding.remediation.command, 'pnpm install');

  // The printed text is `pnpm install`. On win32 the manager is a `.cmd` shim, so the command is run
  // through the resolver the tool already owns (E7) instead of a second, shell-shaped copy of it.
  const resolved = await createCollector({ cwd: dir, env: process.env }).pnpm();
  if (resolved.file === null) {
    t.skip(`pnpm did not answer (${resolved.reason}), so the printed install cannot be run here`);
    return;
  }

  const ran = spawnSync(resolved.file, [...resolved.prefixArgs, 'install'], {
    cwd: dir,
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(ran.status, 0, `the printed command failed: ${ran.stderr}`);
  assert.ok(existsSync(join(dir, LOCKFILE)), 'pnpm install wrote no lockfile');

  const after = await reportOf(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
  assert.equal(
    after.findings.some((entry) => entry.code === 'lockfile-missing'),
    false,
    'the printed command did not clear its own finding',
  );
});

/// S4, the two formats, over every state.

test('the human report and the JSON document answer the same thing in every state', async (t) => {
  for (const state of ['missing', 'untracked', 'untracked-ignored', 'ignored', 'tracked']) {
    const dir = repository(t, state);

    const json = await scanOn(dir, ['--scope', 'repo', '--only', 'lockfile-committed', '--format', 'json']);
    const human = await scanOn(dir, ['--scope', 'repo', '--only', 'lockfile-committed']);
    const report = JSON.parse(json.stdout);

    assert.equal(human.code, json.code, `${state}: the two formats disagree about the exit code`);
    assert.equal(human.stderr, '', `${state}: the human run wrote to stderr`);

    const printed = humanSummary(human.stdout);
    assert.deepEqual(
      [printed.error, printed.warn, printed.info, printed.pass, printed.skip],
      [report.summary.error, report.summary.warn, report.summary.info, report.summary.pass, report.summary.skip],
      `${state}: the human counts differ from summary in the JSON document`,
    );
    assert.equal(printed.verdict, report.summary.verdict, `${state}: the verdicts differ`);
    assert.equal(printed.failOn, report.policy.failOn, `${state}: the thresholds differ`);

    const listed = humanFindings(human.stdout);
    assert.equal(listed.length, report.findings.length, `${state}: one format lists a finding the other does not`);
    for (const [index, finding] of report.findings.entries()) {
      assert.equal(listed[index].path, finding.path, `${state}: the path differs`);
      assert.equal(listed[index].message, finding.message, `${state}: the message differs`);
      assert.equal(
        listed[index].command ?? null,
        finding.remediation.command ?? null,
        `${state}: the action differs`,
      );
    }
  }
});

/// The collector resolves the tracked set from the repository root, not the invocation directory (#347).

test('the binary passes from a nested directory in a repository that committed its lockfile (#347)', async (t) => {
  const dir = repository(t, 'tracked');
  const nested = join(dir, 'packages', 'api');
  mkdirSync(nested, { recursive: true });

  const result = spawnSync(
    process.execPath,
    [BIN, 'scan', '--scope', 'repo', '--only', 'lockfile-committed', '--format', 'json'],
    { cwd: nested, encoding: 'utf8', env: process.env },
  );

  assert.equal(result.stderr, '');
  assert.equal(result.status, 0, `the run failed from a nested directory:\n${result.stdout}`);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(
    report.summary,
    { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
    'the tracked set is resolved from the repository root, so the committed lockfile passes',
  );
  assert.deepEqual(report.findings, []);
});

/// S4, the page: it names the commands the findings print, or it is corrected in this change.

test('the rule page names every command a finding prints', () => {
  const page = readFileSync(new URL('../../docs/rules/lockfile-committed.md', import.meta.url), 'utf8');
  const commands = new Set(
    [{ present: false }, { tracked: false }, { tracked: false, ignored: true }, { ignored: true }]
      .flatMap((state) => rule.detect(context(state)))
      .map((finding) => finding.remediation.command),
  );

  assert.equal(commands.size, 4, 'the four failing states print four different commands');
  for (const command of commands) {
    assert.ok(
      page.includes(command),
      `docs/rules/lockfile-committed.md never names \`${command}\`, which the finding prints`,
    );
  }
});
