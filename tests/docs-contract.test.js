/**
 * The documentation contract (RFC 0024, I-55).
 *
 * The suite passes because the code is correct; nothing in it compared the documents with the code,
 * so a release could change a printed step and leave five pages describing the previous one. Each
 * test below is one fact the code owns and a document restates, read from the real sources — `COMMANDS`,
 * `FLAGS`, the catalog, `package.json` — so a failure names the page that drifted instead of a line in
 * a rule module.
 *
 * Everything here is deterministic, reads files and writes none, and never spawns a process.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMANDS, FLAGS, renderHelp } from '../src/cli.js';
import { catalog } from '../src/rules/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string[]} segments
 * @returns {string} the file's text
 */
function read(...segments) {
  return readFileSync(join(ROOT, ...segments), 'utf8');
}

/**
 * Every markdown page under a directory, recursively.
 * @param {string} directory
 * @returns {string[]} absolute paths
 */
function markdownUnder(directory) {
  const found = [];

  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...markdownUnder(path));
    else if (name.endsWith('.md')) found.push(path);
  }

  return found;
}

/**
 * The documents this contract covers: the normative spec and the pages a user reads, plus the two
 * root pages and the shipped skill — every page a claim about the command surface can live in.
 * @returns {string[]} absolute paths
 */
function shippedDocuments() {
  return [
    ...markdownUnder(join(ROOT, 'docs')),
    ...markdownUnder(join(ROOT, 'skills')),
    join(ROOT, 'README.md'),
    join(ROOT, 'CONTRIBUTING.md'),
    join(ROOT, 'AGENTS.md'),
  ];
}

/**
 * Splits prose into sentence-sized pieces. Lines are boundaries too, so a table row is one piece and a
 * wrapped paragraph is read one line at a time: a check that is slightly too strict is cheaper to fix
 * than one that misses a sentence because two lines happened to be in the way.
 * @param {string} text
 * @returns {string[]}
 */
function pieces(text) {
  return text.split(/(?<=[.!?])\s+|\n/).filter((piece) => piece !== '');
}

/**
 * The rows of the `## Flags` table of `docs/cli.md`, as flag name -> the commands its "Accepted by"
 * cell names. The table is parsed instead of grepped on purpose: a flag named somewhere in the prose
 * is not a documented applicability, and the cell is the only place that states which commands accept
 * it.
 * @param {string} text
 * @returns {Map<string, string[]>}
 */
