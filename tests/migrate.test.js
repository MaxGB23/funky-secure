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

  assert.equal(result.code, 2);
  assert.match(result.stderr, /^funky-secure: refusing to remove package-lock\.json: pnpm-lock\.yaml is absent/);
  assert.ok(result.stderr.includes('never delete the only lockfile'));
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

  assert.equal(result.code, 2);
  assert.match(result.stderr, /refusing to remove package-lock\.json: the current branch main is the default branch/);
  assert.ok(result.stderr.includes('refs/remotes/origin/HEAD'));
  assert.equal(result.stderr.includes('fallback'), false);
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

    assert.equal(result.code, 2);
    assert.match(result.stderr, new RegExp(`the current branch ${branch} matches the main/master check`));
    assert.ok(result.stderr.includes('fallback'), 'the refusal states that the check is a fallback');
    assert.ok(result.stderr.includes('refs/remotes/origin/HEAD'));
    assert.ok(readdirSync(dir).includes('package-lock.json'));
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

  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /refusing to remove package-lock\.json: uncommitted changes for package-lock\.json/);
  assert.ok(refused.stderr.includes('--allow-dirty'));
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

  assert.equal(code, 2);
  assert.match(
    stderr.text,
    /refusing to remove package-lock\.json: uncommitted changes for package-lock\.json/,
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
  assert.match(result.stderr, /refusing to remove package-lock\.json: git could not report the working tree status/);
  assert.deepEqual(readdirSync(dir).sort(), ['package-lock.json', 'package.json', 'pnpm-lock.yaml']);
});

test('apply refuses a detached HEAD', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const result = await migrate(t, ['migrate', '--apply'], dir, { branch: 'HEAD', defaultRef: 'origin/main' });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /refusing to remove package-lock\.json: HEAD is detached/);
  assert.deepEqual(readdirSync(dir).sort(), ['package-lock.json', 'package.json', 'pnpm-lock.yaml']);
});

test('migrate refuses outside git and removes nothing', async (t) => {
  const dir = repository(t, {
    'package.json': PACKAGE_JSON,
    'package-lock.json': '{"lockfileVersion": 3}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  const result = await migrate(t, ['migrate', '--apply'], dir, { root: null });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /^funky-secure: migrate needs a git repository/);
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

  assert.equal(result.code, 2);
  assert.match(result.stderr, /refusing to remove bun\.lock: pnpm-lock\.yaml is absent/);
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

  assert.equal(code, 2);
  assert.match(stderr.text, /yarn\.lock/);
  assert.ok(existsSync(join(dir, 'package-lock.json')), 'the first target was not deleted');
});
