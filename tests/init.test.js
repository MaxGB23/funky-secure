import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../src/cli.js';
import { BEGIN, END } from '../src/lib/managed-block.js';
import { collectScan } from '../src/lib/scan.js';
import { planFor } from '../src/lib/writers.js';
import { catalog } from '../src/rules/index.js';

/**
 * `init` end to end (RFC 11.2, F2): real temporary repositories, an injected collector so no pnpm
 * and no git is ever spawned, and captured streams. The collector reads files from disk and answers
 * the git probes from the repository's own bytes, which is what makes the second `--apply` run
 * observe the first one's writes instead of a canned answer.
 */

const FIXTURES = join(import.meta.dirname, 'fixtures', 'init');

/** @param {import('node:test').TestContext} t */
function scratch(t, fixture = null) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-init-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (fixture !== null) cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  return dir;
}

/** Every file in the repository, relative path -> exact bytes. */
function snapshot(dir) {
  const files = new Map();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    // `Dirent.parentPath` arrived in Node 20.12; `engines` declares 20.11, and the floor leg of CI runs
    // it, so the older name is the fallback rather than a reason to raise the declared floor.
    const path = join(entry.parentPath ?? entry.path, entry.name);
    files.set(path.slice(dir.length + 1).replaceAll('\\', '/'), readFileSync(path, 'utf8'));
  }
  return files;
}

function patternMatches(pattern, path) {
  const body = pattern.replace(/\/+$/, '');
  if (body === '') return false;
  const regex = new RegExp(
    `^${body
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')}$`,
  );
  return regex.test(path);
}

/**
 * The answer `git check-ignore --no-index --stdin -z` would give for the six candidate paths,
 * resolved from the repository's own `.gitignore` (negations applied in order).
 */
function ignoredFromGitignore(root, input) {
  const candidates = String(input ?? '')
    .split('\0')
    .filter((path) => path !== '');
  let patterns = [];
  try {
    patterns = readFileSync(join(root, '.gitignore'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
  } catch {
    patterns = [];
  }

  const ignored = [];
  for (const candidate of candidates) {
    let ignoredHere = false;
    for (const pattern of patterns) {
      const negated = pattern.startsWith('!');
      if (patternMatches(negated ? pattern.slice(1) : pattern, candidate)) ignoredHere = !negated;
    }
    if (ignoredHere) ignored.push(candidate);
  }
  return ignored.map((path) => `${path}\0`).join('');
}

/** The keys of the managed block an `init --apply` just wrote, as pnpm would read them. */
function configFromWorkspace(root) {
  let text = '';
  try {
    text = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  } catch {
    return {};
  }
  const config = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(minimumReleaseAge(?:Strict)?)\s*:\s*(.+?)\s*$/);
    if (match === null) continue;
    const raw = match[2];
    if (raw === 'true') config[match[1]] = true;
    else if (raw === 'false') config[match[1]] = false;
    else if (/^\d+$/.test(raw)) config[match[1]] = Number(raw);
  }
  return config;
}

