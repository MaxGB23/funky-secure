/**
 * The pasted coverage blocks against the renderer (10.3).
 *
 * What this catches, and only this: a capture that was **hand-edited, or never updated when the renderer
 * moved**. It cannot see a renderer that lies about its own meaning, and it cannot see a paragraph that
 * contradicts the capture beneath it — both are on the record in `docs/validation.md`, and both shipped
 * green while every page equalled the renderer of the day. A gate is worth the failure it can name.
 *
 * The files are listed, never globbed:
 * - `docs/spec/report.md` is **excluded on purpose**. The repository's ritual is spec-first (AGENTS.md,
 *   docs/README.md:13), so a legitimate spec pull request carries a capture that is ahead of the renderer
 *   until the code follows — commit 5249d84 did exactly that. A gate that demanded equality would make
 *   that pull request red by construction, and open-pr refuses a red suite.
 * - `docs/validation.md` and `rfcs/**` are excluded as historical evidence: their bytes are different on
 *   purpose, and normalising them would erase what makes them proof.
 *
 * The comparison is of **line arrays**, never of rejoined text: a block wrapped at the wrong column, or
 * hard-wrapped inside a label, passes a rejoin.
 *
 * The expected bytes are asked for `preset: 'starter'` and no `overridden`, because every page in this
 * list pastes a starter block — `start`'s own, or a `scan --preset starter`'s. That is **narrower** than
 * the renderer: a page that one day pastes a config-caused or mixed block cannot satisfy this gate until
 * it is given the cause, and the plan that promised three shapes shipped one. Narrower is the safe
 * direction — the gate can only ever bless the shape it was taught — but it is a limit, not a feature.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalog } from '../src/rules/index.js';
import { notRunLines } from '../src/lib/render-human.js';

const FILES = [
  'docs/cli.md',
  'docs/guide.md',
  'docs/learn/02-your-first-command.md',
  'docs/learn/commands/start.md',
];

const GUTTER = '         ';
const PREFIX = 'off by policy: ';

/** The fenced blocks of a page, fence markers dropped. */
function fencedBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      if (current) blocks.push(current);
      current = current === null ? [] : null;
      continue;
    }
    if (current) current.push(line);
  }
  return blocks;
}

/** The `not run` lines of a block: the head, then the gutter lines that continue it. */
function coverageLines(block) {
  const start = block.findIndex((line) => line.startsWith('not run'));
  if (start === -1) return null;
  const lines = [block[start]];
  for (let index = start + 1; index < block.length; index += 1) {
    if (!block[index].startsWith(GUTTER)) break;
    lines.push(block[index]);
  }
  return lines;
}

/**
 * The rule ids a block names. The label list has no terminator — the continuation follows the last label
 * on the same wrapped line, and the renderer does not export it — so labels are matched longest-first
 * against the catalog, consuming `, ` between them.
 */
function namedIds(lines) {
  const joined = lines.map((line, index) => (index === 0 ? line : line.slice(GUTTER.length))).join(' ');
  const body = joined.slice(joined.indexOf(PREFIX) + PREFIX.length);
  const labels = catalog
    .map((rule) => ({ id: rule.id, label: rule.label ?? rule.id }))
    .sort((left, right) => right.label.length - left.label.length);

  const ids = [];
  let rest = body;
  for (;;) {
    const hit = labels.find((entry) => rest.startsWith(entry.label));
    if (!hit) break;
    ids.push(hit.id);
    rest = rest.slice(hit.label.length);
    if (!rest.startsWith(', ')) break;
    rest = rest.slice(2);
  }
  assert.ok(
    !rest.startsWith(', '),
    `the block names a rule this catalog does not carry, or the list is cut short; left over: ${JSON.stringify(rest.slice(0, 80))}`,
  );
  // 10.3 requires the continuation whenever the block prints, so a block whose names consume the whole body
  // is missing it. Without this, that block would fail on the line count with no word about the cause.
  assert.ok(rest.trim().length > 0, `the block names its rules and then stops: no continuation follows`);
  return ids;
}

test('every pasted coverage block is the bytes the renderer emits', () => {
  const found = [];
  for (const file of FILES) {
    const blocks = fencedBlocks(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
      .map(coverageLines)
      .filter((lines) => lines !== null);
    assert.ok(blocks.length >= 1, `${file} carries no pasted coverage block; the search looks for a fenced block with a line starting "not run"`);
    for (const lines of blocks) found.push({ file, lines });
  }

  // A gate that compares nothing is green forever. The count is asserted, not assumed: a moved page or a
  // fence-detection change would otherwise turn this test into decoration.
  assert.ok(found.length >= 7, `expected at least 7 pasted coverage blocks across ${FILES.length} pages, found ${found.length}`);

  for (const { file, lines } of found) {
    const expected = notRunLines({ off: namedIds(lines), catalog, preset: 'starter' });
    assert.deepEqual(lines, expected, `${file}: the pasted block is not what the renderer emits for the rules it names`);
  }
});
