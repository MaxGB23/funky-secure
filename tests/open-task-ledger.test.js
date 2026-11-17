import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LEDGER = new URL('../odd/tasks/open-task-ledger.md', import.meta.url);

/**
 * The task table of the ledger, as rows of cells.
 *
 * The rule this file enforces is `open-task-ledger.md`'s `S5`: **a row with `status: open` names the issue it
 * belongs to**. It reads the table and nothing else — the prose above it quotes the ledger's own markers, and a
 * check that policed prose would fail on its own specification.
 *
 * It was narrowed to this one document on measured grounds: over `odd/tasks/*.md` the same predicate had one
 * true positive among eleven matches, could not tell an issue from a pull request (`#296` is a PR), and could not
 * see an open row whose issue had been closed — the `T11` shape. The record documents are append-only and are
 * corrected by `## Errata`, so they are not policed here; `docs/testing.md` and the other records say so in their
 * own words.
 */
function taskRows(markdown) {
  const rows = [];
  let inTable = false;
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    // The header and its separator start the table; a row is what follows.
    if (cells[0] === 'id' || /^-+$/.test(cells[0] ?? '')) {
      inTable = true;
      continue;
    }
    if (!inTable || cells.length < 5) continue;
    rows.push({ id: cells[0], status: cells[3], issue: cells[4] });
  }
  return rows;
}

test('every open row of the ledger names the issue it belongs to (S5)', () => {
  const markdown = readFileSync(LEDGER, 'utf8');
  const rows = taskRows(markdown);

  assert.ok(rows.length >= 4, `the ledger's task table is readable, ${rows.length} rows found`);

  const open = rows.filter((row) => row.status === 'open');
  assert.ok(open.length > 0, 'the ledger has at least one open row, so this test is not vacuous');

  const orphans = open.filter((row) => !/#\d+/.test(row.issue));
  assert.deepEqual(
    orphans.map((row) => `${row.id} (issue: ${row.issue})`),
    [],
    'an open task with no issue is the leak this ledger exists to close',
  );
});

test('a landed row is not required to name an issue, and the column is still read (S5)', () => {
  const rows = taskRows(readFileSync(LEDGER, 'utf8'));
  const landed = rows.filter((row) => row.status === 'landed');
  assert.ok(landed.length > 0, 'the ledger records at least one landed row');
  assert.equal(
    landed.every((row) => typeof row.issue === 'string'),
    true,
    'the issue column is always present, whatever the row says',
  );
});
