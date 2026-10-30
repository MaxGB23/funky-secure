import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { run } from '../src/cli.js';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A real repository on disk: `files` is a map of repository-relative path to text. */
function repository(t, files) {
  const dir = scratch(t);
  for (const [path, text] of Object.entries(files)) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return dir;
}

const PACKAGE_JSON = JSON.stringify({ name: 'fixture', packageManager: 'npm@10.0.0' });

/**
 * The injected collector: reads the real files the test placed, and answers the closed git probes
 * from the test's declared repository state. Nothing is spawned.
 */
function fakeCollector({
  root = null,
  branch = 'feat/work',
  defaultRef = null,
  dirty = [],
  statusCode = 0,
} = {}) {
  const calls = [];
  const answer = (result) => ({ ok: true, code: 0, stdout: '', stderr: '', ...result });

  return {
    calls,
    async read(path) {
      try {
        return { ok: true, value: await readFile(path, 'utf8') };
      } catch (error) {
        return { ok: false, error };
      }
    },
    async git(args) {
      calls.push(args);
      const [head, second] = args;
      if (head === 'rev-parse' && second === '--show-toplevel') {
        return root === null
          ? answer({ code: 128, stderr: 'fatal: not a git repository' })
          : answer({ stdout: `${root}\n` });
      }
      if (head === 'rev-parse' && second === '--abbrev-ref') {
        return branch === null ? answer({ code: 128 }) : answer({ stdout: `${branch}\n` });
      }
      if (head === 'ls-files') return answer({ stdout: '' });
      if (head === 'check-ignore') return answer({ code: 1 });
      if (head === 'status') {
        if (statusCode !== 0) return answer({ code: statusCode });
        return answer({ stdout: dirty.map((entry) => `${entry}\0`).join('') });
      }
      if (head === 'symbolic-ref') {
        return defaultRef === null ? answer({ code: 1 }) : answer({ stdout: `${defaultRef}\n` });
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
    async pnpmVersion() {
      return { ok: false, reason: 'not-on-path', installations: [] };
    },
    async pnpmConfig() {
      return { ok: false, reason: 'not-on-path' };
    },
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

/** Runs the CLI command through the public interface and returns the exit code and both streams. */
async function migrate(t, argv, dir, collectorOptions = {}) {
  const stdout = capture();
  const stderr = capture();
  const collector = fakeCollector({ root: dir, ...collectorOptions });
  const code = await run(argv, { cwd: dir, env: {}, stdout, stderr, collector });
  return { code, stdout: stdout.text, stderr: stderr.text, collector };
}

const STEPS = /1\. evidence[\s\S]*2\. report-only[\s\S]*3\. human step[\s\S]*4\. removal[\s\S]*5\. ci follow-up/;

/**
 * The two lines of a refusal (S5): one actionable sentence first, the internal diagnosis after a
 * `reason:` label. Returns them split, and asserts the shape every refusal must have.
 * @param {string} stderr
 * @returns {{ action: string, reason: string }}
 */
function refusal(stderr) {
  const lines = stderr.split('\n');
  assert.match(lines[0], /^funky-secure: \S/);
  assert.match(lines[1], /^reason: /);
  assert.equal(lines[2], '', 'a refusal is exactly two lines');
  return { action: lines[0].slice('funky-secure: '.length), reason: lines[1].slice('reason: '.length) };
}

test('apply on a clean feature branch removes exactly the foreign lockfile', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const result = await migrate(t, ['migrate', '--apply'], dir, { defaultRef: 'origin/main' });

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, STEPS);
  assert.match(result.stdout, /4\. removal[\s\S]*would remove\s+package-lock\.json/);
  assert.ok(result.stdout.includes(join(dir, 'package-lock.json')), 'the removal is printed as an absolute path');

  assert.deepEqual(readdirSync(dir).sort(), ['package.json', 'pnpm-lock.yaml']);
  const lockfile = await readFile(join(dir, 'pnpm-lock.yaml'), 'utf8');
  assert.equal(lockfile, 'lockfileVersion: 9\n');

  // The dirty check is one `git status` call, limited to the paths about to be removed.
  const status = result.collector.calls.find((args) => args[0] === 'status');
  assert.deepEqual(status, ['status', '--porcelain', '-z', '--', 'package-lock.json']);
});

test('apply refuses without pnpm-lock.yaml and keeps the only lockfile', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
  });

  const result = await migrate(t, ['migrate', '--apply'], dir, { defaultRef: 'origin/main' });

  assert.equal(result.code, 3);
  const { action, reason } = refusal(result.stderr);
  assert.equal(action, 'create pnpm-lock.yaml first (run pnpm install), then re-run migrate --apply');
  assert.equal(reason, 'refusing to remove package-lock.json: pnpm-lock.yaml is absent (never delete the only lockfile)');
  assert.deepEqual(readdirSync(dir).sort(), ['package-lock.json', 'package.json']);
});