function flagTable(text) {
  const start = text.search(/^## Flags$/m);
  assert.notEqual(start, -1, 'docs/cli.md has no "## Flags" section');
  const after = text.slice(start + 1);
  const next = after.search(/^## /m);
  const section = next === -1 ? after : after.slice(0, next);

  const rows = new Map();
  for (const line of section.split('\n')) {
    const row = /^\| `(--[a-z-]+)` \| ([^|]+) \|/.exec(line);
    if (row === null) continue;
    const cell = row[2];
    const accepted = cell.includes('every command')
      ? COMMANDS.map((command) => command.name)
      : [...cell.matchAll(/`([a-z][a-z-]*)`/g)].map((match) => match[1]);
    rows.set(row[1], accepted);
  }

  return rows;
}

/// The command surface (RFC 11, 13.1). A command the parser dispatches but no page documents is a
/// command a reader cannot find.

test('every command the CLI dispatches has a section in docs/cli.md', () => {
  const text = read('docs', 'cli.md');

  for (const command of COMMANDS) {
    assert.match(
      text,
      new RegExp(`^### \`${command.name}\`$`, 'm'),
      `docs/cli.md has no "### \`${command.name}\`" section for the ${command.name} command`,
    );
  }
});

/// Flag applicability (RFC 11): the closed list is the contract, and the table is where a reader
/// learns that `start --preset` is a usage error rather than a silently ignored argument.

test('the docs/cli.md flag table states every command each flag accepts', () => {
  const table = flagTable(read('docs', 'cli.md'));

  for (const flag of FLAGS) {
    const accepted = table.get(flag.name);
    assert.ok(accepted !== undefined, `docs/cli.md has no table row for ${flag.name}`);

    for (const command of flag.commands) {
      assert.ok(
        accepted.includes(command),
        `docs/cli.md says ${flag.name} is not accepted by ${command}, and the CLI accepts it there`,
      );
    }

    // The other direction too: a row that claims a command the parser rejects costs the reader a run.
    for (const command of accepted) {
      assert.ok(
        flag.commands.includes(command),
        `docs/cli.md says ${flag.name} is accepted by ${command}, and the CLI rejects it there`,
      );
    }
  }
});

/// The README is the page a reader meets first, so its command list is the list of what exists.

test('the README command list names every command the CLI dispatches', () => {
  const text = read('README.md');
  const start = text.search(/^## .*The commands$/m);
  assert.notEqual(start, -1, 'README.md has no "## 🚦 The commands" section');
  const after = text.slice(start + 1);
  const next = after.search(/^## /m);
  const section = next === -1 ? after : after.slice(0, next);

  const listed = new Set(
    [...section.matchAll(/^\| `([a-z][a-z-]*)` \|/gm)].map((match) => match[1]),
  );
  assert.ok(listed.size > 0, 'the README command table lists no command');

  for (const command of COMMANDS) {
    assert.ok(
      listed.has(command.name),
      `the README command table has no row for the ${command.name} command`,
    );
  }
});

/// The four exit codes (RFC 10.4, 0008). This is the one class in the audit that was not stale but
/// wrong: a refusal is `3`, and a page that says `2` tells an integration to retry a decision.

test('the help names all four exit codes, and no summary understates a command that can refuse', () => {
  // The summary is the first line a reader sees. A command that can refuse must not announce a
  // three-code surface; `scan` only reads and never refuses, so 0/1/2 is the truth for it (0024). The
  // four codes are named once, in the block every command shares.
  const help = renderHelp({ catalog: [] });
  for (const code of ['0', '1', '2']) {
    assert.match(help, new RegExp(`[·:] ${code} `), `the help never names exit ${code}`);
  }
  assert.match(help, /exit code 3 means/, 'the fourth code is named');

  const writers = new Set(['init', 'pin', 'migrate', 'skill']);
  for (const command of COMMANDS) {
    if (!writers.has(command.name)) continue;
    assert.doesNotMatch(
      command.summary,
      /exits? 0, 1 or 2/i,
      `the ${command.name} summary claims no fourth exit code, but it can refuse`,
    );
  }
});

test('the three pages that explain the contract say a refusal is exit 3', () => {
  for (const page of [['docs', 'cli.md'], ['README.md'], ['docs', 'guide.md']]) {
    const text = read(...page);
    const says = pieces(text).some(
      (piece) => /refus/i.test(piece) && /(^|[^\d])3(?=[^\d]|$)/.test(piece),
    );
    assert.ok(says, `${page.join('/')} never says that a refusal is exit 3`);
  }
});

test('no document says a refusal is exit 2', () => {
  // The predicate is word-scoped on purpose. A sentence that names the exit code and the word
  // "refusal" is making one claim about the two, and the claim is what the code contradicts. The
  // true sentences this must not fail on are shaped differently — "a refusal is not a `2`", or
  // "`2` ... never used for a refusal" — so they never pair "exit 2" with the word in one sentence.
  const claim = /exit(?:s|ed)?[ `]*2(?![0-9])/;

  for (const path of shippedDocuments()) {
    const relative = path.slice(ROOT.length).replace(/\\/g, '/');

    for (const piece of pieces(readFileSync(path, 'utf8'))) {
      if (!/refusal/i.test(piece) || !claim.test(piece)) continue;
      assert.fail(`${relative} says a refusal exits 2: ${piece.trim()}`);
    }
  }
});

/// The version strings (RFC 17.5). An install line with the wrong version is the first thing a new
/// user copies, and `docs/spec/report.md` was still showing a report from 0.4.0.

test('the published version appears where a reader copies it, and nowhere older', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+$/, 'package.json carries no semver version');

  for (const page of [['README.md'], ['docs', 'guide.md']]) {
    assert.ok(
      read(...page).includes(`funky-secure@${version}`),
      `${page.join('/')} carries no "funky-secure@${version}" install line`,
    );
  }

  // Two shapes are claims about this package: the install line (`funky-secure@1.2.3`) and the tool
  // block of a JSON document (`"version": "1.2.3"`). A page that narrates an older installed copy,
  // as the `skill --install` captures do, is not a claim about the shipped version.
  for (const path of shippedDocuments()) {
    const relative = path.slice(ROOT.length).replace(/\\/g, '/');
    const text = readFileSync(path, 'utf8');

    for (const match of text.matchAll(/funky-secure@(\d+\.\d+\.\d+)/g)) {
      assert.equal(match[1], version, `${relative} installs funky-secure@${match[1]}, not @${version}`);
    }
    for (const match of text.matchAll(/"version":\s*"(\d+\.\d+\.\d+)"/g)) {
      assert.equal(match[1], version, `${relative} shows a tool version of ${match[1]}, not ${version}`);
    }
  }
});

/// The catalogue (RFC 8.2, 0024). Three rules entered it without a section, and nothing compared the
/// two counts, so the spec went on saying nine while twelve ran.

test('the rule catalogue states a number of rules that matches the code, one section each', () => {
  const text = read('docs', 'spec', 'rules.md');
  const WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  };

  const numbered = [...text.matchAll(/^#### R(\d+) — `([^`]+)`/gm)];
  assert.equal(
    numbered.length,
    catalog.length,
    `docs/spec/rules.md has ${numbered.length} "#### R" sections and the catalog has ${catalog.length} rules`,
  );

  // Numbering is append-only (0024): R5 means the fifth catalog rule in every citation in the
  // repository, so section n must document catalog[n - 1].
  numbered.forEach((match, index) => {
    assert.equal(Number(match[1]), index + 1, `docs/spec/rules.md numbers a section R${match[1]} at position ${index + 1}`);
    assert.equal(
      match[2],
      catalog[index].id,
      `docs/spec/rules.md calls R${match[1]} "${match[2]}" and the catalog has "${catalog[index].id}" there`,
    );
  });

  const stated = text.match(/^### 8\.2 The (\w+) rules$/m);
  assert.ok(stated, 'docs/spec/rules.md no longer states how many rules section 8.2 covers');
  const count = WORDS[stated[1].toLowerCase()];
  assert.equal(
    count,
    catalog.length,
    `docs/spec/rules.md says ${stated[1]} rules and the catalog has ${catalog.length}`,
  );

  for (const rule of catalog) {
    assert.ok(
      existsSync(join(ROOT, 'docs', 'rules', `${rule.id}.md`)),
      `docs/rules/${rule.id}.md is missing for the ${rule.id} rule`,
    );
  }
});

/// The path map (AGENTS.md). A map that names a page nobody has is worse than no map: it is the first
/// thing a new contributor opens.

test('every path in the AGENTS.md path map exists', () => {
  const text = read('AGENTS.md');
  const start = text.search(/^## Paths$/m);
  assert.notEqual(start, -1, 'AGENTS.md has no "## Paths" section');
  const after = text.slice(start + 1);
  const next = after.search(/^## /m);
  const section = next === -1 ? after : after.slice(0, next);

  const paths = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
  assert.ok(paths.length > 0, 'the AGENTS.md path map lists no path');

  for (const listed of paths) {
    // A row may name a family of files — `docs/rules/<id>.md`, `odd/tasks/<feature>.md` — and a
    // placeholder is not a path. The literal prefix up to the first placeholder segment is what the
    // entry promises exists, so that is what is checked.
    const segments = listed.split('/');
    const firstPlaceholder = segments.findIndex((segment) => segment.includes('<'));
    const literal = (firstPlaceholder === -1 ? segments : segments.slice(0, firstPlaceholder))
      .filter((segment) => segment !== '')
      .join('/');

    assert.notEqual(literal, '', `the AGENTS.md path map entry \`${listed}\` names nothing literal`);
    assert.ok(
      existsSync(join(ROOT, literal)),
      `the AGENTS.md path map names \`${listed}\`, and ${literal} does not exist`,
    );
  }
});
