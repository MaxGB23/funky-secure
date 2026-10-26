import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReport, severityRank } from '../src/lib/report.js';
import { renderHuman } from '../src/lib/render-human.js';
import { renderJson } from '../src/lib/render-json.js';

const tool = { name: 'funky-secure', version: '0.1.0' };
const catalog = [{ id: 'alpha' }, { id: 'beta' }, { id: 'gamma' }];
const policy = { preset: 'baseline', quarantineMinutes: 1440, failOn: 'error' };

function finding(overrides = {}) {
  return {
    rule: 'alpha',
    status: 'fail',
    severity: 'warn',
    scope: 'repo',
    target: 'repo-root',
    path: 'package.json',
    message: 'a message',
    remediation: { kind: 'none' },
    doc: 'funky-secure explain alpha',
    ...overrides,
  };
}

test('severityRank orders off < info < warn < error', () => {
  assert.deepEqual(
    ['off', 'info', 'warn', 'error'].map(severityRank),
    [0, 1, 2, 3],
  );
});

test('orders findings by scope, then target, then rule, then path, then line', () => {
  const report = buildReport({
    scope: 'all',
    policy,
    catalog,
    tool,
    targets: [{ kind: 'repo-root', path: '.' }],
    findings: [
      finding({ rule: 'beta', path: 'z.txt', line: 3 }),
      finding({ rule: 'alpha', path: 'z.txt', line: 9 }),
      finding({ rule: 'alpha', path: 'z.txt', line: 2 }),
      finding({ rule: 'alpha', path: 'a.txt' }),
      finding({ rule: 'beta', scope: 'machine', target: 'machine', path: undefined }),
      finding({ rule: 'alpha', target: 'ci', path: '.github/workflows/ci.yml' }),
      finding({ rule: 'alpha', target: 'importer', path: 'packages/api/package.json' }),
    ],
  });

  assert.deepEqual(
    report.findings.map((f) => `${f.scope}/${f.target}/${f.path ?? '-'}:${f.line ?? '-'}/${f.rule}`),
    [
      'machine/machine/-:-/beta',
      'repo/repo-root/a.txt:-/alpha',
      'repo/repo-root/z.txt:2/alpha',
      'repo/repo-root/z.txt:9/alpha',
      'repo/repo-root/z.txt:3/beta',
      'repo/importer/packages/api/package.json:-/alpha',
      'repo/ci/.github/workflows/ci.yml:-/alpha',
    ],
  );
});

test('counts every rule verdict exactly once and never counts a pass under its severity', () => {
  const report = buildReport({
    scope: 'repo',
    policy,
    catalog,
    tool,
    targets: [],
    findings: [
      finding({ rule: 'alpha', status: 'fail', severity: 'error' }),
      finding({ rule: 'beta', status: 'fail', severity: 'warn' }),
      finding({ rule: 'gamma', status: 'pass', severity: 'error' }),
      finding({ rule: 'gamma', status: 'skip' }),
    ],
  });

  assert.deepEqual(report.summary, {
    error: 1,
    warn: 1,
    info: 0,
    pass: 1,
    skip: 1,
    verdict: 'fail',
  });
});

test('counts a tool error as an error and lets it fail the run', () => {
  const report = buildReport({
    scope: 'repo',
    policy,
    catalog,
    tool,
    targets: [],
    findings: [finding({ status: 'error', severity: 'error' })],
  });

  assert.equal(report.summary.error, 1);
  assert.equal(report.summary.verdict, 'fail');
});

test('derives the verdict from --fail-on and never from a skip or an info', () => {
  const only = (findings, failOn) =>
    buildReport({ scope: 'repo', policy: { ...policy, failOn }, catalog, tool, targets: [], findings })
      .summary.verdict;

  const warn = [finding({ severity: 'warn' })];
  const info = [finding({ severity: 'info' })];
  const skip = [finding({ status: 'skip', severity: 'error' })];

  assert.equal(only(warn, 'error'), 'pass');
  assert.equal(only(warn, 'warn'), 'fail');
  assert.equal(only(info, 'warn'), 'pass');
  assert.equal(only(info, 'info'), 'fail');
  assert.equal(only(warn, 'none'), 'pass');
  assert.equal(only([], 'error'), 'pass');
  assert.equal(only(skip, 'info'), 'pass');
});

test('keeps the policy it was given and never invents a timestamp', () => {
  const report = buildReport({
    scope: 'repo',
    policy: { preset: 'strict', quarantineMinutes: 4320, failOn: 'warn' },
    catalog,
    tool,
    targets: [{ kind: 'repo-root', path: '.' }],
    findings: [],
  });

  assert.deepEqual(report.policy, { preset: 'strict', quarantineMinutes: 4320, failOn: 'warn' });
  assert.equal(report.schemaVersion, 1);
  assert.equal('generatedAt' in report, false);
});

