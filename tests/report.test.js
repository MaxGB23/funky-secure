import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReport, severityRank } from '../src/lib/report.js';
import { renderHuman } from '../src/lib/render-human.js';
import { renderJson } from '../src/lib/render-json.js';
import { catalog as ruleCatalog } from '../src/rules/index.js';

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
    `${lines[1]}\n${lines[2]}`,
    'provenance  preset strict (--preset)  ·  quarantine not verified (machine excluded)  ·  machine\n' +
      '            excluded',
    'the provenance wraps in its own gutter rather than letting the terminal fold it',
  );
  assert.match(lines[3], /^summary  /, 'the counts follow the provenance line');

  const bare = renderHuman(buildReport({ scope: 'repo', policy, catalog, tool, findings: [] }));
  assert.equal(bare.includes('provenance'), false);
});

test('names the config file and the default as the preset source, and never a project value', () => {
  // The provenance line wraps now, so the assertion reads the block with its continuations joined.
  const render = (provenance) => {
    const text = renderHuman(
      buildReport({
        scope: 'all',
        policy: { ...policy, preset: 'strict' },
        catalog,
        tool,
        findings: [],
        provenance,
      }),
    );
    const lines = text.split('\n');
    const at = lines.findIndex((line) => line.startsWith('provenance'));
    const collected = [lines[at]];
    for (const line of lines.slice(at + 1)) {
      if (!line.startsWith('            ')) break;
      collected.push(line.trim());
    }
    return collected.join(' ');
  };

  assert.equal(
    render({ ...PROVENANCE, presetSource: 'funky-secure.config.json', machine: 'included', quarantine: 'declared in pnpm-workspace.yaml' }),
    'provenance  preset strict (funky-secure.config.json)  ·  quarantine declared in pnpm-workspace.yaml  ·  machine included',
  );
  assert.equal(
    render({ ...PROVENANCE, presetSource: 'default', machine: 'included', quarantine: 'not declared in this repository' }),
    'provenance  preset strict (default)  ·  quarantine not declared in this repository  ·  machine included',
  );
});

/// The `next` block (RFC 10.3, S1-S5): after `summary` and `verdict`, the human report names the one
/// command that moves the repository forward, in the same nine-character gutter as those two labels.

const NEXT = 'next     '; // nine characters, exactly like `summary  ` and `verdict  `
const CONTINUATION = ' '.repeat(NEXT.length);

function renderedLines(report) {
  return renderHuman(report).split('\n').filter((line) => line !== '');
}

function nextBlock(report) {
  const lines = renderedLines(report);
  const start = lines.findIndex((line) => line.startsWith('next'));
  return start === -1 ? [] : lines.slice(start);
}

function reportWith(findings, failOn = 'error') {
  return buildReport({
    scope: 'repo',
    policy: { ...policy, failOn },
    catalog: ruleCatalog,
    tool,
    targets: [{ kind: 'repo-root', path: '.' }],
    findings,
  });
}

const AUTO_QUARANTINE = finding({
  rule: 'quarantine',
  severity: 'error',
  target: 'repo-root',
  path: 'pnpm-workspace.yaml',
  remediation: { kind: 'auto', command: 'funky-secure init --apply' },
});

const AUTO_SENSITIVE = finding({
  rule: 'sensitive-ignored',
  severity: 'warn',
  target: 'repo-root',
  path: '.gitignore',
  remediation: { kind: 'auto', command: 'funky-secure init --apply' },
});

test('ends with init, the number of automatic fixes, and one rule to read next', () => {
  const report = reportWith([
    AUTO_QUARANTINE,
    AUTO_SENSITIVE,
    finding({
      rule: 'lockfile-committed',
      severity: 'warn',
      target: 'repo-root',
      path: 'pnpm-lock.yaml',
      remediation: { kind: 'none' },
    }),
  ]);

  assert.deepEqual(nextBlock(report), [
    `${NEXT}funky-secure init  plan the 2 fixes it can make (nothing is written)`,
    `${CONTINUATION}funky-secure explain quarantine   what this rule wants, and why`,
  ]);
});

test('says nothing is left to do when the verdict passes', () => {
  assert.deepEqual(nextBlock(reportWith([])), [
    `${NEXT}nothing to do: everything at or above the policy passes`,
  ]);
});