function collectorFor({ root, tracked = [], dirty = [], version = '12.3.4', globalConfig = {} }) {
  const ok = (stdout) => ({ ok: true, code: 0, stdout, stderr: '' });
  return {
    read: async (path) => {
      try {
        return { ok: true, value: await readFile(path, 'utf8') };
      } catch (error) {
        return { ok: false, error };
      }
    },
    git: async (args, options = {}) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return ok(`${root}\n`);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return ok('feat/test\n');
      if (args[0] === 'ls-files') return ok(tracked.map((path) => `${path}\0`).join(''));
      if (args[0] === 'check-ignore') return ok(ignoredFromGitignore(root, options.input));
      if (args[0] === 'status') return ok(dirty.map((path) => ` M ${path}\0`).join(''));
      return { ok: true, code: 1, stdout: '', stderr: '' };
    },
    pnpmVersion: async () => ({
      ok: true,
      version,
      major: Number(version.split('.')[0]),
      executable: '/tools/pnpm',
      installations: ['/tools/pnpm'],
    }),
    pnpmConfig: async () => ({
      ok: true,
      config: { ...globalConfig, ...configFromWorkspace(root) },
    }),
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

function runner(dir, options = {}) {
  const stdout = capture();
  const stderr = capture();
  const collector = collectorFor({ root: dir, ...options });
  return {
    stdout,
    stderr,
    run: (argv) => run(argv, { cwd: dir, env: {}, stdout, stderr, collector }),
  };
}

function writeCount(stdout) {
  return (stdout.match(/^write {2}/gm) ?? []).length;
}

function blockCount(text) {
  return (text.match(/funky-secure:begin/g) ?? []).length;
}

test('a repository already at policy plans nothing and --apply writes nothing', async (t) => {
  const dir = scratch(t, 'at-policy');
  const before = snapshot(dir);
  const tracked = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.gitignore'];

  const preview = runner(dir, { tracked });
  assert.equal(await preview.run(['init']), 0);
  assert.match(preview.stdout.text, /nothing to apply/);
  assert.deepEqual(snapshot(dir), before);

  const applied = runner(dir, { tracked });
  assert.equal(await applied.run(['init', '--apply']), 0);
  assert.match(applied.stdout.text, /nothing to apply/);
  assert.equal(writeCount(applied.stdout.text), 0);
  assert.deepEqual(snapshot(dir), before);
});

test('the JSON plan document of a repository at policy is empty (previous behavior preserved)', async (t) => {
  const dir = scratch(t, 'at-policy');
  const before = snapshot(dir);

  const preview = runner(dir, {
    tracked: ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.gitignore'],
  });
  assert.equal(await preview.run(['init', '--format', 'json']), 0);

  const document = JSON.parse(preview.stdout.text);
  assert.deepEqual(document.plan, []);
  assert.deepEqual(document.refused, []);
  assert.deepEqual(snapshot(dir), before);
});

test('a repository below policy gets exactly one managed block with the baseline gate only', async (t) => {
  const dir = scratch(t, 'below-policy');
  const before = snapshot(dir);
  const tracked = ['package.json', 'pnpm-lock.yaml'];

  const applied = runner(dir, { tracked });
  assert.equal(await applied.run(['init', '--apply']), 0);
  assert.match(applied.stdout.text, /would write/);
  assert.match(applied.stdout.text, /write {2}.*pnpm-workspace\.yaml/);

  const workspace = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8');
  assert.equal(blockCount(workspace), 1);
  assert.ok(workspace.includes('minimumReleaseAgeStrict: true'));
  assert.ok(!workspace.includes('minimumReleaseAge:'));
  assert.ok(!workspace.includes('packages:'), 'init must not synthesize a packages: key');
  assert.equal(before.has('pnpm-workspace.yaml'), false);

  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.packageManager, 'pnpm@12.3.4');

  const gitignore = readFileSync(join(dir, '.gitignore'), 'utf8');
  assert.equal(blockCount(gitignore), 1);
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.npmrc$/m);

  assert.equal(writeCount(applied.stdout.text), 3);
});

test('under --preset strict the block also carries the 4320 floor and the config is written', async (t) => {
  const dir = scratch(t, 'below-policy');
  const tracked = ['package.json', 'pnpm-lock.yaml'];

  const preview = runner(dir, { tracked });
  assert.equal(await preview.run(['init', '--preset', 'strict', '--format', 'json']), 0);
  const document = JSON.parse(preview.stdout.text);
  assert.deepEqual(
    document.plan.map((item) => item.target),
    ['package.json', 'pnpm-workspace.yaml', '.gitignore', 'funky-secure.config.json'],
  );
  assert.ok(document.plan.every((item) => item.state === 'would-write'));

  const applied = runner(dir, { tracked });
  assert.equal(await applied.run(['init', '--preset', 'strict', '--apply']), 0);
  assert.equal(writeCount(applied.stdout.text), 4);

  const workspace = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8');
  assert.equal(blockCount(workspace), 1);
  assert.ok(workspace.includes('minimumReleaseAgeStrict: true'));
  assert.ok(workspace.includes('minimumReleaseAge: 4320'));

  const configText = readFileSync(join(dir, 'funky-secure.config.json'), 'utf8');
  assert.equal(configText, '{\n  "preset": "strict"\n}\n');
  assert.deepEqual(JSON.parse(configText), { preset: 'strict' });
});

