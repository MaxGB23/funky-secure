/**
 * Bounded pnpm-lock reader (RFC 8.2 R5, 4.7).
 *
 * A hand-written indent reader, not a YAML parser: it understands only `lockfileVersion`,
 * `importers.<path>.specifiers.<name>` and
 * `importers.<path>.{dependencies,devDependencies,optionalDependencies,peerDependencies}.<name>`,
 * in the `{ specifier, version }` block form or the inline `name: specifier` form. Everything it
 * cannot attribute returns `supported: false` with a reason, never a guessed result — the rules then
 * report `skip: unsupported-lockfile-shape`.
 *
 * Decisions the RFC leaves open, resolved conservatively here:
 * - `catalogs`, `overrides` and `patchedDependencies` change what a specifier resolves to, so their
 *   presence makes the importer comparison unsound: unsupported.
 * - `packages`, `snapshots`, `settings` and `time` never change the importer specifier/version
 *   relation, so they are read structurally and discarded (the RFC asks for `skip` only on a
 *   `snapshots` layout the reader does not recognize, which here means a non-map section).
 * - A concatenated lockfile is read document by document; a later document's importer path replaces
 *   an earlier one. This repository's own lockfile is a two-document stream.
 * - The inline dependency form carries no resolved version, so `version` is `null` for it.
 */

export const SUPPORTED_LOCKFILE_VERSIONS = ['9.0'];

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
/** Top-level sections whose presence never changes an importer specifier or version. */
const IGNORED_SECTIONS = ['packages', 'settings', 'snapshots', 'time'];
/** Top-level sections that would change what a specifier resolves to, so the comparison is unsound. */
const REFUSED_SECTIONS = ['catalogs', 'overrides', 'patchedDependencies'];

class LockfileShapeError extends Error {}

/** @param {string} detail */
function fail(detail) {
  throw new LockfileShapeError(detail);
}

/**
 * @typedef {{ no: number, indent: number, text: string }} LockfileLine
 * @typedef {{ key: string, value: string, line: number, start: number, end: number }} LockfileEntry
 */

/**
 * @param {string} text
 * @returns {LockfileLine[]}
 */
function scan(text) {
  const lines = [];
  const raw = text.split(/\r\n|\n|\r/);
  for (let index = 0; index < raw.length; index += 1) {
    const no = index + 1;
    const source = raw[index];
    const lead = /^[ \t]*/.exec(source)[0];
    if (lead.includes('\t')) fail(`tab indentation at line ${no}`);
    const body = stripComment(source.slice(lead.length)).trimEnd();
    if (body === '') continue;
    if (body === '---' || body === '...') {
      lines.push({ no, indent: 0, text: body, marker: body });
      continue;
    }
    lines.push({ no, indent: lead.length, text: body, marker: null });
  }
  return lines;
}

/**
 * Strips a trailing `# comment`, but only outside quotes and only when the `#` starts a word.
 * @param {string} text
 * @returns {string}
 */
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i).trimEnd();
  }
  return text;
}

/**
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
  const text = value.trim();
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  if (first === "'" && last === "'") return text.slice(1, -1).replaceAll("''", "'");
  if (first === '"' && last === '"') return text.slice(1, -1).replace(/\\(["\\])/g, '$1');
  return text;
}

/**
 * Splits `key: value` at the first colon that ends a key, or returns null when the line is not a map
 * entry. A colon inside a value (`link:../api`, `docker://image:tag`) never ends a key.
 * @param {string} text
 * @returns {{ key: string, value: string } | null}
 */
function splitKeyValue(text) {
  const source = text.trim();
  if (source === '' || source.startsWith('{') || source.startsWith('[') || source.startsWith('- ')) return null;
  if (source.startsWith("'") || source.startsWith('"')) {
    const quote = source[0];
    let i = 1;
    for (; i < source.length; i += 1) {
      if (quote === '"' && source[i] === '\\') {
        i += 1;
        continue;
      }
      if (source[i] !== quote) continue;
      if (quote === "'" && source[i + 1] === "'") {
        i += 1;
        continue;
      }
      break;
    }
    if (source[i] !== quote) return null;
    const rest = source.slice(i + 1);
    if (!rest.startsWith(':')) return null;
    return { key: unquote(source.slice(0, i + 1)), value: rest.slice(1).trim() };
  }
  let index = source.indexOf(':');
  while (index !== -1) {
    const after = source[index + 1];
    if (after === undefined || after === ' ' || after === '\t') break;
    index = source.indexOf(':', index + 1);
  }
  if (index === -1) return null;
  const key = source.slice(0, index).trim();
  if (key === '') return null;
  return { key, value: source.slice(index + 1).trim() };
}