test('apply refuses on the default branch read from origin/HEAD', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const result = await migrate(t, ['migrate', '--apply'], dir, {
    branch: 'main',
    defaultRef: 'origin/main',
  });

  assert.equal(result.code, 3);
  const { action, reason } = refusal(result.stderr);
  assert.equal(
    action,
    'switch to a feature branch (git switch -c chore/supply-chain-bootstrap) and re-run migrate --apply',
  );
  assert.equal(
    reason,
    'refusing to remove package-lock.json: the current branch main is the default branch, read from refs/remotes/origin/HEAD',
  );
  assert.deepEqual(readdirSync(dir).sort(), ['package-lock.json', 'package.json', 'pnpm-lock.yaml']);
});

test('apply without a remote says the main/master check is a fallback', async (t) => {
  for (const branch of ['main', 'master']) {
    const dir = repository(t, {
      'package.json': PACKAGE_JSON,
      'package-lock.json': '{"lockfileVersion": 3}',
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    });

    const result = await migrate(t, ['migrate', '--apply'], dir, { branch, defaultRef: null });

    assert.equal(result.code, 3);
    const { action, reason } = refusal(result.stderr);
    assert.equal(
    action,
    'switch to a feature branch (git switch -c chore/supply-chain-bootstrap) and re-run migrate --apply',
  );
    assert.equal(
      reason,
      `refusing to remove package-lock.json: the current branch ${branch} matches the main/master check, which is a fallback because refs/remotes/origin/HEAD could not be read (the repository has no remote)`,
    );
    assert.deepEqual(readdirSync(dir).sort(), ['package-lock.json', 'package.json', 'pnpm-lock.yaml']);
  }
});

test('apply refuses a dirty lockfile path, and --allow-dirty proceeds', async (t) => {
  const files = {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  };

  const refusedDir = repository(t, files);
  const refused = await migrate(t, ['migrate', '--apply'], refusedDir, {
    defaultRef: 'origin/main',
    dirty: [' M package-lock.json'],
  });

  assert.equal(refused.code, 3);
  const { action, reason } = refusal(refused.stderr);
  assert.equal(action, 'commit package-lock.json or pass --allow-dirty, then re-run');
  assert.equal(
    reason,
    'refusing to remove package-lock.json: uncommitted changes for package-lock.json (git status --porcelain -z)',
  );
  assert.deepEqual(readdirSync(refusedDir).sort(), ['package-lock.json', 'package.json', 'pnpm-lock.yaml']);

  const allowedDir = repository(t, files);
  const allowed = await migrate(t, ['migrate', '--apply', '--allow-dirty'], allowedDir, {
    defaultRef: 'origin/main',
    dirty: [' M package-lock.json'],
  });

  assert.equal(allowed.code, 0);
  assert.deepEqual(readdirSync(allowedDir).sort(), ['package.json', 'pnpm-lock.yaml']);
  assert.equal(allowed.collector.calls.some((args) => args[0] === 'status'), false);
});

// The dirty check asks git about pathspecs relative to `cwd`, which is not the root when the command
// runs from a subdirectory; the refusal names whatever paths git reports.
test('apply refuses a dirty lockfile when run from a subdirectory', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    'packages/app/index.js': '',
  });
  const cwd = join(dir, 'packages', 'app');

  const stdout = capture();
  const stderr = capture();
  const collector = fakeCollector({
    root: dir,
    defaultRef: 'origin/main',
    dirty: ['?? package-lock.json'],
  });
  const code = await run(['migrate', '--apply'], { cwd, env: {}, stdout, stderr, collector });

  assert.equal(code, 3);
  const { action, reason } = refusal(stderr.text);
  assert.equal(action, 'commit package-lock.json or pass --allow-dirty, then re-run');
  assert.equal(
    reason,
    'refusing to remove package-lock.json: uncommitted changes for package-lock.json (git status --porcelain -z)',
  );
  const status = collector.calls.find((args) => args[0] === 'status');
  assert.deepEqual(status, [
    'status',
    '--porcelain',
    '-z',
    '--',
    join('..', '..', 'package-lock.json'),
  ]);
  assert.ok(readdirSync(dir).includes('package-lock.json'));
});

