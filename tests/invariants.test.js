/**
 * T14 of `odd/tasks/field-loop-every-rule.md`: the invariants that belong to no single rule (`S3`, `S4`).
 * One test per promise, table-driven where the promise is a table. Every fixture is built at run time
 * in the OS temp directory and driven by the deterministic fixture collector `scripts/gen-golden.js`
 * owns: files from the fixture, git from its `tracked.txt` and `.gitignore`, pnpm from `machine.json`.
 * No clock, no network, no spawn, no absolute path, no developer machine's pnpm configuration; the
 * child environment is the process environment with `CI` and every `npm_config_*` removed.
 *
 * Not measured, and why: `finding.code` parity (the human renderer never reads `code`, `S4`/`L5`), pass
 * findings (neither format lists one), per-finding skip parity (human collapses skips by target, 10.3),
 * and exact wrapped bytes (messages are compared with whitespace collapsed, long paths shortened). The
 * machine facts are the fixture's, so a real pnpm probe is the rules' own tests to measure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { run } from '../src/cli.js';
import { catalog } from '../src/rules/index.js';
import { buildFixtureCollector } from '../scripts/gen-golden.js';

const IDS = catalog.map((rule) => rule.id);
const LABEL_TO_ID = new Map(catalog.map((rule) => [rule.label, rule.id]));
const RANK = { none: 0, info: 1, warn: 2, error: 3 };
/** Docs/spec/policy.md 9.1: the six rules `starter` keeps at their `baseline` severity. */
const DAY_ZERO = [
  'package-manager-pin', 'lockfile-committed', 'foreign-lockfile',
  'quarantine', 'exact-versions', 'sensitive-ignored',
];
/** The promise 9.1 makes about `starter`: every other catalog rule is `off`. */
const STARTER_OFF = IDS.filter((id) => !DAY_ZERO.includes(id));

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-invariants-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, path, text) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

function capture() {
  return { text: '', isTTY: false, write(chunk) { this.text += chunk; return true; } };
}

/** The child environment: `CI` and every `npm_config_*` pinned away, nothing else invented. */
function childEnv() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.toUpperCase() !== 'CI' && !/^npm_config_/i.test(name)) env[name] = value;
  }
  return env;
}

/** One `scan` of the fixture, deterministic by construction; `cwd` may be a directory inside it. */
async function scan(dir, argv = [], cwd = dir) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(['scan', ...argv], {
    cwd,
    env: childEnv(),
    stdout,
    stderr,
    collector: buildFixtureCollector({ dir }),
  });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

async function report(dir, argv = [], cwd = dir) {
  const result = await scan(dir, [...argv, '--format', 'json'], cwd);
  assert.notEqual(result.code, 2, `a scan over this fixture never fails closed: ${result.stderr}`);
  return { ...result, json: JSON.parse(result.stdout) };
}

/**
 * Every failing rule of the catalog in one repository, so a run over it exercises all thirteen: no
 * pin, no pnpm lockfile, a foreign one, a floating range, a tracked environment file nothing ignores,
 * an unpinned action, a bot's automatic merge, a safety override, a `pull_request_target` that checks
 * out the head, `write-all`, and the issue #153 workflow-run pair.
 */