test('serializes fail, skip and error findings only, and passes stay counted', () => {
  const report = buildReport({
    scope: 'repo',
    policy,
    catalog,
    tool,
    targets: [],
    findings: [
      finding({ status: 'pass', severity: 'error' }),
      finding({ status: 'fail', severity: 'warn' }),
      finding({ status: 'skip' }),
      finding({ status: 'error', severity: 'error' }),
    ],
  });

  const parsed = JSON.parse(renderJson(report));

  assert.deepEqual(parsed.findings.map((f) => f.status), ['fail', 'skip', 'error']);
  assert.equal(parsed.summary.pass, 1);
});

test('renders deterministic json: two spaces, trailing newline, no timestamp', () => {
  const report = buildReport({
    scope: 'repo',
    policy,
    catalog,
    tool,
    targets: [],
    findings: [finding()],
  });

  const first = renderJson(report);
  const second = renderJson(report);

  assert.equal(first, second);
  assert.ok(first.endsWith('}\n'));
  assert.match(first, /\n  "schemaVersion": 1,/);
  assert.equal(first.includes('generatedAt'), false);
  assert.equal(JSON.parse(first).tool.name, 'funky-secure');
});

test('renders an empty repository as a valid, passing report', () => {
  const report = buildReport({
    scope: 'all',
    policy,
    catalog: [],
    tool,
    targets: [{ kind: 'repo-root', path: '.' }],
    findings: [],
  });

  const parsed = JSON.parse(renderJson(report));

  assert.deepEqual(parsed.findings, []);
  assert.deepEqual(parsed.summary, {
    error: 0,
    warn: 0,
    info: 0,
    pass: 0,
    skip: 0,
    verdict: 'pass',
  });
});

test('adds generatedAt only when the caller asks for it', () => {
  const report = buildReport({
    scope: 'repo',
    policy,
    catalog,
    tool,
    targets: [],
    findings: [],
  });

  assert.equal(renderJson(report, { timestamp: '2026-10-23T00:00:00.000Z' }).includes('"generatedAt": "2026-10-23T00:00:00.000Z"'), true);
  assert.equal(renderJson(report).includes('generatedAt'), false);
});

test('normalizes strings to NFC so two byte-equal inputs render byte-equal output', () => {
  const report = buildReport({
    scope: 'repo',
    policy,
    catalog,
    tool,
    targets: [],
    findings: [finding({ message: 'cafe\u0301' })],
  });

  assert.equal(report.findings[0].message, 'caf\u00e9');
});

/// Provenance (S7): the report states where its preset came from and what it measured about the
/// quarantine, and it never claims a source the run did not observe.

const PROVENANCE = Object.freeze({
  preset: 'strict',
  presetSource: '--preset',
  quarantine: 'not verified (machine excluded)',
  machine: 'excluded',
});

test('carries the provenance facts in the json document and null when nothing was measured', () => {
  const stated = buildReport({
    scope: 'repo',
    policy: { ...policy, preset: 'strict' },
    catalog,
    tool,
    findings: [],
    provenance: PROVENANCE,
  });

  assert.deepEqual(JSON.parse(renderJson(stated)).provenance, PROVENANCE);

  const bare = buildReport({ scope: 'repo', policy, catalog, tool, findings: [] });
  assert.equal(JSON.parse(renderJson(bare)).provenance, null, 'no provenance is claimed without one');
});

test('renders one provenance line right after the title, and omits it when nothing was measured', () => {
  const stated = buildReport({
    scope: 'repo',
    policy: { ...policy, preset: 'strict' },
    catalog,
    tool,
    findings: [],
    provenance: PROVENANCE,
  });
  const lines = renderHuman(stated).split('\n');

  assert.equal(lines[0], 'funky-secure scan  ·  preset strict  ·  scope repo');
  assert.equal(
    lines[1],
    'provenance  preset strict (--preset)  ·  quarantine not verified (machine excluded)  ·  machine excluded',
  );
  assert.equal(lines[2], '');

  const bare = renderHuman(buildReport({ scope: 'repo', policy, catalog, tool, findings: [] }));
  assert.equal(bare.includes('provenance'), false);
});

test('names the config file and the default as the preset source, and never a project value', () => {
  const render = (provenance) =>
    renderHuman(
      buildReport({
        scope: 'all',
        policy: { ...policy, preset: 'strict' },
        catalog,
        tool,
        findings: [],
        provenance,
      }),
    ).split('\n')[1];

  assert.equal(
    render({ ...PROVENANCE, presetSource: 'funky-secure.config.json', machine: 'included', quarantine: 'declared in pnpm-workspace.yaml' }),
    'provenance  preset strict (funky-secure.config.json)  ·  quarantine declared in pnpm-workspace.yaml  ·  machine included',
  );
  assert.equal(
    render({ ...PROVENANCE, presetSource: 'default', machine: 'included', quarantine: 'not declared in this repository' }),
    'provenance  preset strict (default)  ·  quarantine not declared in this repository  ·  machine included',
  );
});
