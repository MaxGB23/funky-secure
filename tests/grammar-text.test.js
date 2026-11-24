import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The version grammar as three records typed it: `@+-*` puts the hyphen between `+` and `*`, where it
 * reads as a range and the class does not compile. The implemented class is `@+*-`. A reader who
 * implements the record gets an exception, so the record is checked against the code rather than
 * proofread (the `J2` audit of #557 found it in four places, three of them present tense).
 */
const NON_COMPILING = /@\+-\*/;

/** Every Markdown page under a directory, at any depth. */
function pages(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...pages(path));
    else if (entry.endsWith('.md')) found.push(path);
  }
  return found;
}

test('no present-tense page states the version grammar in an order that does not compile', () => {
  for (const page of pages(join(ROOT, 'docs'))) {
    if (page.endsWith('decisions.md')) continue; // the decision log is checked, line by line, below
    const text = readFileSync(page, 'utf8');
    assert.equal(
      NON_COMPILING.test(text),
      false,
      `${page} states the class with the hyphen between + and *, which is a range out of order`,
    );
  }
});

test('the decision log keeps the typo only where it is frozen, and states the class beside it', () => {
  const log = readFileSync(join(ROOT, 'docs/decisions.md'), 'utf8').split('\n');
  // The log is append-only: I-97 typed the class out of order and cannot be rewritten, so the only legal
  // place for those bytes is that frozen row. Any other row carrying them is a new row with the old
  // error, and the row that corrects it has to state the implemented class.
  for (const line of log) {
    if (!NON_COMPILING.test(line)) continue;
    assert.ok(line.startsWith('| I-97 |'), 'a row other than the frozen I-97 states the class out of order');
  }
  assert.ok(
    log.some((line) => line.startsWith('| I-98 |') && line.includes('does not compile')),
    'no row names the frozen typo as the ecision that supersedes it',
  );
});

test('the pages state the class the rule actually enforces', () => {
  const source = readFileSync(join(ROOT, 'src/rules/exact-versions.js'), 'utf8');
  const declared = source.match(/const SAFE_VERSION = \/\^(.+?)\$\/;/);
  assert.ok(declared, 'the rule no longer declares SAFE_VERSION where this test looks for it');

  for (const page of ['docs/spec/rules.md', 'docs/rules/exact-versions.md']) {
    assert.ok(
      readFileSync(join(ROOT, page), 'utf8').includes(`^${declared[1]}$`),
      `${page} does not state the implemented class ^${declared[1]}$`,
    );
  }

  // The record is append-only, so its own bytes keep the typo and the correction is appended beside it:
  // a page that carried the class is corrected by naming it, not by rewriting the sentence.
  const record = readFileSync(join(ROOT, 'rfcs/0042-the-command-speaks-both-shells/rfc.md'), 'utf8');
  assert.ok(
    record.includes('does not compile'),
    'the record that typed the class has no appended correction',
  );
});