function sink(t) {
  const dir = scratch(t);
  write(dir, 'package.json', '{\n  "name": "invariants-fixture",\n  "version": "1.0.0",\n  "dependencies": { "yaml": "^2.9.0" }\n}\n');
  write(dir, 'package-lock.json', '{\n  "name": "invariants-fixture",\n  "lockfileVersion": 3\n}\n');
  write(dir, '.gitignore', 'node_modules/\n');
  write(dir, '.env', 'TOKEN=not-a-real-value\n');
  write(dir, 'tracked.txt', 'package.json\npackage-lock.json\n.env\n');
  write(dir, 'machine.json', '{\n  "version": "12.3.4",\n  "config": { "registry": "https://registry.npmjs.org/" }\n}\n');

  const workflows = {
    'ci.yml': [
      'name: ci', 'on: push', 'permissions: write-all', 'jobs:', '  build:',
      '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@v4',
      '      - run: pnpm install --no-frozen-lockfile',
    ],
    'automerge.yml': [
      'name: automerge', 'on: pull_request', 'jobs:', '  merge:',
      "    if: github.actor == 'dependabot[bot]'", '    runs-on: ubuntu-latest', '    steps:',
      '      - run: gh pr merge --auto --squash',
    ],
    'ptr.yml': [
      'name: ptr', 'on: pull_request_target', 'permissions: { contents: read }', 'jobs:', '  head:',
      '    runs-on: ubuntu-latest', '    steps:',
      '      - uses: actions/checkout@3d3c42e5e6b5c1f3a2b4c6d8e0f1a3b5c7d9e1f3 # v7.0.1',
      '        with:', '          ref: ${{ github.event.pull_request.head.sha }}',
    ],
    // The pair of issue #153, asserted by tests/rules/workflow-run-artifact.test.js:89.
    'pr-build.yml': [
      'name: pr build', 'on: pull_request', 'permissions: { contents: read }', 'jobs:', '  build:',
      '    runs-on: ubuntu-24.04', '    steps:',
      '      - uses: actions/upload-artifact@b4b15b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60 # v4.6.2',
      '        with: { name: pr-out, path: out.txt }',
    ],
    'label.yml': [
      'name: label', 'on:', '  workflow_run:', '    workflows: ["pr build"]', '    types: [completed]',
      'permissions: { contents: write, actions: read, pull-requests: write }', 'jobs:', '  label:',
      '    runs-on: ubuntu-24.04', '    steps:',
      '      - uses: actions/download-artifact@65a9edc1b2d3e4f5061728394a5b6c7d8e9f0a1b # v5.0.0',
      '        with:', '          run-id: ${{ github.event.workflow_run.id }}',
    ],
  };
  for (const [name, lines] of Object.entries(workflows)) {
    write(dir, `.github/workflows/${name}`, `${lines.join('\n')}\n`);
  }
  return dir;
}