/**
 * Entries of one map level, in document order. Every key must sit at the same indentation and every
 * deeper line belongs to the entry above it.
 * @param {LockfileLine[]} lines
 * @param {string} context
 * @returns {LockfileEntry[]}
 */
function mapEntries(lines, context) {
  /** @type {LockfileEntry[]} */
  const entries = [];
  let level = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (level === null) level = line.indent;
    if (line.indent !== level) fail(`inconsistent indentation at line ${line.no} in ${context}`);
    if (line.text === '-' || line.text.startsWith('- ')) {
      fail(`${context} entry at line ${line.no} is a sequence, not a map`);
    }
    const kv = splitKeyValue(line.text);
    if (!kv) fail(`expected "key: value" at line ${line.no}`);
    let end = i + 1;
    while (end < lines.length && lines[end].indent > level) end += 1;
    entries.push({ key: kv.key, value: kv.value, line: line.no, start: i, end });
    i = end;
  }
  return entries;
}

/**
 * Confirms that an ignored section is a map of entries, without modeling its content.
 * @param {LockfileLine[]} children
 * @param {string} section
 * @param {number} line
 */
function validateIgnoredSection(children, section, line) {
  if (children.length === 0) return;
  const first = children[0];
  if (first.text === '-' || first.text.startsWith('- ')) {
    fail(`top-level "${section}" section is not a map (line ${first.no})`);
  }
  for (const entry of mapEntries(children, `"${section}" at line ${line}`)) {
    validateIgnoredSection(children.slice(entry.start + 1, entry.end), section, entry.line);
  }
}

/**
 * @param {LockfileEntry} entry
 * @param {LockfileLine[]} children
 * @returns {Record<string, string>}
 */
function parseSpecifiers(entry, children) {
  const specifiers = {};
  if (entry.value === '{}') return specifiers;
  if (entry.value !== '') fail(`importer specifiers at line ${entry.line} is not a map`);
  if (children.length === 0) fail(`importer specifiers at line ${entry.line} is not a map`);
  for (const child of mapEntries(children, `specifiers at line ${entry.line}`)) {
    if (child.value === '' || child.value.startsWith('{') || child.value.startsWith('[')) {
      fail(`specifier for "${child.key}" at line ${child.line} is not a scalar`);
    }
    specifiers[child.key] = unquote(child.value);
  }
  return specifiers;
}

/**
 * @param {LockfileEntry} entry
 * @param {LockfileLine[]} children
 * @param {string} section
 * @returns {Record<string, { specifier: string, version: string | null }>}
 */
function parseDependencies(entry, children, section) {
  const dependencies = {};
  if (entry.value === '{}') return dependencies;
  if (entry.value !== '') fail(`"${section}" at line ${entry.line} is not a map`);
  if (children.length === 0) fail(`"${section}" at line ${entry.line} is not a map`);

  for (const child of mapEntries(children, `"${section}" at line ${entry.line}`)) {
    if (child.value === '') {
      const block = children.slice(child.start + 1, child.end);
      if (block.length === 0) fail(`dependency "${child.key}" at line ${child.line} is not a map`);
      const fields = mapEntries(block, `dependency "${child.key}" at line ${child.line}`);
      const specifier = fields.find((field) => field.key === 'specifier');
      const version = fields.find((field) => field.key === 'version');
      if (!specifier) fail(`dependency "${child.key}" at line ${child.line} has no specifier`);
      if (specifier.value === '' || specifier.value.startsWith('{') || specifier.value.startsWith('[')) {
        fail(`specifier for "${child.key}" at line ${specifier.line} is not a scalar`);
      }
      dependencies[child.key] = {
        specifier: unquote(specifier.value),
        version: version ? unquote(version.value) : null,
      };
      continue;
    }
    if (child.value.startsWith('{') || child.value.startsWith('[')) {
      fail(`dependency "${child.key}" at line ${child.line} is not a scalar or a map`);
    }
    dependencies[child.key] = { specifier: unquote(child.value), version: null };
  }
  return dependencies;
}

