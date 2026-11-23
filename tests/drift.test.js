import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

test('every command the CLI dispatches has its own section in docs/cli.md', () => {
  const text = readFileSync(join(ROOT, 'docs', 'cli.md'), 'utf8');

  for (const command of COMMANDS) {
    assert.match(
      text,
      new RegExp(`^### \`${command.name}\`$`, 'm'),
      `docs/cli.md has no "### \`${command.name}\`" section`,
    );
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

/// The command flows (RFC 13.4): `docs/architecture.md` draws one flow per command, and `COMMANDS`
/// is the list `src/cli.js` dispatches, so a command cannot gain or lose its diagram silently.

test('docs/architecture.md draws a mermaid flow for every command', () => {
  const text = readFileSync(join(ROOT, 'docs', 'architecture.md'), 'utf8');
  const start = text.search(/^## Command flows$/m);
  assert.notEqual(start, -1, 'docs/architecture.md has no "## Command flows" section');

  // The section runs to the next level-two heading, so a flow outside it does not count.
  const after = text.slice(start);
  const next = after.slice(1).search(/^## /m);
  const section = next === -1 ? after : after.slice(0, next + 1);

  for (const command of COMMANDS) {
    const heading = new RegExp(`^### \`${command.name}\`$`, 'm');
    const matched = heading.exec(section);
    assert.ok(
      matched,
      `docs/architecture.md has no "### \`${command.name}\`" heading under "## Command flows"`,
    );

    const body = section.slice(matched.index + matched[0].length);
    const end = body.search(/^#{2,3} /m);
    const subsection = end === -1 ? body : body.slice(0, end);
    assert.match(
      subsection,
      /^```mermaid$/m,
      `the "### \`${command.name}\`" flow carries no mermaid block`,
    );
  }
});

/// The README is a rendering of the catalog too (RFC 13.4, F4): the drift gate keeps it honest.

const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

function readmeTableRows() {
  return README.split(/\r?\n/).filter((line) => line.startsWith('|'));
}

test('the README rule table carries every catalog rule id with its exact severities', () => {
  const rows = readmeTableRows();
  const pair = (severity) => `${severity?.baseline ?? 'warn'} / ${severity?.strict ?? 'warn'}`;

  for (const rule of catalog) {
    const row = rows.find((line) => line.includes(`\`${rule.id}\``));
    assert.ok(row, `README has no table row for ${rule.id}`);

    const severity = pair(rule.severity);
    assert.ok(row.includes(severity), `README row for ${rule.id} does not state "${severity}": ${row}`);

    // A rule whose severity follows the state of its finding (record 0029) states one pair per state,
    // so the row carries every pair the catalog declares and names the state it belongs to. The gate
    // verifies the catalog, never one rule id.
    for (const entry of rule.severityWhen ?? []) {
      const stated = pair(entry.severity);
      assert.ok(
        row.includes(stated),
        `README row for ${rule.id} does not state "${stated}" for the ${entry.state} state: ${row}`,
      );
      assert.ok(
        row.includes(entry.state),
        `README row for ${rule.id} does not name the ${entry.state} state: ${row}`,
      );
    }
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

test('the shipped skill declares the version of this package', () => {
  const text = readFileSync(join(ROOT, 'skills', 'funky-secure', 'SKILL.md'), 'utf8');
  const declared = /^version:[ \t]*(\S+)/m.exec(text);
  assert.ok(declared, 'skills/funky-secure/SKILL.md declares no version, so an installed copy cannot be compared');
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(declared[1], manifest.version, 'the skill version and the package version disagree');
});

test('the shipped skill names only commands the CLI dispatches', () => {
  const path = join(ROOT, 'skills', 'funky-secure', 'SKILL.md');
  assert.ok(existsSync(path), 'skills/funky-secure/SKILL.md is missing');

  const text = readFileSync(path, 'utf8');
  const known = new Set(COMMANDS.map((command) => command.name));
  const named = [...text.matchAll(/funky-secure ([a-z][a-z-]*)/g)].map((match) => match[1]);
  const commands = named.filter((word) => !word.startsWith('-'));

  assert.ok(commands.length > 0, 'the skill names no command at all');
  for (const command of new Set(commands)) {
    assert.ok(known.has(command), `the skill names "${command}", which the CLI does not dispatch`);
  }
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
 * The amendments table, one row per amendment: the record, and every section the row names. A section
 * cell may name one section or several, and a named section is an integer or a dotted sub-section —
 * `| 10, 8, 11 |`, `| 11.7 |`, `| 11.2.1 |` — so the row is read as the claim it makes instead of
 * being skipped by the shape of its cell. A section may be amended more than once — record 0002
 * rewrote the human report and record 0003 added a line to it — so the table is a list of rows, not a
 * row per section, and every record it names is verified instead of only the last one.
 * @param {string} index
 * @returns {Array<{ number: string, path: string, sections: string[] }>}
 */
function amendmentsIn(index) {
  const table = index.split('## Amendments')[1];
  if (table === undefined) return [];

  const amendments = [];
  for (const line of table.split('\n')) {
    const row = line.match(/^\| (\d+(?:\.\d+)*(?:,\s*\d+(?:\.\d+)*)*) \| \[`([^`]+)`\]\(([^)]+)\) \|/);
    if (row === null) continue;

    amendments.push({
      number: row[2],
      path: row[3],
      sections: row[1].split(',').map((cell) => cell.trim()),
    });
  }

  return amendments;
}

/**
 * The pages a row amends. A named section belongs to the page that carries its integer part, because
 * `11.7` is a section of `commands.md`, the file section `11` is — so a row naming two sub-sections of
 * one page, or the same page twice, still amends that page once.
 * @param {{ sections: string[] }} amendment
 * @returns {Set<number>}
 */
function amendedPages(amendment) {
  return new Set(amendment.sections.map((section) => Number(section.split('.')[0])));
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

/**
 * The gate over one repository: every file `docs/spec/README.md` points at exists and is a verbatim
 * slice of the frozen record, except a section a later record amended — which must name a record that
 * exists, is not still a `draft`, and keeps its section heading so its number keeps resolving. `root`
 * is a repository, so a failure case can be a fixture instead of an edit of the table under test.
 * @param {string} root
 */
function verifySpec(root) {
  const index = readFileSync(join(root, 'docs', 'spec', 'README.md'), 'utf8');
  assert.ok(
    existsSync(join(root, 'rfcs', '0001-funky-secure-v1', 'rfc.md')),
    'rfcs/0001-funky-secure-v1/rfc.md is missing',
  );
  const record = readFileSync(join(root, 'rfcs', '0001-funky-secure-v1', 'rfc.md'), 'utf8');
  const rows = specRows(index);
  const amendments = amendmentsIn(index);

  // Only the table's own targets are local files; the prose cites the record, which lives elsewhere.
  const targets = [...index.matchAll(/\[`([^`/]*\.md)`\]/g)].map((match) => match[1]);
  assert.ok(targets.length > 0, 'the spec index points at no file');

  // Every record the table names exists under `docs/spec` and is not still a `draft`. A row is one
  // claim about one record — a cell naming three sections does not name three records — so it is
  // verified here once, by the sections it names, and not once per page those sections land on.
  for (const amendment of amendments) {
    const sections = amendment.sections.join(', ');
    const recordPath = join(root, 'docs', 'spec', amendment.path);
    assert.ok(
      existsSync(recordPath),
      `the amendments table names ${amendment.number} for ${sections}, and that record is not there`,
    );
    assert.match(
      readFileSync(recordPath, 'utf8'),
      /\| \*\*Status\*\* \| `(accepted|implemented|closed)`/,
      `the amendments table names ${amendment.number} for ${sections}, which is still a draft`,
    );
  }

  for (const target of targets) {
    const path = join(root, 'docs', 'spec', target);
    assert.ok(existsSync(path), `the spec index points at a missing ${path}`);

    // Each file is a verbatim slice of the record: header, blank line, then the section itself.
    const text = readFileSync(path, 'utf8');
    const body = text.slice(text.indexOf('\n## ') + 1).trimEnd();
    assert.ok(body.startsWith('## '), `${target} carries no section of the record`);

    // A section a later record amended is the authority now, so it is no longer compared with the
    // frozen record — whether the row names it alone, in a list, or as a dotted sub-section — but the
    // file must keep the section heading, or its number stops resolving. A section may carry more than
    // one amendment, and dropping every row but the last would leave all but the newest unverified.
    const section = rows.get(target)?.section ?? null;
    const amended = section !== null && amendments.some((row) => amendedPages(row).has(section));
    if (amended) {
      assert.match(body, new RegExp(`^## ${section}\\. `), `${target} lost its section number`);
      continue;
    }

    assert.ok(record.includes(body), `${target} no longer matches the record verbatim`);
  }
}

test('every file docs/spec/README.md points at exists, and no section body was reworded', () => {
  verifySpec(ROOT);
});

/// The gate is itself a test, so its own failure cases need an input the suite can break on purpose: a
/// temporary repository in the shape `verifySpec` reads, written to the OS temp directory and removed
/// with the test. Editing the real Amendments table to prove the gate would prove nothing.

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-drift-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, path, text) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

/** A record of three sections, and the three pages that carry it: each page is a verbatim slice. */
const SPEC_RECORD = `# The record

## 8. Rule catalog

the rules.

## 10. Report contract

the report.

## 11. Command contracts

the commands.
`;

const SPEC_PAGES = {
  'rules.md': '# rules\n\n## 8. Rule catalog\n\nthe rules.\n',
  'report.md': '# report\n\n## 10. Report contract\n\nthe report.\n',
  'commands.md': '# commands\n\n## 11. Command contracts\n\nthe commands.\n',
};

/** The three rows of the spec map, so a fixture's amendment has a section to land on. */
const CARRIED_BY = [
  '| 8 | Rule catalog | [`rules.md`](rules.md) |',
  '| 10 | Report contract | [`report.md`](report.md) |',
  '| 11 | Command contracts | [`commands.md`](commands.md) |',
];

/** One record of `rfcs/` in the shape the gate reads, with the status its fixture needs. */
function amendmentRecord(number, status) {
  return `# ${number}\n\n| **Status** | \`${status}\` |\n`;
}

/**
 * An index in the shape `docs/spec/README.md` has: the spec map, then the Amendments table.
 * @param {string[]} amendments
 * @returns {string}
 */
function specIndex(amendments) {
  return [
    '# Specification', '',
    '| § | Topic | Carried by |', '|---|---|---|',
    ...CARRIED_BY, '',
    '## Amendments', '',
    '| § | Record | What it replaced |', '|---|---|---|',
    ...amendments, '',
  ].join('\n');
}

/**
 * A temporary repository the gate reads: the index, the frozen record, the pages it carries, and the
 * records its amendments table names, each path relative to `rfcs/`.
 * @param {import('node:test').TestContext} t
 * @returns {string} the repository root
 */
function specRepository(t, { amendments, pages = SPEC_PAGES, records = {} }) {
  const dir = scratch(t);
  write(dir, 'docs/spec/README.md', specIndex(amendments));
  write(dir, 'rfcs/0001-funky-secure-v1/rfc.md', SPEC_RECORD);
  for (const [name, text] of Object.entries(pages)) write(dir, `docs/spec/${name}`, text);
  for (const [path, text] of Object.entries(records)) write(dir, `rfcs/${path}`, text);
  return dir;
}

test('an amendment naming a list of sections verifies the record it names', (t) => {
  // The real table has rows named `| 10, 8, 11 |` and `| 8, 11 |`; a row of that shape was skipped by
  // the parse, so the gate passed a repository whose record does not exist at all.
  const dir = specRepository(t, {
    amendments: [
      '| 10, 8, 11 | [`0022`](../../rfcs/0022-the-output-tells-the-truth/rfc.md) | 10.3: the verdict |',
    ],
  });

  assert.throws(
    () => verifySpec(dir),
    /the amendments table names 0022 for 10, 8, 11, and that record is not there/,
  );
});

test('an amendment naming a sub-section verifies the record it names', (t) => {
  // Six rows of the real table name `11.7` alone, and a dotted cell never matched the parse either.
  const dir = specRepository(t, {
    amendments: [
      '| 11.7 | [`0028`](../../rfcs/0028-the-commit-names-the-pin/rfc.md) | 11.7: the pin commits |',
    ],
    records: { '0028-the-commit-names-the-pin/rfc.md': amendmentRecord('0028', 'draft') },
  });

  assert.throws(
    () => verifySpec(dir),
    /the amendments table names 0028 for 11\.7, which is still a draft/,
  );
});

test('an amendment naming a record that is not there fails, and the message names the row', (t) => {
  const dir = specRepository(t, {
    amendments: ['| 10 | [`0002`](../../rfcs/0002-human-output-v2/rfc.md) | 10: the report |'],
  });

  assert.throws(
    () => verifySpec(dir),
    /the amendments table names 0002 for 10, and that record is not there/,
  );
});

test('an amendment naming a draft record fails, and the message names the row', (t) => {
  const dir = specRepository(t, {
    amendments: ['| 10 | [`0002`](../../rfcs/0002-human-output-v2/rfc.md) | 10: the report |'],
    records: { '0002-human-output-v2/rfc.md': amendmentRecord('0002', 'draft') },
  });

  assert.throws(
    () => verifySpec(dir),
    /the amendments table names 0002 for 10, which is still a draft/,
  );
});

test('a list and a sub-section both leave their named sections out of the verbatim comparison', (t) => {
  // A page an amendment names is the authority for its own text, whatever shape its section cell
  // has: neither a list nor a dotted number may leave the page compared with the frozen record.
  const dir = specRepository(t, {
    amendments: [
      '| 10, 8, 11 | [`0022`](../../rfcs/0022-the-output-tells-the-truth/rfc.md) | 10.3: the verdict |',
      '| 11.7 | [`0028`](../../rfcs/0028-the-commit-names-the-pin/rfc.md) | 11.7: the pin commits |',
    ],
    pages: {
      'rules.md': '# rules\n\n## 8. Rule catalog\n\nrewritten by 0022.\n',
      'report.md': '# report\n\n## 10. Report contract\n\nrewritten by 0022.\n',
      'commands.md': '# commands\n\n## 11. Command contracts\n\nrewritten by 0028.\n',
    },
    records: {
      '0022-the-output-tells-the-truth/rfc.md': amendmentRecord('0022', 'accepted'),
      '0028-the-commit-names-the-pin/rfc.md': amendmentRecord('0028', 'accepted'),
    },
  });

  assert.doesNotThrow(() => verifySpec(dir));
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
