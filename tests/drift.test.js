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

test('every catalog rule carries its own short human label', () => {
  const seen = new Map();

  for (const rule of catalog) {
    assert.equal(typeof rule.label, 'string', `${rule.id} carries no label`);
    const label = rule.label.trim();
    assert.equal(label, rule.label, `${rule.id} label has stray whitespace`);
    assert.ok(label.length > 0 && label.length <= 28, `${rule.id} label is ${label.length} chars`);
    assert.doesNotMatch(label, /[🌀-🫿☀-➿]/u, `${rule.id} label carries an emoji`);
    assert.equal(seen.has(label), false, `"${label}" is used by ${seen.get(label)} and ${rule.id}`);
    seen.set(label, rule.id);
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
  assert.ok(
    text.includes('rfcs/0001-funky-secure-v1/rfc.md'),
    'decisions.md does not point at the record behind the contract',
  );

  // Appendix A defines D-1 through D-16. The bound is asserted rather than inferred so that a
  // silently truncated log fails here instead of passing on the numbers it happens to mention.
  for (let number = 1; number <= 16; number += 1) {
    assert.match(text, new RegExp(`\\bD-${number}(?!\\d)`), `decisions.md does not mention D-${number}`);
  }
});

/// The two axes (docs/spec/README.md): the record is frozen history, the spec is the present contract.
/// These gates keep the record from silently losing sections and keep the spec from drifting away
/// from the record it was extracted from.

const RECORD = join(ROOT, 'rfcs', '0001-funky-secure-v1', 'rfc.md');

/**
 * The index table as a map from file name to its row. The prose and the amendments table both cite
 * files, so the row must be recognised by its shape — number, topic, local `.md` link — and not by
 * looking up a name inside a regular expression.
 * @param {string} index
 * @returns {Map<string, { section: number, path: string }>}
 */
function specRows(index) {
  const rows = new Map();

  for (const line of index.split('\n')) {
    const row = line.match(/^\| (\d+) \| [^|]*\| \[`([^`]+\.md)`\]\(([^)]+)\) \|$/);
    if (row !== null) rows.set(row[2], { section: Number(row[1]), path: row[3] });
  }

  return rows;
}

/**
 * The amendments table: section number to the record that replaced its contract. A section that is
 * amended leaves the verbatim comparison, because the spec becomes the authority for its new text.
 * @param {string} index
 * @returns {Map<number, { number: string, path: string }>}
 */
function amendmentsIn(index) {
  const amendments = new Map();
  const table = index.split('## Amendments')[1];
  if (table === undefined) return amendments;

  for (const line of table.split('\n')) {
    const row = line.match(/^\| (\d+) \| \[`([^`]+)`\]\(([^)]+)\) \|/);
    if (row !== null) amendments.set(Number(row[1]), { number: row[2], path: row[3] });
  }
  return amendments;
}

function recordSections() {
  const text = readFileSync(RECORD, 'utf8');
  return [...text.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
}

test('the frozen record still has every numbered section, in order', () => {
  assert.ok(existsSync(RECORD), 'rfcs/0001-funky-secure-v1/rfc.md is missing');

  // A section is never removed from a record: the inventory is asserted, not inferred, so that an
  // accidental edit of history fails here instead of being noticed by a reader months later.
  const sections = recordSections();
  assert.deepEqual(
    sections,
    Array.from({ length: 21 }, (_, index) => index + 1),
    'the record no longer carries sections 1 through 21',
  );
});

test('docs/spec/README.md maps every section of the record to the file that carries it', () => {
  const index = readFileSync(join(ROOT, 'docs', 'spec', 'README.md'), 'utf8');

  for (const section of recordSections()) {
    assert.match(
      index,
      new RegExp(`^\\| ${section} \\|`, 'm'),
      `docs/spec/README.md has no row for section ${section}`,
    );
  }
});

test('every file docs/spec/README.md points at exists, and no section body was reworded', () => {
  const index = readFileSync(join(ROOT, 'docs', 'spec', 'README.md'), 'utf8');
  const record = readFileSync(RECORD, 'utf8');
  const amended = amendmentsIn(index);
  const rows = specRows(index);

  // Only the table's own targets are local files; the prose cites the record, which lives elsewhere.
  const targets = [...index.matchAll(/\[`([^`/]*\.md)`\]/g)].map((match) => match[1]);
  assert.ok(targets.length > 0, 'the spec index points at no file');

  for (const target of targets) {
    const path = join(ROOT, 'docs', 'spec', target);
    assert.ok(existsSync(path), `the spec index points at a missing ${path}`);

    // Each file is a verbatim slice of the record: header, blank line, then the section itself.
    const text = readFileSync(path, 'utf8');
    const body = text.slice(text.indexOf('\n## ') + 1).trimEnd();
    assert.ok(body.startsWith('## '), `${target} carries no section of the record`);

    // A section a later record amended is the authority now, so it is no longer compared with the
    // frozen record — but the amendment must name a record that exists and is not still a draft,
    // and the file must keep the section heading, or its number stops resolving.
    const section = rows.get(target)?.section ?? null;
    const amendment = section === null ? null : amended.get(section);
    if (amendment !== null && amendment !== undefined) {
      const recordPath = join(ROOT, 'docs', 'spec', amendment.path);
      assert.ok(existsSync(recordPath), `${target} is amended by a record that is not there`);
      assert.match(
        readFileSync(recordPath, 'utf8'),
        /\| \*\*Status\*\* \| `(accepted|implemented|closed)`/,
        `${target} is amended by a record that is still a draft`,
      );
      assert.match(body, new RegExp(`^## ${section}\\. `), `${target} lost its section number`);
      continue;
    }

    assert.ok(record.includes(body), `${target} no longer matches the record verbatim`);
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