/** A repository whose one question is answered by a pass: a tracked pnpm lockfile. */
function clean(t) {
  const dir = scratch(t);
  write(dir, 'package.json', '{\n  "name": "clean",\n  "packageManager": "pnpm@12.3.4"\n}\n');
  write(dir, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  write(dir, 'tracked.txt', 'package.json\npnpm-lock.yaml\n');
  write(dir, 'machine.json', '{ "version": "12.3.4", "config": { "minimumReleaseAge": 4320 } }\n');
  return dir;
}

/**
 * The findings a human report prints, read back from its own lines: the symbol line carries the label
 * and the location, the five-space lines under it carry the wrapped message (an action wraps at its
 * own wider indent). An aggregate line names no catalog label and is not one finding.
 */
function humanFindings(text) {
  const lines = text.split('\n');
  const parsed = [];
  lines.forEach((line, index) => {
    const heading = /^ {2}[✖⚠ℹ–] {2}(.+?)(?: {2}· {2}(.*))?$/.exec(line);
    const rule = heading === null ? undefined : LABEL_TO_ID.get(heading[1]);
    if (rule === undefined) return;
    const body = [];
    for (let next = index + 1; next < lines.length && /^ {5}(?!\s)/.test(lines[next]); next += 1) {
      const piece = lines[next].trim();
      if (!piece.startsWith('→') && !piece.startsWith('·')) body.push(piece);
    }
    parsed.push({ rule, location: heading[2] ?? '', message: body.join(' ').replace(/\s+/g, ' ') });
  });
  return parsed;
}

/** Sums one rule's findings into the counters `summary` carries them in (10.2). */
function counterOf(findings) {
  const counts = { error: 0, warn: 0, info: 0, pass: 0, skip: 0 };
  for (const finding of findings) {
    if (finding.status === 'pass') counts.pass += 1;
    else if (finding.status === 'skip') counts.skip += 1;
    else counts[finding.severity] += 1;
  }
  return counts;
}

test('the catalog is thirteen rules and every one of them carries a label a human reads', () => {
  assert.equal(IDS.length, 13);
  assert.equal(LABEL_TO_ID.size, 13);
});

test('exit codes answer --fail-on for a worst finding at each severity (10.4, 10.5)', async (t) => {
  // The worst finding each run can produce, how it is produced, and the code every --fail-on owes it.
  const rows = [
    { worst: 'error', flags: ['--only', 'sensitive-ignored'], codes: { error: 1, warn: 1, info: 1, none: 0 } },
    { worst: 'warn', flags: ['--only', 'foreign-lockfile'], codes: { error: 0, warn: 1, info: 1, none: 0 } },
    {
      // No rule states an `info` finding of its own: severity is policy (9.2), so the config is how a
      // run whose worst finding is `info` is built.
      worst: 'info',
      flags: ['--only', 'foreign-lockfile'],
      setup: (dir) => write(dir, 'funky-secure.config.json', '{"rules":{"foreign-lockfile":"info"}}\n'),
      codes: { error: 0, warn: 0, info: 1, none: 0 },
    },
    {
      worst: 'none',
      clean: true,
      flags: ['--only', 'lockfile-committed'],
      codes: { error: 0, warn: 0, info: 0, none: 0 },
    },
  ];

  for (const row of rows) {
    const dir = row.clean === true ? clean(t) : sink(t);
    row.setup?.(dir);
    for (const [failOn, expected] of Object.entries(row.codes)) {
      const { code, json } = await report(dir, [...row.flags, '--fail-on', failOn]);
      const where = `worst ${row.worst} · --fail-on ${failOn}`;
      // The row's premise, read from the report itself rather than assumed.
      if (row.worst === 'none') {
        assert.equal(json.summary.pass >= 1, true, `${where}: the rule must have run and answered a pass`);
      } else {
        assert.equal(json.summary[row.worst] >= 1, true, `${where}: no finding at severity ${row.worst}`);
      }
      for (const higher of ['error', 'warn', 'info']) {
        if (RANK[higher] <= RANK[row.worst]) continue;
        assert.equal(json.summary[higher], 0, `${where}: a ${higher} finding is above the row's worst`);
      }
      assert.equal(code, expected, `${where}: RFC 10.4 owes exit ${expected}`);
    }
  }
});

test('the three scopes select what 7.2 says, and an excluded rule states its skip code', async (t) => {
  const dir = sink(t);

  const auto = await report(dir);
  assert.equal(auto.json.scope, 'all', 'auto is all');
  assert.equal((await report(dir, ['--scope', 'all'])).stdout, auto.stdout, 'auto and all are one run');
  const kinds = auto.json.targets.map((target) => target.kind);
  assert.equal(kinds.includes('machine'), true, 'all carries the machine target');
  assert.equal(kinds.includes('repo-root'), true, 'all carries the repository target');

  const repo = await report(dir, ['--scope', 'repo']);
  assert.equal(repo.json.scope, 'repo');
  assert.equal(repo.json.provenance.machine, 'excluded');
  assert.equal(repo.json.targets.some((target) => target.kind === 'machine'), false);

  const machine = await report(dir, ['--scope', 'machine']);
  assert.equal(machine.json.scope, 'machine');
  assert.equal(machine.json.targets.some((target) => target.kind === 'repo-root'), false);
  const perRule = new Map(machine.json.findings.map((finding) => [finding.rule, finding]));
  assert.deepEqual([...perRule.keys()].sort(), [...IDS].sort(), 'every catalog rule answers');
  // `quarantine` is the rule the machine target exists for (7.1) and the one rule that answers here.
  assert.equal(perRule.get('quarantine').status, 'fail');
  assert.equal(perRule.get('quarantine').code, 'quarantine-not-strict');
  for (const id of IDS.filter((rule) => rule !== 'quarantine')) {
    const finding = perRule.get(id);
    assert.equal(finding.status, 'skip', `${id} must skip when the repository is excluded`);
    assert.match(finding.message, /excluded by --scope machine/, `${id} names the exclusion`);
    // 10.1: `no-repo` is the code that means "no repository facts in this scope", so every excluded
    // rule states the exclusion in its code and no rule carries a file's code for a scope that never
    // looked for the file.
    assert.match(String(finding.code), /^no-repo/, `${id} states its exclusion in its code`);
  }
  // The human side names the excluded rules as well, or the fact is only machine-readable.
  assert.match((await scan(dir, ['--scope', 'machine'])).stdout, /excluded by --scope machine/);
});

test('the presets: only starter disables anything, and it disables exactly seven rules (9.1)', async (t) => {
  const dir = sink(t);
  /** @type {Record<string, string[]>} */
  const ran = {};

  for (const preset of ['baseline', 'strict', 'starter']) {
    ran[preset] = [];
    for (const id of IDS) {
      const { json } = await report(dir, ['--preset', preset, '--only', id]);
      if (json.findings.length > 0) ran[preset].push(id);
    }
  }

  for (const preset of ['baseline', 'strict']) {
    assert.deepEqual([...ran[preset]].sort(), [...IDS].sort(), `${preset} runs the whole catalog`);
  }
  assert.deepEqual([...ran.starter].sort(), [...DAY_ZERO].sort(), 'starter runs the six day-zero rules');
  for (const id of STARTER_OFF) {
    assert.equal(ran.baseline.includes(id), true, `${id} must run under baseline, or its silence proves nothing`);
  }

  // The human report states the coverage the preset leaves out, and only then: the number is the rules
  // the preset turned off, and the names after the colon are the same seven (10.3).
  assert.match((await scan(dir, ['--preset', 'starter'])).stdout, /^not run {2}7 of 13 rules; off by policy: /m);
  for (const preset of ['baseline', 'strict']) {
    assert.doesNotMatch((await scan(dir, ['--preset', preset])).stdout, /^not run {2}/m, `${preset} disables nothing`);
  }
});

test('--ignore and --only leave a rule with neither a finding nor a count (9.2, 10.2)', async (t) => {
  const dir = sink(t);
  const full = await report(dir, ['--preset', 'baseline']);
  const counters = ['error', 'warn', 'info', 'pass', 'skip'];

  for (const id of ['sensitive-ignored', 'foreign-lockfile']) {
    const ignored = await report(dir, ['--preset', 'baseline', '--ignore', id]);
    assert.deepEqual(ignored.json.findings.filter((finding) => finding.rule === id), [], `${id} leaves no finding`);
    const mine = counterOf(full.json.findings.filter((finding) => finding.rule === id));
    assert.equal(mine.error + mine.warn + mine.info + mine.skip > 0, true, `${id} did something to subtract`);
    for (const counter of counters) {
      assert.equal(ignored.json.summary[counter], full.json.summary[counter] - mine[counter], `${id} leaves no ${counter} count`);
    }
  }

  const pair = ['sensitive-ignored', 'foreign-lockfile'];
  const only = await report(dir, ['--preset', 'baseline', '--only', pair.join(',')]);
  assert.deepEqual([...new Set(only.json.findings.map((finding) => finding.rule))].sort(), [...pair].sort());
  for (const id of pair) {
    const single = await report(dir, ['--preset', 'baseline', '--only', id]);
    for (const counter of counters) {
      assert.equal(
        counterOf(only.json.findings.filter((finding) => finding.rule === id))[counter],
        single.json.summary[counter],
        `--only with several ids runs ${id} exactly as --only ${id} does`,
      );
    }
  }
});

test('both formats agree on count, path, line and message for every rule (S4)', async (t) => {
  const dir = sink(t);
  const flags = ['--preset', 'baseline', '--fail-on', 'none'];
  const json = await report(dir, flags);
  const human = await scan(dir, flags);

  const failing = json.json.findings.filter((finding) => finding.status === 'fail');
  const byRule = new Map(IDS.map((id) => [id, []]));
  for (const finding of failing) byRule.get(finding.rule)?.push(finding);
  assert.deepEqual(
    IDS.filter((id) => byRule.get(id).length === 0),
    [],
    'the fixture must fail every rule, or parity is claimed for a rule never run',
  );

  // The claim is recounted from a different invocation directory, as S6 asks: repository-anchored
  // facts must not follow the directory the command was run from (#347).
  const nested = await report(dir, flags, join(dir, '.github'));
  assert.deepEqual(nested.json.findings, json.json.findings, 'a run from a subdirectory reports the same facts');

  const printed = humanFindings(human.stdout);
  const order = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b));
  for (const id of IDS) {
    const expected = byRule.get(id).map((finding) => ({
      location: !finding.path ? '' : finding.line ? `${finding.path}:${finding.line}` : finding.path,
      message: finding.message.replace(/\s+/g, ' '),
    }));
    const actual = printed.filter((finding) => finding.rule === id).map(({ location, message }) => ({ location, message }));
    assert.equal(actual.length, expected.length, `${id}: the count differs between formats`);
    assert.deepEqual(actual.sort(order), expected.sort(order), `${id}: human and JSON disagree`);
  }
});
