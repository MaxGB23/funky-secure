import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FLAGS, parseArgs, renderHelp, run } from '../src/cli.js';
import { BEGIN, END } from '../src/lib/managed-block.js';
import { catalog } from '../src/rules/index.js';
import { FIXTURES, buildFixtureCollector } from '../scripts/gen-golden.js';

const VERSION = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version;

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

test('bad usage exits 2 with the action first, the reason labelled, and nothing on stdout', async (t) => {
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
    const lines = streams.stderr.text.split('\n');
    assert.match(lines[0], /^funky-secure: \S/, 'the first line is the action, not the diagnosis');
    assert.match(lines[1], /^reason: /, 'the diagnosis follows the reason: label');
    assert.ok(
      lines[1].includes(needle),
      `expected ${JSON.stringify(needle)} in ${JSON.stringify(streams.stderr.text)}`,
    );
    assert.equal(lines[2], '', 'a usage error is exactly two lines');
  }
});

test('a rejected flag value leads with the accepted values', async (t) => {
  const dir = scratch(t);
  const streams = io(dir);
  const code = await run(['scan', '--scope', 'galaxy'], streams);

  assert.equal(code, 2);
  assert.equal(streams.stdout.text, '');
  assert.equal(
    streams.stderr.text,
    'funky-secure: pass --scope one of auto, repo, machine, all\n' +
      'reason: --scope must be one of auto, repo, machine, all (got "galaxy")\n',
  );
});

test('a malformed config exits 2 with the action first and the offending key as the reason', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'funky-secure.config.json'), JSON.stringify({ preset: 'paranoid' }));
  const streams = io(dir);
  const code = await run(['scan'], streams);

  assert.equal(code, 2);
  assert.equal(streams.stdout.text, '');
  assert.equal(
    streams.stderr.text,
    'funky-secure: fix funky-secure.config.json and run the command again\n' +
      'reason: funky-secure.config.json: unknown preset "paranoid"\n',
  );
});

test('every failure in the human report prints the action that fixes it', async (t) => {
  const dir = scratch(t);
  const streams = io(dir);
  const code = await run(['scan', '--scope', 'repo'], streams);

  assert.equal(code, 1);
  const lines = streams.stdout.text.split('\n');
  const failures = lines
    .map((line, index) => ({ line, next: lines[index + 1] ?? '' }))
    .filter((entry) => /^ {2}[✖⚠ℹ] /.test(entry.line));

  assert.ok(failures.length > 0, 'the empty repository reports at least one failure');
  for (const { line, next } of failures) {
    assert.match(next, /^ {2,}→ \S/, `no remediation under ${JSON.stringify(line)}`);
  }
  assert.match(
    streams.stdout.text,
    /✖ lockfile-committed {2,}pnpm-lock\.yaml {2,}pnpm-lock\.yaml is missing[^\n]*\n {2,}→ pnpm install\n/,
    'the missing lockfile names the human step',
  );
});

