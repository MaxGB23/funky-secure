/**
 * Marker-based managed block (RFC 11.2).
 *
 * The block is line-based on purpose: no YAML parser, no `.npmrc`, and one unit of edit and review.
 * The two rules it enforces are the ones the RFC names: idempotent by marker, and never a second
 * source for a setting that already exists outside the block.
 */

export const BEGIN = '# funky-secure:begin (managed block — do not edit by hand)';
export const END = '# funky-secure:end';

/**
 * @param {string} text
 * @returns {string}
 */
function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
  if (text === '') return [];
  const lines = text.split(/\r\n|\n|\r/);
  if (text.endsWith('\n') || text.endsWith('\r')) lines.pop();
  return lines;
}

/**
 * @param {unknown} body
 * @returns {string[]}
 */
function bodyLinesOf(body) {
  const lines = String(body ?? '').split(/\r\n|\n|\r/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Splits a top-level `key: value` line. An indented line, a comment and a line without a top-level
 * colon declare nothing, and a quoted key is unquoted.
 * @param {string} line
 * @returns {{ key: string, value: string } | null}
 */
function declarationOf(line) {
  if (line === '' || /^[ \t]/.test(line)) return null;
  const trimmed = line.trimEnd();
  if (trimmed.startsWith('#')) return null;
  let index = trimmed.indexOf(':');
  while (index !== -1) {
    const after = trimmed[index + 1];
    if (after === undefined || after === ' ' || after === '\t') break;
    index = trimmed.indexOf(':', index + 1);
  }
  if (index === -1) return null;
  let key = trimmed.slice(0, index).trim();
  if (key === '') return null;
  if ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith('"') && key.endsWith('"'))) {
    key = key.slice(1, -1);
  }
  return { key, value: trimmed.slice(index + 1).trim() };
}

/**
 * @param {string} line
 * @returns {string | null}
 */
function topLevelKeyOf(line) {
  return declarationOf(line)?.key ?? null;
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {boolean}
 */
function sameLines(left, right) {
  if (left.length !== right.length) return false;
  return left.every((line, index) => line === right[index]);
}

/**
 * @param {{ present: boolean, malformed?: boolean, body?: string, startLine?: number, endLine?: number }} result
 */
function absent() {
  return { present: false };
}

/**
 * @param {string} text
 * @returns {{ present: true, body: string, startLine: number, endLine: number } | { present: false, malformed?: true }}
 */
export function readBlock(text) {
  const source = typeof text === 'string' ? text : '';
  const eol = eolOf(source);
  const lines = splitLines(source);
  const start = lines.findIndex((line) => line.trimEnd() === BEGIN);
  if (start === -1) return absent();
  const end = lines.findIndex((line, index) => index > start && line.trimEnd() === END);
  if (end === -1) return { present: false, malformed: true };
  return {
    present: true,
    body: lines.slice(start + 1, end).join(eol),
    startLine: start + 1,
    endLine: end + 1,
  };
}

/**
 * The declarations the managed block carries, keyed by top-level name and valued by the raw text after
 * the colon — `savePrefix: ''` is the value `"''"`, so a caller can tell an empty string from an absent
 * key. A file without a block declares nothing, and a begin marker without an end marker is reported
 * as malformed instead of being read as declarations.
 * @param {string} text
 * @returns {{ present: boolean, malformed: boolean, values: Record<string, string> }}
 */
export function blockValues(text) {
  const block = readBlock(text);
  /** @type {Record<string, string>} */
  const values = {};
  if (block.present !== true) {
    return { present: false, malformed: block.malformed === true, values };
  }
  for (const line of block.body.split(/\r\n|\n|\r/)) {
    const declaration = declarationOf(line);
    if (declaration === null) continue;
    values[declaration.key] = declaration.value;
  }
  return { present: true, malformed: false, values };
}

/**
 * Writes or replaces the managed block.
 * @param {string} text
 * @param {string} body
 * @param {{ keys?: string[] }} [options]
 * @returns {{ ok: true, text: string, changed: boolean }
 *   | { ok: false, reason: 'duplicate-key', key: string }
 *   | { ok: false, reason: 'malformed-block', key: null }}
 */
export function upsertBlock(text, body, { keys = [] } = {}) {
  const source = typeof text === 'string' ? text : '';
  const eol = eolOf(source);
  const lines = splitLines(source);
  const bodyLines = bodyLinesOf(body);

  const start = lines.findIndex((line) => line.trimEnd() === BEGIN);
  const end = lines.findIndex((line) => line.trimEnd() === END);
  if (start === -1 && end !== -1) return { ok: false, reason: 'malformed-block', key: null };
  if (start !== -1 && (end === -1 || end < start)) return { ok: false, reason: 'malformed-block', key: null };

  const outside = start === -1 ? lines : [...lines.slice(0, start), ...lines.slice(end + 1)];
  for (const key of keys) {
    if (outside.some((line) => topLevelKeyOf(line) === key)) {
      return { ok: false, reason: 'duplicate-key', key };
    }
  }

  const trailingEol = source.endsWith('\n') || source.endsWith('\r');

  if (start !== -1) {
    const current = lines.slice(start + 1, end);
    if (sameLines(current, bodyLines)) return { ok: true, text: source, changed: false };
    const next = [...lines.slice(0, start + 1), ...bodyLines, ...lines.slice(end)];
    return { ok: true, text: next.join(eol) + (trailingEol ? eol : ''), changed: true };
  }

  const next = [...lines];
  while (next.length > 0 && next[next.length - 1].trim() === '') next.pop();
  if (next.length > 0) next.push('');
  const block = [BEGIN, ...bodyLines, END];
  return { ok: true, text: [...next, ...block].join(eol) + eol, changed: true };
}
