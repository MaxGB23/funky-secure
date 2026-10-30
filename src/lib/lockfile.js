/**
 * Bounded pnpm-lock reader (RFC 8.2 R5, 4.7).
 *
 * A hand-written indent reader, not a YAML parser. It understands the shapes pnpm actually writes:
 * `lockfileVersion`, the `importers` map (or, for the `6.0` root shape, the top-level dependency
 * sections the root importer lives in), `importers.<path>.specifiers.<name>`,
 * `importers.<path>.{dependencies,devDependencies,optionalDependencies,peerDependencies}.<name>` in the
 * `{ specifier, version }` block form or the inline `name: specifier` form, the `catalogs` map, and
 * the dependency names an `overrides` section can rewrite. Everything it cannot attribute returns
 * `supported: false` with a reason, never a guessed result — the rules then report
 * `skip: unsupported-lockfile-shape`.
 *
 * Decisions the RFC leaves open, resolved here and in `docs/rules/exact-versions.md`:
 * - `catalogs` is read: a catalogue entry is the `{ specifier, version }` map pnpm records, and an entry
 *   of any other shape is refused by name. A `catalog:` specifier resolves through this map, so the
 *   comparison no longer needs to be refused for a section that cannot change an importer record.
 * - `overrides` is read as the dependency names it can rewrite, because a rewritten specifier
 *   disagrees with the manifest by construction; the importer comparison must not report that as a
 *   desync. `packageExtensionsChecksum` is a scalar beside it and is accepted.
 * - `patchedDependencies` stays refused: a patch changes what a package contains, and this reader
 *   models neither the patch nor the record it produces.
 * - `packages`, `snapshots`, `settings` and `time` never change the importer specifier/version
 *   relation, so they are read structurally and discarded (the RFC asks for `skip` only on a
 *   `snapshots` layout the reader does not recognize, which here means a non-map section).
 * - A concatenated lockfile is read document by document; a later document's importer path replaces
 *   an earlier one. This repository's own lockfile is a two-document stream.
 * - A document that ends inside a block is refused (S7): a key with no entry under it, or a flow
 *   collection that outlives its line, is a truncation and not a document this reader read. A cut at a
 *   line boundary that leaves every block it opened closed is not detectable here and is not claimed
 *   to be, because refusing it would mean inferring which sections a lockfile should have.
 * - The inline dependency form carries no resolved version, so `version` is `null` for it.
 */

export const SUPPORTED_LOCKFILE_VERSIONS = ['6.0', '9.0'];

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
/** Top-level sections whose presence never changes an importer specifier or version. */
const IGNORED_SECTIONS = ['packages', 'settings', 'snapshots', 'time'];
/** Top-level keys that are a scalar record, not a section. */
const IGNORED_SCALARS = ['packageExtensionsChecksum'];
/** Top-level sections that would change what a specifier resolves to, so the comparison is unsound. */
const REFUSED_SECTIONS = ['patchedDependencies'];
/** The importer key `pnpm-lock.yaml` uses for the repository root. */
const ROOT_IMPORTER = '.';

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
 * The flow collection a line opens and never closes, or `null` when every one of them closes on it.
 *
 * A truncated document can cut a flow collection in half (`resolution: {integrity: sha512-...`), and
 * braces inside a quoted scalar are text, not structure, so the walk follows the same quote rules the
 * comment stripper does. pnpm writes every flow collection on one line, so a collection still open at
 * the end of its line is a document this reader cannot claim to have read (S7).
 *
 * @param {string} text
 * @returns {'{' | '[' | null}
 */
function unclosedFlow(text) {
  /** @type {Array<string>} */
  const open = [];
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
    if (ch === '{' || ch === '[') open.push(ch);
    else if (ch === '}' || ch === ']') open.pop();
  }
  const last = open.pop();
  return last ?? null;
}