test('says the work is manual when the verdict fails and nothing is automatic', () => {
  const report = reportWith(
    [
      finding({
        rule: 'exact-versions',
        severity: 'warn',
        target: 'importer',
        path: 'package.json',
        line: 4,
        remediation: { kind: 'manual', command: 'pnpm install --lockfile-only' },
      }),
    ],
    'warn',
  );

  assert.deepEqual(nextBlock(report), [
    `${NEXT}manual: each finding names the file, its line, and the action`,
  ]);
});

test('breaks a severity tie by catalog order, never by alphabetical order', () => {
  const report = reportWith(
    [
      finding({
        rule: 'actions-pinned-sha',
        severity: 'warn',
        target: 'repo-root',
        path: '.github/workflows/ci.yml',
        remediation: { kind: 'auto', command: 'funky-secure init --apply' },
      }),
      finding({
        rule: 'exact-versions',
        severity: 'warn',
        target: 'importer',
        path: 'package.json',
        line: 4,
        remediation: { kind: 'auto', command: 'funky-secure init --apply' },
      }),
    ],
    'warn',
  );

  // Alphabetically `actions-pinned-sha` comes first, and the report order puts it first too because
  // `repo-root` precedes `importer`; the catalog has `exact-versions` at position 5 and
  // `actions-pinned-sha` at position 8, so catalog order is the only rule that names the second.
  assert.equal(
    nextBlock(report)[1],
    `${CONTINUATION}funky-secure explain exact-versions   what this rule wants, and why`,
  );
});

test('renders the same next block bytes on every run over the same state', () => {
  const report = reportWith([AUTO_QUARANTINE, AUTO_SENSITIVE]);
  const block = nextBlock(report).join('\n');

  assert.equal(renderHuman(report), renderHuman(report));
  assert.doesNotMatch(block, /\d{4}-\d{2}-\d{2}T/, 'the block carries no timestamp');
  assert.equal(block.includes('/'), false, 'the block names no path');
});

test('adds no field to the json document for the next block', () => {
  const report = reportWith([AUTO_QUARANTINE, AUTO_SENSITIVE]);
  const json = renderJson(report);

  assert.deepEqual(Object.keys(JSON.parse(json)), [
    'schemaVersion',
    'tool',
    'scope',
    'policy',
    'provenance',
    'targets',
    'summary',
    'findings',
  ]);
  assert.equal(json.includes('next'), false, 'the json document gained a next field');
  assert.equal(nextBlock(report).length, 2, 'the human report does carry the block');
});

test('keeps summary and verdict in their gutter at the top, with the next block last', () => {
  const lines = renderedLines(reportWith([AUTO_QUARANTINE], 'warn'));
  const summaryAt = lines.findIndex((line) => line.startsWith('summary'));

  assert.equal(lines[summaryAt].slice(0, 9), 'summary  ');
  assert.equal(lines[summaryAt + 1].slice(0, 9), 'verdict  ');
  assert.ok(summaryAt <= 3, 'summary and verdict belong to the header, before any target');
  assert.equal(lines[summaryAt + 2], '─'.repeat(90), 'a rule separates the header from the findings');
  assert.equal(
    lines.at(-1),
    `${CONTINUATION}funky-secure explain quarantine   what this rule wants, and why`,
  );
});

/// The shape of a finding (S1-S8): heading, message, action; label instead of id; at most 96 columns.

function blockOf(report, symbol) {
  const lines = renderedLines(report);
  const start = lines.findIndex((line) => line.startsWith(`  ${symbol}`));
  return start === -1 ? [] : lines.slice(start, start + 4);
}

const LONG = finding({
  rule: 'sensitive-ignored',
  severity: 'error',
  path: 'M:/.pnpm-store/v3/files/00/' + 'a'.repeat(90),
  message:
    '.env, .env.local, .env.production, secrets.pem, server.key and .npmrc are not ignored by git',
  remediation: { kind: 'auto', command: 'funky-secure init --apply' },
});