test('apply refuses when git cannot report the working tree status', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const result = await migrate(t, ['migrate', '--apply'], dir, {
    defaultRef: 'origin/main',
    statusCode: 128,
  });

  assert.equal(result.code, 2);
  const { action, reason } = refusal(result.stderr);
  assert.equal(action, 'pass --allow-dirty, or fix git so git status answers, then re-run');
  assert.equal(
    reason,
    'refusing to remove package-lock.json: git could not report the working tree status (git status --porcelain -z failed)',
  );
  assert.deepEqual(readdirSync(dir).sort(), ['package-lock.json', 'package.json', 'pnpm-lock.yaml']);
});

test('an exit code names one thing: 3 is a refusal, 2 is a question git did not answer', async (t) => {
  // Field report F2: `migrate --apply` exited 2 when it refused to delete a foreign lockfile on the
  // default branch, and 2 is documented as "the tool could not answer". A script or an agent branching
  // on the exit code could not tell a policy decision from a crash. The contract now separates them:
  // 1 is a report whose findings crossed the threshold, 2 is a question the tool could not answer, and
  // 3 is a decision not to act — understood, refused, nothing written.
  const files = {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': "lockfileVersion: 9\n",
  };

  // Understood: the branch is the default one, so the tool decided not to act.
  const refusedDir = repository(t, files);
  const refused = await migrate(t, ['migrate', '--apply'], refusedDir, {
    branch: 'main',
    defaultRef: 'origin/main',
  });
  assert.equal(refused.code, 3, 'a refusal is a decision, not a failure to answer');
  refusal(refused.stderr);

  // Unanswerable: git was asked for the branch and did not give one, so there was nothing to decide.
  const unansweredDir = repository(t, files);
  const unanswered = await migrate(t, ['migrate', '--apply'], unansweredDir, {
    branch: null,
    defaultRef: 'origin/main',
  });
  assert.equal(unanswered.code, 2, 'a question the tool could not answer stays 2');
  assert.match(unanswered.stderr, /^funky-secure: check out a feature branch/);
  assert.match(unanswered.stderr, /git could not resolve the current branch/);

  // Neither wrote anything: the plan is printed, the removal is not performed.
  for (const dir of [refusedDir, unansweredDir]) {
    assert.deepEqual(
      readdirSync(dir).sort(),
      ['package-lock.json', 'package.json', 'pnpm-lock.yaml'],
      'a refusal leaves every file where it was',
    );
  }
});

test('apply refuses a detached HEAD', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const result = await migrate(t, ['migrate', '--apply'], dir, { branch: 'HEAD', defaultRef: 'origin/main' });

  assert.equal(result.code, 3);
  const { action, reason } = refusal(result.stderr);
  assert.equal(action, 'check out a branch and re-run migrate --apply');
  assert.equal(reason, 'refusing to remove package-lock.json: HEAD is detached');
  assert.deepEqual(readdirSync(dir).sort(), ['package-lock.json', 'package.json', 'pnpm-lock.yaml']);
});

test('migrate refuses outside git and removes nothing', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const result = await migrate(t, ['migrate', '--apply'], dir, { root: null });

  assert.equal(result.code, 3);
  const { action, reason } = refusal(result.stderr);
  assert.equal(action, 'run migrate inside a git worktree');
  assert.equal(
    reason,
    'migrate needs a git repository: step 4 removes a tracked lockfile on a branch, and this directory is not inside one',
  );
  assert.deepEqual(readdirSync(dir).sort(), ['package-lock.json', 'package.json', 'pnpm-lock.yaml']);
});

test('a yarn repository names pnpm import in step 3 and yarn.lock in step 4', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'yarn.lock': '# yarn lockfile v1\n',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const result = await migrate(t, ['migrate', '--apply'], dir, { defaultRef: 'origin/main' });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /3\. human step[\s\S]*pnpm import/);
  assert.match(result.stdout, /4\. removal[\s\S]*yarn\.lock/);
  assert.deepEqual(readdirSync(dir).sort(), ['package.json', 'pnpm-lock.yaml']);
});

test('a bun-only repository is refused for the missing pnpm lockfile, not removed', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'bun.lock': 'bun lockfile\n',
  });

  const result = await migrate(t, ['migrate', '--apply'], dir, { defaultRef: 'origin/main' });

  assert.equal(result.code, 3);
  const { action, reason } = refusal(result.stderr);
  assert.equal(action, 'create pnpm-lock.yaml first (run pnpm install), then re-run migrate --apply');
  assert.equal(reason, 'refusing to remove bun.lock: pnpm-lock.yaml is absent (never delete the only lockfile)');
  assert.deepEqual(readdirSync(dir).sort(), ['bun.lock', 'package.json']);
});