/**
 * @param {LockfileEntry} entry
 * @param {LockfileLine[]} children
 * @returns {Record<string, object>}
 */
function parseImporter(entry, children) {
  const importer = {
    specifiers: {},
    dependencies: {},
    devDependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
  };
  if (entry.value === '{}') return importer;
  if (entry.value !== '') fail(`importer "${entry.key}" at line ${entry.line} is not a map`);
  if (children.length === 0) fail(`importer "${entry.key}" at line ${entry.line} is not a map`);

  for (const field of mapEntries(children, `importer "${entry.key}" at line ${entry.line}`)) {
    const fieldChildren = children.slice(field.start + 1, field.end);
    if (field.key === 'specifiers') importer.specifiers = parseSpecifiers(field, fieldChildren);
    else if (DEPENDENCY_SECTIONS.includes(field.key)) {
      importer[field.key] = parseDependencies(field, fieldChildren, field.key);
    }
  }
  return importer;
}

/**
 * @param {LockfileLine[]} lines
 * @returns {Record<string, object>}
 */
function parseImporters(lines) {
  /** @type {Record<string, object>} */
  const importers = {};
  for (const entry of mapEntries(lines, '"importers"')) {
    importers[entry.key] = parseImporter(entry, lines.slice(entry.start + 1, entry.end));
  }
  return importers;
}

/**
 * Reads one lockfile shape from a string.
 * @param {string} text
 * @returns {{ supported: true, version: string, importers: Record<string, object> }
 *   | { supported: false, reason: 'unsupported-lockfile-shape', detail: string }}
 */
export function parseLockfile(text) {
  try {
    if (typeof text !== 'string') fail('lockfile text is not a string');
    const lines = scan(text);

    let version = null;
    /** @type {Record<string, object>} */
    const importers = {};
    let document = [];
    let documentLine = 1;

    const applyDocument = () => {
      let i = 0;
      while (i < document.length) {
        const line = document[i];
        if (line.indent !== 0) fail(`unexpected indentation at line ${line.no}`);
        const kv = splitKeyValue(line.text);
        if (!kv) fail(`expected "key: value" at line ${line.no}`);
        let end = i + 1;
        while (end < document.length && document[end].indent > 0) end += 1;
        const entry = { key: kv.key, value: kv.value, line: line.no, start: i, end };

        if (entry.key === 'lockfileVersion') {
          if (entry.value === '') fail(`lockfileVersion at line ${entry.line} has no value`);
          const found = unquote(entry.value);
          if (!SUPPORTED_LOCKFILE_VERSIONS.includes(found)) {
            fail(`lockfileVersion "${found}" is not supported`);
          }
          version = found;
        } else if (entry.key === 'importers') {
          if (entry.value !== '') fail(`importers at line ${entry.line} is not a map`);
          const children = document.slice(entry.start + 1, entry.end);
          if (children.length === 0) fail(`importers at line ${entry.line} is not a map`);
          Object.assign(importers, parseImporters(children));
        } else if (REFUSED_SECTIONS.includes(entry.key)) {
          fail(`top-level "${entry.key}" section is outside the supported importer subset (line ${entry.line})`);
        } else if (IGNORED_SECTIONS.includes(entry.key)) {
          if (entry.value !== '' && entry.value !== '{}') {
            fail(`top-level "${entry.key}" section is not a map (line ${entry.line})`);
          }
          validateIgnoredSection(document.slice(entry.start + 1, entry.end), entry.key, entry.line);
        } else {
          fail(`unexpected top-level key "${entry.key}" at line ${entry.line}`);
        }
        i = end;
      }
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.marker === null) {
        document.push(line);
        continue;
      }
      applyDocument();
      document = [];
      documentLine = line.no + 1;
    }
    applyDocument();

    if (version === null) fail(`missing lockfileVersion at line ${documentLine}`);
    return { supported: true, version, importers };
  } catch (error) {
    if (error instanceof LockfileShapeError) {
      return { supported: false, reason: 'unsupported-lockfile-shape', detail: error.message };
    }
    return {
      supported: false,
      reason: 'unsupported-lockfile-shape',
      detail: `unreadable lockfile: ${error && error.message}`,
    };
  }
}