test('a finding is a heading, a message and an action, and names its label instead of its id', () => {
  const [head, first, second, third] = blockOf(reportWith([LONG]), '✖');

  assert.match(head, /^ {2}✖ {2}Sensitive files {2}· {2}M:\//, 'the heading names the label and the file');
  assert.equal(head.includes('sensitive-ignored'), false, 'the id is not part of the heading');
  assert.match(first, /^ {5}\.env, \.env\.local/, 'the message hangs from the symbol column');
  assert.equal([second, third].includes('     → funky-secure init --apply'), true, 'the action closes the block');
});

test('no rendered line exceeds 96 columns, even with a long machine path', () => {
  const report = buildReport({
    scope: 'all',
    policy,
    catalog: ruleCatalog,
    tool,
    targets: [
      { kind: 'machine', detail: `pnpm 12.3.4 (C:\\Users\\someone\\AppData\\Local\\pnpm\\pnpm.exe)  ·  store ${'M:\\' + 'x'.repeat(80)}` },
      { kind: 'repo-root', path: '.' },
    ],
    findings: [LONG],
  });

  for (const line of renderedLines(report)) {
    assert.ok(line.length <= 96, `line is ${line.length} columns: ${line}`);
  }
});

test('a clean target is one line, and never lists its rules', () => {
  const lines = renderedLines(reportWith([finding({ rule: 'alpha', status: 'pass' })]));

  const heading = lines.indexOf('REPO-ROOT');
  assert.ok(heading !== -1, `missing the clean target heading in ${lines.join('|')}`);
  assert.equal(lines[heading + 1], '     all 1 rule pass', 'the count hangs from the finding indent');
});

test('the verdict names what it did not verify, so PASS is never read as checked', () => {
  // Field report: `scan --scope repo` printed `verdict  PASS` with two rules unverified. The skip lines
  // said so below, and a reader who stops at the verdict — or a CI log that greps it — read "pass" as
  // "checked". The count belongs in the word, not only in the listing under it.
  const report = reportWith([
    finding({ rule: 'quarantine', status: 'skip', path: null, message: 'not verified' }),
    finding({ rule: 'exact-versions', status: 'skip', path: null, message: 'not verified either' }),
  ]);
  const line = renderedLines(report).find((entry) => entry.startsWith('verdict'));

  assert.equal(line, 'verdict  PASS (threshold: error · 2 rules not verified)');
  assert.ok(line.length <= 96, 'the verdict stays inside the column bound');
});

test('the verdict says nothing extra when every rule was verified', () => {
  const line = renderedLines(
    reportWith([finding({ rule: 'quarantine', status: 'pass', path: null, message: 'strict and mature' })]),
  ).find((entry) => entry.startsWith('verdict'));
  assert.equal(line, 'verdict  PASS (threshold: error)');
});

test('a single unverified rule is singular in the verdict', () => {
  const report = reportWith([finding({ rule: 'quarantine', status: 'skip', path: null, message: 'not verified' })]);
  const line = renderedLines(report).find((entry) => entry.startsWith('verdict'));
  assert.equal(line, 'verdict  PASS (threshold: error · 1 rule not verified)');
});

test('a single skipped rule keeps its own block; two or more collapse into one line', () => {
  const one = renderedLines(
    reportWith([finding({ rule: 'quarantine', status: 'skip', path: null, message: 'not verified' })]),
  );
  assert.ok(one.some((line) => line.startsWith('  –  Quarantine')), 'a single skip names itself');
  assert.ok(one.includes('     not verified'), 'a single skip states what was not verified');

  const many = renderedLines(
    reportWith([
      finding({ rule: 'quarantine', status: 'skip', path: null, message: 'not verified' }),
      finding({ rule: 'exact-versions', status: 'skip', path: null, message: 'not verified either' }),
    ]),
  );
  const collapsed = many.find((line) => line.includes('not verified:'));
  assert.equal(collapsed, '  –  2 rules not verified: Quarantine, Dependency ranges');
  assert.match(many[many.indexOf(collapsed) + 1], /^ {5}→ funky-secure scan --verbose/, 'the collapse says how to expand');
  assert.equal(many.some((line) => line.includes('not verified either')), false, 'the reasons moved behind --verbose');
});

test('--verbose restores the ids, the skip reasons and the passing rules', () => {
  const report = reportWith([
    finding({ rule: 'quarantine', status: 'skip', path: null, message: 'not verified' }),
    finding({ rule: 'exact-versions', status: 'skip', path: null, message: 'not verified either' }),
    finding({ rule: 'alpha', status: 'pass' }),
  ]);
  const text = renderHuman(report, { verbose: true });

  assert.ok(text.includes('·  quarantine'), 'the skipped rule id is visible');
  assert.ok(text.includes('not verified either'), 'the skipped rule reason is visible');
  assert.match(text, /^passing  1 rules \(alpha\)$/m, 'the passing rules are named again');
});

test('renders the same bytes on every run over the same state', () => {
  const report = reportWith([AUTO_QUARANTINE, AUTO_SENSITIVE, LONG]);
  assert.equal(renderHuman(report, { verbose: true }), renderHuman(report, { verbose: true }));
});

/// The honesty line (record 0003, S6, 10.3): when the effective policy leaves catalog rules unrun,
/// the human report says how many rules it does run and names the ones it does not, between `verdict`
/// and the separator, in the same nine-character gutter. A run that disables nothing is unchanged,
/// and the JSON document never learns about any of it.

const NOT_RUN = 'not run  '; // nine characters, exactly like `summary  ` and `verdict  `
const NOT_RUN_INDENT = ' '.repeat(NOT_RUN.length);

/** The five `starter` runs, in catalog order. */
/** The five the starter preset runs. */
const STARTER_ACTIVE = [
  'package-manager-pin',
  'foreign-lockfile',
  'lockfile-committed',
  'quarantine',
  'exact-versions',
  'sensitive-ignored',
];
/** The six the starter preset turns off, by the id the policy carries. */
const STARTER_OFF = ruleCatalog
  .map((rule) => rule.id)
  .filter((id) => !STARTER_ACTIVE.includes(id));

/** The same six, by the label a human reads, in catalog order. */
const DISABLED_LABELS = [
  'Environment files',
  'Pinned actions',
  'Bot auto-merge',
  'CI install flags',
  'pull_request_target',
  'Workflow permissions',
];

/** The honesty block of one rendering, or `[]` when it prints none. */
function honestyBlock(report, off) {
  const text = off === undefined ? renderHuman(report) : renderHuman(report, { off });
  const lines = text.split('\n').filter((line) => line !== '');
  const start = lines.findIndex((line) => line.startsWith(NOT_RUN));
  if (start === -1) return [];
  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(NOT_RUN_INDENT)) break;
    block.push(line);
  }
  return block;
}