test('every failure in a golden fixture prints the action that fixes it', async () => {
  const failures = [];

  for (const fixture of FIXTURES) {
    const stdout = capture();
    const stderr = capture();
    await run(['scan'], {
      cwd: fixture.dir,
      env: {},
      stdout,
      stderr,
      collector: buildFixtureCollector({ dir: fixture.dir }),
    });

    assert.equal(stderr.text, '', `the scan of ${fixture.name} wrote to stderr`);
    const lines = stdout.text.split('\n');
    lines.forEach((line, index) => {
      if (!/^ {2}[✖⚠ℹ] /.test(line)) return;
      failures.push({ fixture: fixture.name, line, next: lines[index + 1] ?? '' });
    });
  }

  assert.ok(failures.length > 0, 'no fixture reports a failure');
  for (const { fixture, line, next } of failures) {
    assert.match(next, /^ {2,}→ \S/, `${fixture}: no remediation under ${JSON.stringify(line)}`);
  }

  // The guard must keep reaching the two rules whose remediation is an edit, not a command, so a
  // future fixture change cannot make it silently vacuous.
  const reported = new Set(failures.map(({ line }) => line.trim().split(/\s+/)[1]));
  for (const id of ['env-not-tracked', 'no-bot-auto-merge']) {
    assert.ok(reported.has(id), `no fixture failure reached ${id}`);
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

  assert.ok(
    help.includes(`funky-secure ${VERSION}`),
    `the help must name the package version ${VERSION}`,
  );
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

test('init prints a non-empty plan and writes nothing without --apply', async (t) => {
  const dir = scratch(t);
  const streams = io(dir);
  const code = await run(['init'], streams);

  assert.equal(code, 0);
  // A directory with no pnpm-workspace.yaml gets one planned (W1a/W1c), so this proves the write did
  // not happen while the plan was non-empty — not that the plan happened to be empty.
  assert.match(streams.stdout.text, /would write/);
  assert.ok(streams.stdout.text.includes('pnpm-workspace.yaml'));
  assert.equal(streams.stdout.text.includes('nothing to apply'), false);
  // The steps the tool refuses to take are printed, never executed (RFC 11.2.2).
  assert.match(streams.stdout.text, /next steps\n {2}pnpm install\n/);
  assert.deepEqual(readdirSync(dir), [], 'the plan wrote nothing');
});

test('init --apply on an empty plan writes nothing', async (t) => {
  const dir = scratch(t);
  // A repository already at policy: the pin is declared, the managed block carries the gate and
  // savePrefix, a pnpm lockfile exists and nothing else is left to plan.
  writeFileSync(
    join(dir, 'package.json'),
    '{\n  "name": "at-policy",\n  "private": true,\n  "packageManager": "pnpm@12.3.4"\n}\n',
  );
  writeFileSync(
    join(dir, 'pnpm-workspace.yaml'),
    `${BEGIN}\nminimumReleaseAgeStrict: true\nsavePrefix: ''\n${END}\n`,
  );
  writeFileSync(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  const before = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].map((name) => [
    name,
    readFileSync(join(dir, name), 'utf8'),
  ]);

  const streams = io(dir);
  const code = await run(['init', '--apply'], streams);

  assert.equal(code, 0);
  assert.ok(streams.stdout.text.includes('nothing to apply'));
  assert.equal(streams.stdout.text.includes('next steps'), false, 'no human step applies');
  for (const [name, text] of before) {
    assert.equal(readFileSync(join(dir, name), 'utf8'), text, `${name} was written`);
  }
  assert.deepEqual(readdirSync(dir).sort(), before.map(([name]) => name).sort());
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

test('scan --scope repo keeps every machine fact out of the contract and says what it did not verify', async (t) => {
  const dir = scratch(t);
  const streams = io(dir);
  const code = await run(['scan', '--scope', 'repo', '--format', 'json'], streams);

  const report = JSON.parse(streams.stdout.text);
  const pin = report.findings.find((finding) => finding.rule === 'package-manager-pin');
  const quarantine = report.findings.find((finding) => finding.rule === 'quarantine');

  assert.equal(code, 1, 'the missing lockfile still fails the repo gate');
  assert.equal(pin.status, 'skip');
  assert.equal(pin.code, 'no-pnpm');
  assert.match(pin.message, /machine is out of scope/);
  assert.match(pin.message, /pin was not compared with the pnpm that answers/);
  assert.match(pin.message, /--scope all/);

  assert.equal(quarantine.status, 'skip');
  assert.match(quarantine.message, /^skipped: /);
  assert.match(quarantine.message, /quarantine was not verified/);
  assert.match(quarantine.message, /--scope all/);
});

test('the human report states its provenance from the config file, the flag or the default', async (t) => {
  const bare = scratch(t);
  const fromDefault = io(bare);
  await run(['scan', '--scope', 'repo'], fromDefault);
  assert.equal(
    fromDefault.stdout.text.split('\n')[1],
    'provenance  preset baseline (default)  ·  quarantine not verified (machine excluded)  ·  machine excluded',
  );

  const configured = scratch(t);
  writeFileSync(join(configured, 'funky-secure.config.json'), JSON.stringify({ preset: 'strict' }));

  const fromConfig = io(configured);
  await run(['scan', '--scope', 'repo'], fromConfig);
  assert.equal(
    fromConfig.stdout.text.split('\n')[1],
    'provenance  preset strict (funky-secure.config.json)  ·  quarantine not verified (machine excluded)  ·  machine excluded',
  );

  const fromFlag = io(configured);
  await run(['scan', '--scope', 'repo', '--preset', 'baseline'], fromFlag);
  assert.equal(
    fromFlag.stdout.text.split('\n')[1],
    'provenance  preset baseline (--preset)  ·  quarantine not verified (machine excluded)  ·  machine excluded',
  );
});

test('the json report carries the same provenance facts, and only what was measured', async (t) => {
  const declared = scratch(t);
  writeFileSync(join(declared, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 4320\n');
  const statements = io(declared);
  await run(['scan', '--format', 'json'], statements);

  assert.deepEqual(JSON.parse(statements.stdout.text).provenance, {
    preset: 'baseline',
    presetSource: 'default',
    quarantine: 'declared in pnpm-workspace.yaml',
    machine: 'included',
  });

  const undeclared = scratch(t);
  const silent = io(undeclared);
  await run(['scan', '--format', 'json'], silent);

  assert.deepEqual(JSON.parse(silent.stdout.text).provenance, {
    preset: 'baseline',
    presetSource: 'default',
    quarantine: 'not declared in this repository',
    machine: 'included',
  });
});
