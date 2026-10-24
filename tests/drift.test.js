import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMANDS, FLAGS, renderHelp } from '../src/cli.js';
import { catalog } from '../src/rules/index.js';
import { FIXTURES, goldenPath, renderGolden } from '../scripts/gen-golden.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RULES_DIR = join(ROOT, 'docs', 'rules');

function rulePages() {
  if (!existsSync(RULES_DIR)) return [];
  return readdirSync(RULES_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort();
}

test('every catalog rule has a docs/rules/<id>.md page', () => {
  for (const rule of catalog) {
    const page = join(RULES_DIR, `${rule.id}.md`);
    assert.ok(existsSync(page), `${rule.id} has no ${page}`);
  }
});

test('every docs/rules page declares a rule id the catalog contains', () => {
  const known = new Set(catalog.map((rule) => rule.id));

  for (const name of rulePages()) {
    const text = readFileSync(join(RULES_DIR, name), 'utf8');
    const declared = text.match(/^Rule id:\s*`([^`]+)`/m);
    assert.ok(declared, `${name} has no "Rule id: \`<id>\`" line`);
    assert.ok(known.has(declared[1]), `${name} declares unknown rule id "${declared[1]}"`);
  }
});

test('help output contains every catalog rule id and every parsed flag', () => {
  const help = renderHelp({ catalog });

  for (const rule of catalog) {
    assert.ok(help.includes(rule.id), `help lacks rule ${rule.id}`);
  }
  for (const flag of FLAGS) {
    assert.ok(help.includes(flag.name), `help lacks flag ${flag.name}`);
  }
});

test('every flag parsed by the CLI appears in docs/cli.md', () => {
  const text = readFileSync(join(ROOT, 'docs', 'cli.md'), 'utf8');

  for (const flag of FLAGS) {
    assert.ok(text.includes(flag.name), `docs/cli.md lacks ${flag.name}`);
  }
});

test('docs/architecture.md mentions only src paths that exist', () => {
  const text = readFileSync(join(ROOT, 'docs', 'architecture.md'), 'utf8');
  const mentioned = [...text.matchAll(/src\/[A-Za-z0-9_./-]+\.js/g)].map((match) => match[0]);

  assert.ok(mentioned.length > 0, 'architecture.md lists no src modules');
  for (const path of mentioned) {
    assert.ok(existsSync(join(ROOT, path)), `architecture.md mentions missing ${path}`);
  }
});

/// The README is a rendering of the catalog too (RFC 13.4, F4): the drift gate keeps it honest.

const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

function readmeTableRows() {
  return README.split(/\r?\n/).filter((line) => line.startsWith('|'));
}

test('the README rule table carries every catalog rule id with its exact severities', () => {
  const rows = readmeTableRows();

  for (const rule of catalog) {
    const severity = `${rule.severity?.baseline ?? 'warn'} / ${rule.severity?.strict ?? 'warn'}`;
    const row = rows.find((line) => line.includes(`\`${rule.id}\``));
    assert.ok(row, `README has no table row for ${rule.id}`);
    assert.ok(row.includes(severity), `README row for ${rule.id} does not state "${severity}": ${row}`);
  }
});

test('the README names every command', () => {
  for (const command of COMMANDS) {
    assert.ok(README.includes(command.name), `README lacks the ${command.name} command`);
  }
});

/// The prose count is a rendering of the catalog too, and package.json already drifted from it once.

test('the README states the catalog size it actually has', () => {
  const WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  };
  const stated = README.match(/([A-Za-z]+|\d+)\s+stateless rules/);
  assert.ok(stated, 'the README no longer states how many stateless rules the catalog has');

  const count = /^\d+$/.test(stated[1]) ? Number(stated[1]) : WORDS[stated[1].toLowerCase()];
  assert.ok(count !== undefined, `the README count "${stated[1]}" is not a number this gate understands`);
  assert.equal(count, catalog.length, `the README says ${stated[1]} and the catalog has ${catalog.length}`);
});

test('the package description carries no rule count that can drift', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.doesNotMatch(manifest.description, /\bnine\b|\bten\b|\beleven\b|\btwelve\b|\d+ (stateless )?rules/i);
});

test('docs/decisions.md exists and records every decision the RFC number', () => {
  const path = join(ROOT, 'docs', 'decisions.md');
  assert.ok(existsSync(path), 'docs/decisions.md is missing');

  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes('rfcs/funky-secure-rfc.md'), 'decisions.md does not point at the RFC');

  // Appendix A defines D-1 through D-16. The bound is asserted rather than inferred so that a
  // silently truncated log fails here instead of passing on the numbers it happens to mention.
  for (let number = 1; number <= 16; number += 1) {
    assert.match(text, new RegExp(`\\bD-${number}(?!\\d)`), `decisions.md does not mention D-${number}`);
  }
});

/// The golden gate (RFC 15.2). The fixtures, the deterministic collector and the renderer are the
/// generator's, imported above, so this test cannot drift from `scripts/gen-golden.js`.

test('every golden report matches the deterministic collector regenerates', async () => {
  for (const fixture of FIXTURES) {
    const path = goldenPath(fixture.name);
    assert.ok(
      existsSync(path),
      `tests/golden/${fixture.name}.json is missing; run \`node scripts/gen-golden.js\``,
    );

    const expected = readFileSync(path, 'utf8');
    const actual = await renderGolden(fixture);
    assert.equal(
      actual,
      expected,
      `the golden for fixture "${fixture.name}" no longer matches; run \`node scripts/gen-golden.js\` and review the diff`,
    );
  }
});