/**
 * Confirms that a document is structurally complete (S7): every line that opens a block is followed by
 * a line inside it, and every flow collection a line opens closes on that line.
 *
 * The reader stops at the subset it needs, so a document truncated anywhere else was accepted as
 * supported: `packages:` with half its tail missing, a package entry whose block never closes, an
 * importer field the reader does not model (`packageManagerDependencies:`) with nothing under it, or a
 * `resolution: {integrity: sha512-...` cut before its closing brace. The rule then compared every
 * specifier against an incomplete document and said nothing about it.
 *
 * Two properties are checked and only these two, because they are the ones a truncation leaves behind
 * without the reader having to model any section's content: a key with no entry under it, and a flow
 * collection still open at the end of its line (pnpm writes every flow collection on one line, so a
 * `{` that outlives its line was cut). A cut at a line boundary that leaves every block it opened
 * closed is not detectable here and is not claimed to be: refusing it would mean inferring which
 * sections a lockfile "should" have, and a valid lockfile with a short section would be refused.
 *
 * @param {LockfileLine[]} lines the lines of one document, without its `---` marker
 */
function validateDocumentStructure(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const kv = splitKeyValue(line.text);
    if (kv !== null && kv.value === '') {
      const next = lines[index + 1];
      if (next === undefined || next.indent <= line.indent) {
        fail(`the document ends inside a block: "${kv.key}" at line ${line.no} opens a map with no entry`);
      }
    }
    const open = unclosedFlow(line.text);
    if (open !== null) fail(`the "${open}" opened at line ${line.no} is never closed`);
  }
}

/**
 * Checks that an ignored top-level section is a map, and stops there.
 *
 * The property worth protecting is that the section can be skipped: the reader never looks inside it,
 * so nothing it declares can change what an importer specifier resolves to. A sequence directly under
 * the section would mean the reader is guessing at a layout it does not model, and that fails here.
 *
 * It does not recurse, and that is the correction record 0012 makes. Recursing demanded a map at every
 * depth, which rejected legal lockfiles: `packages` carries `bundledDependencies` as a sequence (every
 * `@next/swc-wasm-*` entry) and `snapshots` carries `transitivePeerDependencies` as one (vitest and
 * its siblings). Three of seven real lockfiles on the author's machine were refused this way, each
 * making every dependency comparison in that repository a skip — a valid YAML list inside an ignored
 * section cannot lie about a specifier, so refusing it bought no soundness and cost the rule.
 *
 * Not recursing is not the same as not looking: `validateDocumentStructure` walks every line of the
 * document for the shapes a truncation leaves behind (S7), which is a question about structure and
 * never about content.
 *
 * @param {LockfileLine[]} children the section's body
 * @param {string} section the top-level key, for the message
 * @param {number} line the section's own line
 */
