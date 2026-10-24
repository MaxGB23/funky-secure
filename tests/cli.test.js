import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FLAGS, parseArgs, renderHelp, run } from '../src/cli.js';
import { catalog } from '../src/rules/index.js';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A collector for every probe: no pnpm, no git, reads only the files the test placed. */
function fakeCollector({ root = null } = {}) {
  return {
    read: async (path) => {
      try {
        return { ok: true, value: await readFile(path, 'utf8') };
      } catch (error) {
        return { ok: false, error };
      }
    },
    git: async (args) => {
      if (root !== null && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return { ok: true, code: 0, stdout: `${root}\n`, stderr: '' };
      }
      if (root !== null && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
        return { ok: true, code: 0, stdout: 'feat/work\n', stderr: '' };
      }
      if (root !== null && args[0] === 'ls-files') {
        return { ok: true, code: 0, stdout: '', stderr: '' };
      }
      if (root !== null && args[0] === 'status') {
        return { ok: true, code: 0, stdout: '', stderr: '' };
      }
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

function io(cwd, options = {}) {
  const { catalog: rules, ...collectorOptions } = options;
  const streams = {
    cwd,
    env: {},
    stdout: capture(),
    stderr: capture(),
    collector: fakeCollector(collectorOptions),
  };
  if (rules !== undefined) streams.catalog = rules;
  return streams;
}

test('parseArgs applies the documented defaults to scan', () => {
  assert.deepEqual(parseArgs(['scan']), {
    command: 'scan',
    options: { scope: 'auto', format: 'human', failOn: 'error' },
    positionals: [],
  });
});

test('parseArgs accumulates comma-separated --only and --ignore across repeats', () => {
  const { options } = parseArgs([
    'scan',
    '--only',
    'a,b',
    '--only',
    'c',
    '--ignore',
    'd,e',
  ]);

  assert.deepEqual(options.only, ['a', 'b', 'c']);
  assert.deepEqual(options.ignore, ['d', 'e']);
});

test('parseArgs accepts the --flag=value form', () => {
  const { command, options } = parseArgs(['scan', '--format=json', '--scope=repo']);

  assert.equal(command, 'scan');
  assert.equal(options.format, 'json');
  assert.equal(options.scope, 'repo');
});

test('parseArgs reads the migrate default --from auto', () => {
  assert.equal(parseArgs(['migrate']).options.from, 'auto');
});

test('bad usage exits 2 with one funky-secure line on stderr and nothing on stdout', async (t) => {
  const dir = scratch(t);
  const cases = [
    [['bogus'], 'bogus'],
    [['scan', '--nope'], '--nope'],
    [['scan', '--apply'], '--apply'],
    [['scan', '--scope'], '--scope'],
    [['scan', '--scope', 'galaxy'], 'galaxy'],
    [['scan', '--format', 'xml'], 'xml'],
    [['init', '--fail-on', 'warn'], '--fail-on'],
    [['migrate', '--format', 'json'], '--format'],
    [['explain'], 'rule id'],
    [['explain', 'one', 'two'], 'one'],
    [['explain', '--list', 'ghost'], '--list'],
    [['init', '--apply=true'], '--apply'],
    [['scan', 'extra'], 'extra'],
  ];

  for (const [argv, needle] of cases) {
    const streams = io(dir);
    const code = await run(argv, streams);

    assert.equal(code, 2, `expected exit 2 for ${argv.join(' ')}`);
    assert.equal(streams.stdout.text, '', `expected no stdout for ${argv.join(' ')}`);
    assert.match(streams.stderr.text, /^funky-secure: /);
    assert.ok(
      streams.stderr.text.includes(needle),
      `expected ${JSON.stringify(needle)} in ${JSON.stringify(streams.stderr.text)}`,
    );
  }
});

test('--help exits 0 and lists every command and the flags a user looks for', async () => {
  const streams = io(process.cwd());
  const code = await run(['--help'], streams);

  assert.equal(code, 0);
  for (const name of ['scan', 'init', 'migrate', 'explain']) {
    assert.ok(streams.stdout.text.includes(name), `missing command ${name}`);
  }
  for (const flag of ['--strict-probes', '--fail-on', '--allow-dirty']) {
    assert.ok(streams.stdout.text.includes(flag), `missing flag ${flag}`);
  }
});

test('no command prints help and exits 0', async () => {
  const streams = io(process.cwd());
  const code = await run([], streams);

  assert.equal(code, 0);
  assert.match(streams.stdout.text, /usage:/);
});

test('renderHelp names the product, every command, every flag and every catalog rule', () => {
  const help = renderHelp();

  assert.match(help, /funky-secure 0\.1\.0/);
  for (const command of ['scan', 'init', 'migrate', 'explain']) {
    assert.ok(help.includes(command));
  }
  for (const flag of FLAGS) {
    assert.ok(help.includes(flag.name), `missing ${flag.name}`);
  }
  for (const rule of catalog) {
    assert.ok(help.includes(rule.id), `missing rule ${rule.id}`);
    assert.ok(help.includes(`${rule.severity.baseline}/${rule.severity.strict}`));
  }
  assert.ok(
    renderHelp({ catalog: [] }).includes('(none registered yet)'),
    'an empty catalog is a valid help text',
  );
});

test('scan --format json on an empty directory with an empty catalog prints a passing empty report', async (t) => {
  const dir = scratch(t);
  const streams = io(dir, { catalog: [] });
  const code = await run(['scan', '--format', 'json'], streams);

  assert.equal(code, 0);
  const report = JSON.parse(streams.stdout.text);
  assert.deepEqual(report.findings, []);
  assert.equal(report.summary.verdict, 'pass');
});

test('scan --format json in an empty directory reports the real catalog and fails on it', async (t) => {
  const dir = scratch(t);
  const streams = io(dir);
  const code = await run(['scan', '--format', 'json'], streams);

  assert.equal(code, 1, 'a missing lockfile is a policy violation');
  const report = JSON.parse(streams.stdout.text);
  const codes = report.findings.map((finding) => `${finding.rule}:${finding.code}`);
  assert.ok(
    codes.includes('lockfile-committed:lockfile-missing'),
    `expected the missing lockfile in ${codes.join(', ')}`,
  );
  assert.equal(
    report.findings.length + report.summary.pass,
    catalog.length,
    'every rule reports exactly once',
  );
  assert.equal(report.summary.verdict, 'fail');
});

test('scan human output shows the verdict', async (t) => {
  const dir = scratch(t);
  const streams = io(dir, { catalog: [] });
  const code = await run(['scan'], streams);

  assert.equal(code, 0);
  assert.ok(streams.stdout.text.includes('verdict  PASS'));
});

test('explain with an unknown rule id exits 2 and names the id', async (t) => {
  const dir = scratch(t);
  const streams = io(dir);
  const code = await run(['explain', 'ghost'], streams);

  assert.equal(code, 2);
  assert.ok(streams.stderr.text.includes('ghost'));
});

test('init prints a plan and writes nothing without --apply', async (t) => {
  const dir = scratch(t);
  const streams = io(dir);
  const code = await run(['init'], streams);

  assert.equal(code, 0);
  assert.ok(streams.stdout.text.includes('nothing to apply'));
  assert.deepEqual(readdirSync(dir), []);
});

test('init --apply on an empty plan writes nothing', async (t) => {
  const dir = scratch(t);
  const streams = io(dir);
  const code = await run(['init', '--apply'], streams);

  assert.equal(code, 0);
  assert.ok(streams.stdout.text.includes('nothing to apply'));
  assert.deepEqual(readdirSync(dir), []);
});

test('migrate prints the five RFC steps in order from the repository facts', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', packageManager: 'npm@10.0.0' }));
  writeFileSync(join(dir, 'package-lock.json'), '{}');

  const streams = io(dir, { root: dir });
  const code = await run(['migrate'], streams);

  assert.equal(code, 0);
  assert.match(
    streams.stdout.text,
    /1\. evidence[\s\S]*2\. report-only[\s\S]*3\. human step[\s\S]*4\. removal[\s\S]*5\. ci follow-up/,
  );
  assert.ok(streams.stdout.text.includes('package-lock.json'));
  assert.ok(streams.stdout.text.includes('npm@10.0.0'));
  assert.ok(streams.stdout.text.includes('pnpm install'));
});

test('migrate refuses outside git with exit 2', async (t) => {
  const dir = scratch(t);
  const streams = io(dir);
  const code = await run(['migrate'], streams);

  assert.equal(code, 2);
  assert.ok(streams.stderr.text.includes('git'));
});

test('migrate --apply refuses when the pnpm lockfile is absent', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }));
  writeFileSync(join(dir, 'package-lock.json'), '{}');

  const streams = io(dir, { root: dir });
  const code = await run(['migrate', '--apply'], streams);

  assert.equal(code, 2);
  assert.ok(streams.stderr.text.includes('pnpm-lock.yaml'));
});

test('migrate --apply removes the foreign lockfile on a clean feature branch', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }));
  writeFileSync(join(dir, 'package-lock.json'), '{}');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

  const streams = io(dir, { root: dir });
  const code = await run(['migrate', '--apply'], streams);

  assert.equal(code, 0);
  assert.equal(existsSync(join(dir, 'package-lock.json')), false, 'the foreign lockfile is gone');
  assert.equal(existsSync(join(dir, 'pnpm-lock.yaml')), true, 'the pnpm lockfile survives');
  assert.ok(streams.stdout.text.includes('step 4 complete'));
});

test('scan --scope repo keeps every machine fact out of the contract', async (t) => {
  const dir = scratch(t);
  const streams = io(dir);
  const code = await run(['scan', '--scope', 'repo', '--format', 'json'], streams);

  const report = JSON.parse(streams.stdout.text);
  const pin = report.findings.find((finding) => finding.rule === 'package-manager-pin');

  assert.equal(code, 1, 'the missing lockfile still fails the repo gate');
  assert.equal(pin.status, 'skip');
  assert.equal(pin.code, 'no-pnpm');
  assert.match(pin.message, /machine is out of scope/);
});
