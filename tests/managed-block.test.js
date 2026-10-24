import test from 'node:test';
import assert from 'node:assert/strict';

import { BEGIN, END, readBlock, upsertBlock } from '../src/lib/managed-block.js';

const BODY = 'minimumReleaseAgeStrict: true';

test('exports the marker lines of the RFC managed block', () => {
  assert.equal(BEGIN, '# funky-secure:begin (managed block — do not edit by hand)');
  assert.equal(END, '# funky-secure:end');
});

test('appends the block to an empty file with a trailing newline', () => {
  const result = upsertBlock('', BODY, { keys: ['minimumReleaseAgeStrict'] });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.text, `${BEGIN}\n${BODY}\n${END}\n`);
});

test('appends the block after one blank separator line', () => {
  const result = upsertBlock('node_modules/\n', BODY, { keys: ['minimumReleaseAgeStrict'] });
  assert.equal(result.ok, true);
  assert.equal(result.text, `node_modules/\n\n${BEGIN}\n${BODY}\n${END}\n`);
});

test('appends the block to text without a trailing newline', () => {
  const result = upsertBlock('node_modules/', BODY, { keys: ['minimumReleaseAgeStrict'] });
  assert.equal(result.ok, true);
  assert.equal(result.text, `node_modules/\n\n${BEGIN}\n${BODY}\n${END}\n`);
});

test('replaces only the lines between the markers when the block is present', () => {
  const text = ['packages:', "  - 'packages/*'", '', BEGIN, 'minimumReleaseAgeStrict: false', END, ''].join('\n');
  const result = upsertBlock(text, `${BODY}\nminimumReleaseAge: 4320`, { keys: ['minimumReleaseAgeStrict'] });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(
    result.text,
    ['packages:', "  - 'packages/*'", '', BEGIN, BODY, 'minimumReleaseAge: 4320', END, ''].join('\n'),
  );
  assert.deepEqual(readBlock(result.text), {
    present: true,
    body: `${BODY}\nminimumReleaseAge: 4320`,
    startLine: 4,
    endLine: 7,
  });
});

test('reports changed false for an identical body and returns the text untouched', () => {
  const text = ['minimumReleaseAge: 1440', '', BEGIN, BODY, END, ''].join('\n');
  const result = upsertBlock(text, BODY, { keys: ['minimumReleaseAgeStrict'] });
  assert.deepEqual(result, { ok: true, text, changed: false });
});

test('refuses to write a key that already exists outside the block', () => {
  const text = ['minimumReleaseAgeStrict: true', ''].join('\n');
  const result = upsertBlock(text, BODY, { keys: ['minimumReleaseAgeStrict'] });
  assert.deepEqual(result, {
    ok: false,
    reason: 'duplicate-key',
    key: 'minimumReleaseAgeStrict',
  });
});

test('does not count a nested key as a top-level one', () => {
  const text = ['settings:', '  minimumReleaseAgeStrict: true', ''].join('\n');
  const result = upsertBlock(text, BODY, { keys: ['minimumReleaseAgeStrict'] });
  assert.equal(result.ok, true);
  assert.equal(result.text, `${text}\n${BEGIN}\n${BODY}\n${END}\n`);
});

test('refuses a begin marker without an end marker', () => {
  const text = ['node_modules/', '', BEGIN, BODY, ''].join('\n');
  const result = upsertBlock(text, BODY, { keys: [] });
  assert.deepEqual(result, { ok: false, reason: 'malformed-block', key: null });
  assert.deepEqual(readBlock(text), { present: false, malformed: true });
});

test('preserves CRLF line endings and the trailing newline', () => {
  const text = 'node_modules/\r\n';
  const result = upsertBlock(text, `${BODY}\r\nminimumReleaseAge: 4320`, { keys: ['minimumReleaseAgeStrict'] });
  assert.equal(result.ok, true);
  assert.equal(
    result.text,
    `node_modules/\r\n\r\n${BEGIN}\r\n${BODY}\r\nminimumReleaseAge: 4320\r\n${END}\r\n`,
  );
});

test('reads an absent block as absent', () => {
  assert.deepEqual(readBlock('node_modules/\n'), { present: false });
});