test('apply with nothing foreign to remove writes nothing and says so', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const result = await migrate(t, ['migrate', '--apply'], dir, { defaultRef: 'origin/main' });

  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes('nothing to remove'));
  assert.equal(result.collector.calls.some((args) => args[0] === 'status'), false);
  assert.deepEqual(readdirSync(dir).sort(), ['package.json', 'pnpm-lock.yaml']);
});

test('step 5 quotes a workflow line that still runs npm ci', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    '.github/workflows/ci.yml': [
      'name: ci',
      'on: [push]',
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: npm ci',
      '',
    ].join('\n'),
  });

  const result = await migrate(t, ['migrate'], dir, { defaultRef: 'origin/main' });

  assert.equal(result.code, 0);
  assert.match(
    result.stdout,
    /5\. ci follow-up \(suggestions only\)\n {3}\.github\/workflows\/ci\.yml:6 {2}- run: npm ci/,
  );
});

test('step 5 suggests nothing when no workflow mentions npm or yarn', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    '.github/workflows/ci.yml': [
      'name: ci',
      'on: [push]',
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '',
    ].join('\n'),
  });

  const result = await migrate(t, ['migrate'], dir, { defaultRef: 'origin/main' });

  assert.equal(result.code, 0);
  assert.match(
    result.stdout,
    /5\. ci follow-up \(suggestions only\)\n {3}\(no workflow mentions npm or yarn\)/,
  );
  assert.equal(result.stdout.includes('.github/workflows/ci.yml:'), false);
});

test('a printed plan removes nothing', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'yarn.lock': '# yarn lockfile v1\n',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const result = await migrate(t, ['migrate'], dir, { defaultRef: 'origin/main' });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /plan only \(nothing has been written\)/);
  assert.equal(/^remove {2}/m.test(result.stdout), false);
  assert.deepEqual(readdirSync(dir).sort(), ['package-lock.json', 'package.json', 'pnpm-lock.yaml', 'yarn.lock']);
});

// PRESERVE: `--from` keeps its meaning — it selects the origin wording and never widens what may be
// removed, because step 3 and the removal list come from the lockfiles actually present.
test('--from yarn keeps its wording and does not widen the removal list', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'yarn.lock': '# yarn lockfile v1\n',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const printed = await migrate(t, ['migrate', '--from', 'yarn'], dir, { defaultRef: 'origin/main' });
  assert.equal(printed.code, 0);
  assert.match(printed.stdout, /from yarn {2}· {2}plan only/);
  assert.match(printed.stdout, /3\. human step[\s\S]*pnpm import/);

  const applied = await migrate(t, ['migrate', '--from', 'yarn', '--apply'], dir, { defaultRef: 'origin/main' });
  assert.equal(applied.code, 0);
  assert.deepEqual(readdirSync(dir).sort(), ['package.json', 'pnpm-lock.yaml']);
});

test('--from a manager the repository does not hold is refused, not relabelled (0021)', async (t) => {
  // The flag used to change only the header of the plan and then recommend the manager it actually
  // detected, so `--from npm` over a yarn repository exited 0 while doing nothing npm-like.
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'yarn.lock': '# yarn lockfile v1\n',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const refused = await migrate(t, ['migrate', '--from', 'npm'], dir, { defaultRef: 'origin/main' });

  assert.equal(refused.code, 2, 'naming the wrong manager is a usage error, not a repository state');
  assert.match(refused.stderr, /refusing --from npm/);
  assert.match(refused.stderr, /yarn.lock/, 'the refusal names what the repository actually holds');
});

// PRESERVE: a plan-only run never runs the apply-only probes.
test('a plan-only run does not ask git for the status or the default branch', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const result = await migrate(t, ['migrate', '--from', 'npm'], dir, { defaultRef: 'origin/main' });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /from npm {2}· {2}plan only/);
  assert.equal(result.collector.calls.some((args) => args[0] === 'status'), false);
  assert.equal(result.collector.calls.some((args) => args[0] === 'symbolic-ref'), false);
});

test('step 4 refuses before it deletes anything, so no lockfile is ever half-removed', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    'package-lock.json': '{"lockfileVersion": 3}\n',
  });
  // A directory where a lockfile is expected: the lstat check refuses it, and the sibling that was
  // approved first must still be on disk afterwards.
  mkdirSync(join(dir, 'yarn.lock'), { recursive: true });

  const stdout = capture();
  const stderr = capture();
  const collector = fakeCollector({ root: dir, defaultRef: 'origin/main' });
  const code = await run(['migrate', '--apply'], { cwd: dir, env: {}, stdout, stderr, collector });

  assert.equal(code, 3);
  const { reason } = refusal(stderr.text);
  assert.match(reason, /yarn\.lock/);
  assert.ok(existsSync(join(dir, 'package-lock.json')), 'the first target was not deleted');
});