function validateIgnoredSection(children, section, line) {
  if (children.length === 0) return;
  const first = children[0];
  if (first.text !== '-' && !first.text.startsWith('- ')) return;
  fail(`top-level "${section}" section is not a map (line ${first.no})`);
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
 * The empty shape one importer record has, so every importer and the `6.0` root record are the same
 * thing downstream.
 * @returns {object}
 */
function emptyImporter() {
  return {
    specifiers: {},
    dependencies: {},
    devDependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
  };
}

/**
 * @param {LockfileEntry} entry
 * @param {LockfileLine[]} children
 * @returns {Record<string, object>}
 */
function parseImporter(entry, children) {
  const importer = emptyImporter();
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
 * The catalogue map: catalog name → dependency → the `{ specifier, version }` pnpm records.
 *
 * A catalogue holds the range, so a `catalog:` specifier is exact only when the entry it resolves to
 * is. An entry of any other shape cannot say whether its value is the range or the resolution, so it
 * is refused by name: a range printed where a pin belongs is worse than a skip (RFC 4.9).
 *
 * @param {LockfileEntry} entry
 * @param {LockfileLine[]} children
 * @returns {Record<string, Record<string, { specifier: string, version: string }>>}
 */
function parseCatalogs(entry, children) {
  /** @type {Record<string, Record<string, { specifier: string, version: string }>>} */
  const catalogs = {};
  if (entry.value === '{}') return catalogs;
  if (entry.value !== '') fail(`top-level "catalogs" section is not a map (line ${entry.line})`);
  if (children.length === 0) fail(`top-level "catalogs" section is not a map (line ${entry.line})`);

  for (const catalog of mapEntries(children, '"catalogs"')) {
    /** @type {Record<string, { specifier: string, version: string }>} */
    const entries = {};
    catalogs[catalog.key] = entries;
    if (catalog.value === '{}') continue;
    if (catalog.value !== '') {
      fail(`catalog "${catalog.key}" in the "catalogs" section at line ${catalog.line} is not a map`);
    }
    const body = children.slice(catalog.start + 1, catalog.end);
    if (body.length === 0) {
      fail(`catalog "${catalog.key}" in the "catalogs" section at line ${catalog.line} is not a map`);
    }
    for (const item of mapEntries(body, `catalog "${catalog.key}"`)) {
      const fields = body.slice(item.start + 1, item.end);
      const block = item.value === '' ? mapEntries(fields, `catalogue entry "${item.key}" at line ${item.line}`) : [];
      const specifier = block.find((field) => field.key === 'specifier');
      const version = block.find((field) => field.key === 'version');
      if (!specifier || !version) {
        fail(
          `catalogue entry "${item.key}" in the "catalogs" section at line ${item.line} is not a {specifier, version} map`,
        );
      }
      entries[item.key] = {
        specifier: unquote(specifier.value),
        version: unquote(version.value),
      };
    }
  }
  return catalogs;
}

/**
 * The segments of an override selector, split at the `>` that separates `parent>child`.
 *
 * A range can carry a `>` of its own (`foo@>=1`, `foo@>1.0.0`), so a `>` is a separator only when it
 * is not part of one: not followed by `=`, and not directly after the `@` or an operator that opens a
 * range. Getting this wrong names `=1` as the dependency, and the exemption then misses.
 *
 * @param {string} selector
 * @returns {string[]}
 */
function overrideSegments(selector) {
  /** @type {string[]} */
  const segments = [];
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    if (selector[i] !== '>') continue;
    const next = selector[i + 1];
    const previous = selector[i - 1];
    if (next === '=' || ['@', '>', '<', '=', '~', '^'].includes(previous)) continue;
    segments.push(selector.slice(start, i));
    start = i + 1;
  }
  segments.push(selector.slice(start));
  return segments;
}

/**
 * The dependency one override selector rewrites: the last segment, with any `@range` cut off.
 * @param {string} selector
 * @returns {string}
 */
function overrideTarget(selector) {
  const last = overrideSegments(selector).pop().trim();
  const match = /^((?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+)/.exec(last);
  return match === null ? last : match[1];
}

/**
 * Whether an `overrides` selector states that it rewrites one dependency.
 *
 * A rewritten specifier disagrees with the manifest by construction — that is what the override is
 * for — so the importer comparison asks which names an override touched before it reports a desync.
 * A parent selector (`react@^18>react-dom`) names its child, never the parent.
 *
 * @param {string[]} selectors the selectors `parseLockfile` returned for `overrides`
 * @param {string} dependency
 * @returns {boolean}
 */
export function overrideTouches(selectors, dependency) {
  if (!Array.isArray(selectors) || typeof dependency !== 'string') return false;
  return selectors.some((selector) => overrideTarget(selector) === dependency);
}

/**
 * The selectors an `overrides` section declares.
 *
 * A rewritten specifier disagrees with the manifest by construction — that is what the override is
 * for — so the importer comparison must know which names it touched before it reports a desync. The
 * section is read leniently: its effect is only ever to exempt a comparison, and it never supplies a
 * version.
 *
 * @param {LockfileEntry} entry
 * @param {LockfileLine[]} children
 * @returns {string[]}
 */
function parseOverrides(entry, children) {
  /** @type {string[]} */
  const selectors = [];
  if (entry.value === '{}') return selectors;
  if (entry.value !== '') fail(`top-level "overrides" section is not a map (line ${entry.line})`);

  /** @param {LockfileLine[]} lines @param {string} prefix */
  const walk = (lines, prefix) => {
    for (const child of mapEntries(lines, `"overrides" at line ${entry.line}`)) {
      const selector = prefix === '' ? child.key : `${prefix}>${child.key}`;
      const body = lines.slice(child.start + 1, child.end);
      if (child.value === '' && body.length > 0) {
        walk(body, selector);
        continue;
      }
      selectors.push(selector);
    }
  };
  walk(children, '');

  return [...new Set(selectors)];
}

/**
 * Reads one lockfile shape from a string.
 * @param {string} text
 * @returns {{ supported: true, version: string, importers: Record<string, object>,
 *   catalogs: Record<string, Record<string, { specifier: string, version: string }>>,
 *   overrides: string[] }
 *   | { supported: false, reason: 'unsupported-lockfile-shape', detail: string }}
 */
export function parseLockfile(text) {
  try {
    if (typeof text !== 'string') fail('lockfile text is not a string');
    const lines = scan(text);

    let version = null;
    /** @type {Record<string, object>} */
    const importers = {};
    /** @type {Record<string, Record<string, { specifier: string, version: string }>>} */
    let catalogs = {};
    /** @type {string[]} */
    let overrides = [];
    /** The top-level sections the `6.0` root shape records the root importer in, until the end. */
    /** @type {object | null} */
    let rootSections = null;
    let importersSeen = false;
    let document = [];
    let documentLine = 1;

    const applyDocument = () => {
      validateDocumentStructure(document);
      let i = 0;
      while (i < document.length) {
        const line = document[i];
        if (line.indent !== 0) fail(`unexpected indentation at line ${line.no}`);
        const kv = splitKeyValue(line.text);
        if (!kv) fail(`expected "key: value" at line ${line.no}`);
        let end = i + 1;
        while (end < document.length && document[end].indent > 0) end += 1;
        const entry = { key: kv.key, value: kv.value, line: line.no, start: i, end };
        const children = document.slice(entry.start + 1, entry.end);

        if (entry.key === 'lockfileVersion') {
          if (entry.value === '') fail(`lockfileVersion at line ${entry.line} has no value`);
          const found = unquote(entry.value);
          if (!SUPPORTED_LOCKFILE_VERSIONS.includes(found)) {
            fail(`lockfileVersion "${found}" is not supported`);
          }
          version = found;
        } else if (entry.key === 'importers') {
          if (rootSections !== null) {
            fail(
              `"importers" at line ${entry.line} and a top-level dependency section both describe the root importer`,
            );
          }
          importersSeen = true;
          if (entry.value !== '') fail(`importers at line ${entry.line} is not a map`);
          if (children.length === 0) fail(`importers at line ${entry.line} is not a map`);
          Object.assign(importers, parseImporters(children));
        } else if (DEPENDENCY_SECTIONS.includes(entry.key)) {
          // The `6.0` root shape: pnpm 8 records the root importer's sections at the top level.
          if (importersSeen) {
            fail(
              `"importers" and the top-level "${entry.key}" section at line ${entry.line} both describe the root importer`,
            );
          }
          if (rootSections === null) rootSections = emptyImporter();
          rootSections[entry.key] = parseDependencies(entry, children, entry.key);
        } else if (entry.key === 'catalogs') {
          catalogs = parseCatalogs(entry, children);
        } else if (entry.key === 'overrides') {
          overrides = parseOverrides(entry, children);
        } else if (IGNORED_SCALARS.includes(entry.key)) {
          if (children.length > 0) fail(`top-level "${entry.key}" is a map where a scalar belongs (line ${entry.line})`);
        } else if (REFUSED_SECTIONS.includes(entry.key)) {
          fail(`top-level "${entry.key}" section is outside the supported importer subset (line ${entry.line})`);
        } else if (IGNORED_SECTIONS.includes(entry.key)) {
          if (entry.value !== '' && entry.value !== '{}') {
            fail(`top-level "${entry.key}" section is not a map (line ${entry.line})`);
          }
          validateIgnoredSection(children, entry.key, entry.line);
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
    if (rootSections !== null) importers[ROOT_IMPORTER] = rootSections;
    return { supported: true, version, importers, catalogs, overrides };
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

/**
 * The version an importer's lockfile entry records for one dependency, or null when it records none.
 *
 * Shared with `funky-secure pin`, which writes exactly this value: a command that pins must read the
 * same fact the rule reports, or it would pin to something the report never mentioned (RFC 4.9).
 *
 * @param {object | null | undefined} lock one importer from `parseLockfile`
 * @param {string} name the dependency
 * @param {string} type the dependency section
 * @returns {string | null}
 */
export function recordedVersion(lock, name, type) {
  const record = lock?.[type]?.[name];
  if (!record || typeof record.version !== 'string' || record.version === '') return null;
  // pnpm records a snapshot resolved with peers as `9.39.5(jiti@2.7.0)(supports-color@7.2.0)`. The
  // parenthesised tail names the peer set that snapshot was built against; the version is what comes
  // before the first paren. Returning the whole string wrote it into a manifest as a specifier no
  // resolver accepts, and compared a bare specifier against it as a desync — one shared read, three
  // wrong answers (0014).
  const paren = record.version.indexOf('(');
  return paren === -1 ? record.version : record.version.slice(0, paren);
}