test('a second --apply performs zero writes, reports nothing to apply and changes no byte', async (t) => {
  const dir = scratch(t, 'below-policy');
  const tracked = ['package.json', 'pnpm-lock.yaml'];

  assert.equal(await runner(dir, { tracked }).run(['init', '--preset', 'strict', '--apply']), 0);
  const afterFirst = snapshot(dir);

  const second = runner(dir, { tracked });
  assert.equal(await second.run(['init', '--preset', 'strict', '--apply']), 0);
  assert.match(second.stdout.text, /nothing to apply/);
  assert.equal(writeCount(second.stdout.text), 0);
  assert.deepEqual(snapshot(dir), afterFirst);
});

test('.gitignore gains the block once and omits .npmrc when a tokenless .npmrc is tracked', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "tokenless",\n  "private": true\n}\n');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  writeFileSync(join(dir, '.npmrc'), 'registry=https://registry.npmjs.org/\n');

  const tracked = ['package.json', 'pnpm-lock.yaml', '.npmrc'];
  const globalConfig = { minimumReleaseAge: 4320, minimumReleaseAgeStrict: true };
  const applied = runner(dir, { tracked, globalConfig });
  assert.equal(await applied.run(['init', '--apply']), 0);

  const gitignore = readFileSync(join(dir, '.gitignore'), 'utf8');
  assert.equal(blockCount(gitignore), 1);
  for (const entry of ['.env', '.env.*', '!.env.example', '!.env.test.example', '*.pem', '*.key']) {
    const pattern = `^${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    assert.match(gitignore, new RegExp(pattern, 'm'), `missing ${entry}`);
  }
  assert.doesNotMatch(gitignore, /^\.npmrc$/m, '.npmrc must be omitted for a tracked tokenless .npmrc');

  const second = runner(dir, { tracked, globalConfig });
  assert.equal(await second.run(['init', '--apply']), 0);
  assert.match(second.stdout.text, /nothing to apply/);
  assert.equal(writeCount(second.stdout.text), 0);
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), gitignore);
});

test('package.json gains packageManager and keeps its four-space indentation and trailing newline', async (t) => {
  const dir = scratch(t, 'four-space');
  const globalConfig = { minimumReleaseAge: 4320, minimumReleaseAgeStrict: true };

  assert.equal(await runner(dir, { tracked: ['package.json', 'pnpm-lock.yaml'], globalConfig }).run(['init', '--apply']), 0);

  const text = readFileSync(join(dir, 'package.json'), 'utf8');
  assert.ok(text.startsWith('{\n    "name"'), text);
  assert.ok(text.endsWith('}\n'), 'the trailing newline is preserved');
  assert.ok(!text.endsWith('\n\n'));
  assert.match(text, /^    "packageManager": "pnpm@12\.3\.4"$/m);
  assert.deepEqual(JSON.parse(text), {
    name: 'fixture-four-space',
    private: true,
    packageManager: 'pnpm@12.3.4',
  });
});

test('an existing conflicting pin is a conflict item and is never written', async (t) => {
  const dir = scratch(t, 'pinned-conflict');
  const before = readFileSync(join(dir, 'package.json'), 'utf8');
  const tracked = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.gitignore'];

  const preview = runner(dir, { tracked });
  assert.equal(await preview.run(['init', '--format', 'json']), 0);
  const document = JSON.parse(preview.stdout.text);
  assert.deepEqual(document.refused, []);

  const conflicts = document.plan.filter((item) => item.state === 'conflict');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].target, 'package.json');
  assert.equal(conflicts[0].digest, null);
  assert.match(conflicts[0].reason, /npm@10\.9\.0/);
  assert.ok(conflicts[0].path.startsWith(dir));
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before);

  const applied = runner(dir, { tracked });
  assert.equal(await applied.run(['init', '--apply']), 0);
  assert.match(applied.stdout.text, /conflicts/);
  // With the fixture block carrying the gate, the floor and savePrefix, the pin conflict is the only
  // plan item: nothing is written at all, and package.json keeps its bytes.
  assert.match(applied.stdout.text, /nothing to apply/);
  assert.equal(writeCount(applied.stdout.text), 0);
  assert.doesNotMatch(applied.stdout.text, /^write {2}.*package\.json/m);
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before);
});

test('without --apply a non-empty plan writes nothing and exits 0', async (t) => {
  const dir = scratch(t, 'below-policy');
  const before = snapshot(dir);

  const preview = runner(dir, { tracked: ['package.json', 'pnpm-lock.yaml'] });
  assert.equal(await preview.run(['init']), 0);
  assert.match(preview.stdout.text, /would write/);
  assert.equal(writeCount(preview.stdout.text), 0);
  assert.deepEqual(snapshot(dir), before);
});

test('the JSON plan document carries target, operation, absolute path, digest, reason and state', async (t) => {
  const dir = scratch(t, 'below-policy');
  const before = snapshot(dir);

  const preview = runner(dir, { tracked: ['package.json', 'pnpm-lock.yaml'] });
  assert.equal(await preview.run(['init', '--format', 'json']), 0);

  const document = JSON.parse(preview.stdout.text);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.command, 'init');
  assert.equal(document.tool.name, 'funky-secure');
  assert.deepEqual(document.policy, { preset: 'baseline', quarantineMinutes: 1440, failOn: 'none' });
  assert.deepEqual(document.refused, []);
  assert.deepEqual(
    document.plan.map((item) => [item.target, item.state]),
    [
      ['package.json', 'would-write'],
      ['pnpm-workspace.yaml', 'would-write'],
      ['.gitignore', 'would-write'],
    ],
  );
  for (const item of document.plan) {
    assert.ok(item.path.startsWith(dir), `${item.path} is not absolute inside the repository`);
    assert.match(item.digest, /^[0-9a-f]{64}$/);
    assert.equal(item.content, undefined, 'the plan document never prints the content');
    assert.ok(item.operation.length > 0);
    assert.ok(item.reason.length > 0);
  }
  assert.deepEqual(snapshot(dir), before);
});

test('a dirty target file exits 2 naming the file unless --allow-dirty', async (t) => {
  const dir = scratch(t, 'below-policy');
  const tracked = ['package.json', 'pnpm-lock.yaml'];

  const refused = runner(dir, { tracked, dirty: ['package.json'] });
  assert.equal(await refused.run(['init', '--apply']), 2);
  assert.equal(
    refused.stderr.text,
    'funky-secure: commit package.json or pass --allow-dirty, then re-run\n' +
      'reason: refusing to write over uncommitted changes: package.json\n',
  );
  assert.equal(existsSync(join(dir, 'pnpm-workspace.yaml')), false);

  const allowed = runner(dir, { tracked, dirty: ['package.json'] });
  assert.equal(await allowed.run(['init', '--apply', '--allow-dirty']), 0);
  assert.match(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'), /minimumReleaseAgeStrict: true/);
});

test('planFor composes W1, W2 and W3 from the context and a report, and adds W4 under strict', async (t) => {
  const dir = scratch(t, 'below-policy');
  const collector = collectorFor({ root: dir, tracked: ['package.json', 'pnpm-lock.yaml'] });
  const { ctx, policy, report } = await collectScan({
    cwd: dir,
    env: {},
    scope: 'all',
    failOn: 'none',
    catalog,
    collector,
  });

  const baseline = planFor(ctx, { policy, report });
  assert.deepEqual(
    baseline.map((item) => item.target),
    ['pnpm-workspace.yaml', '.gitignore', 'package.json'],
  );
  assert.ok(baseline.every((item) => item.state === 'would-write'));
  assert.ok(!baseline[0].content.includes('minimumReleaseAge:'));

  const strictPolicy = { ...policy, preset: 'strict', quarantineMinutes: 4320 };
  const strict = planFor(ctx, { policy: strictPolicy, report, configText: null });
  assert.deepEqual(
    strict.map((item) => item.target),
    ['pnpm-workspace.yaml', '.gitignore', 'package.json', 'funky-secure.config.json'],
  );
  assert.ok(strict[0].content.includes('minimumReleaseAge: 4320'));

  assert.deepEqual(planFor({ ...ctx, repo: null }, { policy, report }), []);
});

test('after --apply a fresh scan no longer reports the findings that drove the plan', async (t) => {
  const dir = scratch(t, 'below-policy');
  const tracked = ['package.json', 'pnpm-lock.yaml'];

  assert.equal(await runner(dir, { tracked }).run(['init', '--apply']), 0);

  const after = [...tracked, '.gitignore'];
  const repoScan = runner(dir, { tracked: after });
  await repoScan.run(['scan', '--scope', 'repo', '--format', 'json']);
  const repoCodes = JSON.parse(repoScan.stdout.text).findings.map((finding) => `${finding.rule}:${finding.code}`);
  assert.ok(!repoCodes.includes('package-manager-pin:pin-missing'), repoCodes.join(', '));
  assert.ok(!repoCodes.includes('sensitive-ignored:not-ignored'), repoCodes.join(', '));

  const allScan = runner(dir, { tracked: after });
  await allScan.run(['scan', '--scope', 'all', '--format', 'json']);
  const allCodes = JSON.parse(allScan.stdout.text).findings.map((finding) => `${finding.rule}:${finding.code}`);
  assert.ok(!allCodes.includes('quarantine:quarantine-not-strict'), allCodes.join(', '));
});

test('with --format json the plan document is the only stdout and the ledger goes to stderr', async (t) => {
  const dir = scratch(t, 'below-policy');
  const applied = runner(dir, { tracked: ['package.json', 'pnpm-lock.yaml'] });

  assert.equal(await applied.run(['init', '--format', 'json', '--apply']), 0);

  const document = JSON.parse(applied.stdout.text);
  assert.ok(Array.isArray(document.plan));
  assert.ok(document.plan.some((item) => item.state === 'would-write'));
  assert.ok(applied.stderr.text.includes('write  '), 'the write ledger never pollutes the JSON document');
});

test('the header never claims nothing was written when --apply performs writes', async (t) => {
  const dir = scratch(t, 'below-policy');
  const applied = runner(dir, { tracked: ['package.json', 'pnpm-lock.yaml'] });

  assert.equal(await applied.run(['init', '--apply']), 0);

  assert.match(applied.stdout.text, /applying the plan below/);
  assert.equal(applied.stdout.text.includes('nothing has been written'), false);
  assert.ok(writeCount(applied.stdout.text) > 0);
});

const SATISFYING = { minimumReleaseAge: 4320, minimumReleaseAgeStrict: true };

test('the plan is identical whether or not the machine satisfies the policy (RFC 11.2.1)', async (t) => {
  const dir = scratch(t, 'below-policy');
  const tracked = ['package.json', 'pnpm-lock.yaml'];

  // The same repository, two machines: one whose effective configuration meets the policy and one
  // whose does not. Only the collector's answer changes, and the plan must not notice.
  const satisfied = runner(dir, { tracked, globalConfig: SATISFYING });
  const unsatisfied = runner(dir, { tracked, globalConfig: {} });

  assert.equal(await satisfied.run(['init', '--format', 'json']), 0);
  assert.equal(await unsatisfied.run(['init', '--format', 'json']), 0);
  assert.equal(
    satisfied.stdout.text,
    unsatisfied.stdout.text,
    'the plan document must read the repository, not the effective configuration',
  );

  const document = JSON.parse(satisfied.stdout.text);
  const workspace = document.plan.find((item) => item.target === 'pnpm-workspace.yaml');
  assert.ok(workspace, 'a satisfying machine configuration must not suppress the write');
  assert.equal(workspace.state, 'would-write');

  const humanSatisfied = runner(dir, { tracked, globalConfig: SATISFYING });
  const humanUnsatisfied = runner(dir, { tracked, globalConfig: {} });
  assert.equal(await humanSatisfied.run(['init']), 0);
  assert.equal(await humanUnsatisfied.run(['init']), 0);
  assert.equal(humanSatisfied.stdout.text, humanUnsatisfied.stdout.text);
  assert.match(humanSatisfied.stdout.text, /would write/);
});

test('init --apply on a repository with no pnpm-workspace.yaml creates the managed block only (S2)', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "bootstrap",\n  "private": true\n}\n');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");

  assert.equal(
    await runner(dir, { tracked: ['package.json', 'pnpm-lock.yaml'] }).run(['init', '--apply']),
    0,
  );

  const workspace = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8');
  assert.equal(
    workspace,
    `${BEGIN}\nminimumReleaseAgeStrict: true\nsavePrefix: ''\n${END}\n`,
    'the created file carries the managed block and nothing else',
  );
  assert.equal(workspace.includes('packages:'), false, 'init never synthesizes a packages: key');
});

test('a savePrefix declared outside the managed block is a conflict, never a second source (W1c)', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "outside",\n  "packageManager": "pnpm@12.3.4"\n}\n');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), "savePrefix: '^'\n");

  const preview = runner(dir, { tracked: ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'] });
  assert.equal(await preview.run(['init', '--format', 'json']), 0);

  const document = JSON.parse(preview.stdout.text);
  const item = document.plan.find((entry) => entry.target === 'pnpm-workspace.yaml');
  assert.equal(item.state, 'conflict');
  assert.equal(
    item.reason,
    'pnpm-workspace.yaml already declares savePrefix outside the managed block; two sources for one setting are not written',
  );
  assert.equal(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'), "savePrefix: '^'\n");
});

test('next steps names pnpm install first when the repository has no pnpm-lock.yaml (S3)', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "no-lockfile",\n  "packageManager": "pnpm@12.3.4"\n}\n');

  const preview = runner(dir, { tracked: ['package.json'] });
  assert.equal(await preview.run(['init']), 0);

  assert.ok(
    preview.stdout.text.endsWith(
      'next steps\n  pnpm install\n  git add pnpm-workspace.yaml .gitignore\n',
    ),
    preview.stdout.text,
  );
});

test('next steps names the migrate command when a foreign lockfile coexists with the pnpm one (S3)', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "mixed",\n  "packageManager": "pnpm@12.3.4"\n}\n');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  writeFileSync(join(dir, 'package-lock.json'), '{}\n');

  const preview = runner(dir, { tracked: ['package.json', 'pnpm-lock.yaml', 'package-lock.json'] });
  assert.equal(await preview.run(['init']), 0);

  assert.ok(
    preview.stdout.text.endsWith(
      'next steps\n  funky-secure migrate --apply\n  git add pnpm-workspace.yaml .gitignore\n',
    ),
    preview.stdout.text,
  );
});

test('the migrate step carries no --from, so a yarn lockfile is not forced through npm (S3)', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "yarn-mixed",\n  "packageManager": "pnpm@12.3.4"\n}\n');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  writeFileSync(join(dir, 'yarn.lock'), '# yarn lockfile v1\n');

  const preview = runner(dir, { tracked: ['package.json', 'pnpm-lock.yaml', 'yarn.lock'] });
  assert.equal(await preview.run(['init']), 0);

  // `migrate` resolves the manager it finds: `pnpm import` for a yarn lockfile, `pnpm install`
  // otherwise. Naming `--from npm` here would force the wrong step (RFC 11.2.2, 11.3).
  assert.ok(
    preview.stdout.text.endsWith(
      'next steps\n  funky-secure migrate --apply\n  git add pnpm-workspace.yaml .gitignore\n',
    ),
    preview.stdout.text,
  );
  assert.equal(preview.stdout.text.includes('--from'), false, preview.stdout.text);
});

test('a plan with no human step prints no next steps heading (S3)', async (t) => {
  const dir = scratch(t, 'at-policy');

  const preview = runner(dir, {
    tracked: ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.gitignore'],
  });
  assert.equal(await preview.run(['init']), 0);

  assert.match(preview.stdout.text, /nothing to apply/);
  assert.equal(preview.stdout.text.includes('next steps'), false, preview.stdout.text);
});

test('the JSON plan document carries no next steps prose (S3)', async (t) => {
  const dir = scratch(t, 'below-policy');

  const preview = runner(dir, { tracked: ['package.json', 'pnpm-lock.yaml'] });
  assert.equal(await preview.run(['init', '--format', 'json']), 0);

  const document = JSON.parse(preview.stdout.text);
  assert.ok(document.plan.length > 0);
  assert.equal(preview.stdout.text.includes('next steps'), false);
  assert.equal(preview.stdout.text.includes('pnpm install'), false);
});