/** The same rendering with the honesty block removed, so a test can prove it added nothing else. */
function withoutHonesty(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(NOT_RUN));
  if (start === -1) return text;
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith(NOT_RUN_INDENT)) end += 1;
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

test('states how many rules a reduced policy runs and names the ones it does not', () => {
  const block = honestyBlock(reportWith([AUTO_QUARANTINE]), STARTER_OFF);

  assert.ok(block.length > 0, 'a policy that disables rules prints the line');
  assert.equal(block[0].slice(0, NOT_RUN.length), NOT_RUN, 'the line sits in the shared gutter');

  const sentence = block.map((line) => line.slice(NOT_RUN.length)).join(' ');
  assert.equal(
    sentence,
    `6 of 12 rules; off by policy: ${DISABLED_LABELS.join(', ')}`,
    'the count is the active rules against the catalog, and the names are the labels in catalog order',
  );

  for (const line of block) {
    assert.ok(line.length <= 86, `the honesty line is ${line.length} columns: ${line}`);
  }
  for (const line of block.slice(1)) {
    assert.match(line, /^ {9}\S/, 'a continuation line hangs from the gutter, not from column zero');
  }
});

test('prints the honesty line after the verdict and before the separator', () => {
  const lines = renderHuman(reportWith([]), { off: STARTER_OFF })
    .split('\n')
    .filter((line) => line !== '');
  const verdictAt = lines.findIndex((line) => line.startsWith('verdict'));
  const separatorAt = lines.indexOf('─'.repeat(90));

  assert.equal(lines[verdictAt + 1].slice(0, NOT_RUN.length), NOT_RUN, 'immediately after the verdict');
  assert.ok(verdictAt + 1 < separatorAt, 'the line is in the header, before the findings');
});

test('prints no honesty line when the policy disables nothing, so baseline bytes do not move', () => {
  const report = reportWith([AUTO_QUARANTINE]);
  assert.deepEqual(honestyBlock(report, []), [], 'nothing is disabled, nothing is claimed');
  assert.equal(renderHuman(report).includes('not run'), false, 'a caller that passes no active list renders as before');
  assert.equal(
    withoutHonesty(renderHuman(report, { off: STARTER_OFF })),
    renderHuman(report),
    'the honesty block is the only difference between a reduced policy and a full one',
  );
});

test('adds nothing to the json document, whatever the policy disables', () => {
  const full = reportWith([AUTO_QUARANTINE, AUTO_SENSITIVE]);
  const reduced = reportWith([AUTO_QUARANTINE, AUTO_SENSITIVE]);
  const json = renderJson(full);

  assert.equal(renderJson(reduced), json, 'the same findings render the same bytes');
  assert.equal(json.includes('not run'), false, 'the machine contract carries no coverage prose');
  assert.equal(json.includes('off by policy'), false);
  assert.deepEqual(Object.keys(JSON.parse(json)), [
    'schemaVersion',
    'tool',
    'scope',
    'policy',
    'provenance',
    'targets',
    'summary',
    'findings',
  ]);
});
