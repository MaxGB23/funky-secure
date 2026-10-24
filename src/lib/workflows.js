/**
 * Minimal structural workflow reader (RFC 8.2 R8/R9, evidence E6).
 *
 * A `uses:`-anchored line scan is invalid (E6): it misses single-line and bare-dash step maps, and it
 * takes false positives from block-scalar bodies, folded values and `with:` map keys. This reader
 * maps `jobs:` → job → `steps:` → step by indentation and refuses anything it cannot attribute, so
 * the rules report `skip: unparseable-workflow` instead of guessing.
 *
 * Shape it understands: block and flow-style step maps, quoted values, trailing comments kept as
 * evidence, `with:` maps (including their block scalars), block scalars (`run: |`, `run: >-`) whose
 * bodies are never steps, `docker://image:tag`, `docker://image@sha256:…` and local `./path` actions.
 *
 * Shapes it refuses, each naming the line: anchors/aliases/merge keys, tabs, multi-document streams,
 * sequences or flow maps where a job map is expected, and a `uses:` value written as a block scalar
 * (the reference cannot be attributed from a joined scalar without guessing).
 *
 * The reader models jobs and steps, never the trigger: `declaresTrigger` reads the one place YAML
 * defines it — a top-level `on:` key — so no rule scans the file for a trigger token (RFC 8.3, 16
 * F5 G3). R9 and `pull-request-target` share it, instead of growing a second trigger parser.
 */

class UnparseableWorkflow extends Error {}

/** @param {string} detail */
function fail(detail) {
  throw new UnparseableWorkflow(detail);
}

const BLOCK_SCALAR = /^[|>][+\-0-9]*$/;

/**
 * Strips a trailing `# comment` outside quotes, when the `#` starts a word. `#` inside a `${{ … }}`
 * expression is never a comment (E6).
 * @param {string} text
 * @returns {string}
 */
function stripComment(text) {
  let quote = null;
  let expression = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
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
    if (ch === '$' && text[i + 1] === '{' && text[i + 2] === '{') {
      expression += 1;
      i += 2;
      continue;
    }
    if (expression > 0 && ch === '}' && text[i + 1] === '}') {
      expression -= 1;
      i += 1;
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
 * Splits `key: value` at the first colon that ends a key.
 * @param {string} text
 * @returns {{ key: string, value: string } | null}
 */
function splitKeyValue(text) {
  const source = text.trim();
  if (source === '') return null;
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
 * @param {string} text
 * @param {number} line
 */
function checkNode(text, line) {
  const source = text.trim();
  if (source.startsWith('&') || source.startsWith('*')) {
    fail(`anchor or alias at line ${line} is not supported`);
  }
  const kv = splitKeyValue(source);
  if (!kv) return;
  if (kv.key === '<<') fail(`merge key at line ${line} is not supported`);
  if (kv.value.startsWith('&') || kv.value.startsWith('*')) {
    fail(`anchor or alias at line ${line} is not supported`);
  }
}

/**
 * @param {string} inner
 * @param {number} line
 * @returns {string[]}
 */
function splitFlow(inner, line) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote !== null) {
      current += ch;
      if (quote === '"' && ch === '\\') {
        current += inner[i + 1] ?? '';
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    if (ch === '}' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (depth !== 0) fail(`unbalanced flow map at line ${line}`);
  parts.push(current);
  return parts;
}

/**
 * @param {string} text
 * @param {number} line
 * @returns {Record<string, string>}
 */
function parseFlowMap(text, line) {
  if (!text.endsWith('}')) fail(`flow map at line ${line} spans more than one line`);
  const map = {};
  for (const part of splitFlow(text.slice(1, -1), line)) {
    if (part.trim() === '') continue;
    const kv = splitKeyValue(part);
    if (!kv) fail(`expected "key: value" in the flow map at line ${line}`);
    map[kv.key] = unquote(stripComment(kv.value));
  }
  return map;
}

/** @typedef {{ no: number, raw: string }} RawLine */
/** @typedef {{ key: string, value: string, line: number, indent: number, start: number, bodyStart: number, bodyEnd: number }} WorkflowEntry */

class Reader {
  /** @param {string} text */
  constructor(text) {
    if (typeof text !== 'string') fail('workflow text is not a string');
    /** @type {RawLine[]} */
    this.lines = text.split(/\r\n|\n|\r/).map((raw, index) => ({ no: index + 1, raw }));
  }

  /** @param {number} i */
  content(i) {
    return this.lines[i].raw.trim();
  }

  /** @param {number} i */
  skippable(i) {
    const text = this.content(i);
    return text === '' || text.startsWith('#');
  }

  /** @param {number} i */
  indent(i) {
    const lead = /^[ \t]*/.exec(this.lines[i].raw)[0];
    if (lead.includes('\t')) fail(`tab indentation at line ${this.lines[i].no}`);
    return lead.length;
  }

  /** @param {number} i */
  next(i) {
    let index = i;
    while (index < this.lines.length && this.skippable(index)) index += 1;
    return index;
  }

  /**
   * Index after the entry at `start`, whose key sits at `indent`. A block-scalar value consumes its
   * own body; any other value owns every deeper line.
   * @param {number} start
   * @param {number} indent
   * @param {number} limit
   */
  entryEnd(start, indent, limit = this.lines.length) {
    const kv = splitKeyValue(stripComment(this.content(start)));
    if (kv && BLOCK_SCALAR.test(kv.value)) return Math.min(this.readBlockScalar(start, indent).end, limit);
    let i = start + 1;
    while (i < limit) {
      if (this.skippable(i)) {
        i += 1;
        continue;
      }
      if (this.indent(i) <= indent) break;
      i += 1;
    }
    return i;
  }

  /**
   * @param {number} start
   * @param {number} indent
   * @returns {{ text: string, end: number }}
   */
  readBlockScalar(start, indent) {
    const kv = splitKeyValue(stripComment(this.content(start)));
    const fold = (kv?.value ?? '').startsWith('>');
    /** @type {string[]} */
    const body = [];
    let bodyIndent = null;
    let i = start + 1;
    for (; i < this.lines.length; i += 1) {
      const raw = this.lines[i].raw;
      if (raw.trim() === '') {
        body.push('');
        continue;
      }
      const indentOfBody = this.indent(i);
      if (bodyIndent === null) {
        if (indentOfBody <= indent) break;
        bodyIndent = indentOfBody;
      }
      if (indentOfBody < bodyIndent) break;
      body.push(raw.slice(bodyIndent));
    }
    while (body.length > 0 && body[body.length - 1] === '') body.pop();
    while (body.length > 0 && body[0] === '') body.shift();
    return { text: body.join(fold ? ' ' : '\n'), end: i };
  }

  /**
   * Entries of one map level, in document order.
   * @param {number} start
   * @param {number} end
   * @param {string} context
   * @returns {WorkflowEntry[]}
   */
  mapEntries(start, end, context) {
    /** @type {WorkflowEntry[]} */
    const entries = [];
    let level = null;
    let i = start;
    while (i < end) {
      if (this.skippable(i)) {
        i += 1;
        continue;
      }
      const line = this.lines[i].no;
      const indent = this.indent(i);
      if (level === null) level = indent;
      if (indent !== level) fail(`unexpected indentation at line ${line} in ${context}`);
      const rawText = this.content(i);
      const text = stripComment(rawText);
      if (text === '-' || text.startsWith('- ')) {
        fail(`sequence item at line ${line} where ${context} expects a key`);
      }
      checkNode(text, line);
      const kv = splitKeyValue(text);
      if (!kv) fail(`expected "key: value" at line ${line}`);
      const rawKv = splitKeyValue(rawText);
      const bodyEnd = Math.min(this.entryEnd(i, indent, end), end);
      entries.push({
        key: kv.key,
        value: kv.value,
        rawValue: rawKv ? rawKv.value : kv.value,
        line,
        indent,
        start: i,
        bodyStart: i + 1,
        bodyEnd,
      });
      i = bodyEnd;
    }
    return entries;
  }

  /** @returns {Array<object>} */
  parse() {
    /** @type {Array<object>} */
    const jobs = [];
    let sawDocumentStart = false;
    let sawKey = false;
    let i = 0;
    while (i < this.lines.length) {
      if (this.skippable(i)) {
        i += 1;
        continue;
      }
      const line = this.lines[i].no;
      const text = this.content(i);
      if (text === '---') {
        if (sawDocumentStart || sawKey) fail(`multi-document workflow at line ${line} is not supported`);
        sawDocumentStart = true;
        i += 1;
        continue;
      }
      if (text === '...') break;
      if (this.indent(i) !== 0) fail(`unexpected indentation at line ${line}`);
      const stripped = stripComment(text);
      checkNode(stripped, line);
      const kv = splitKeyValue(stripped);
      if (!kv) fail(`expected "key: value" at line ${line}`);
      sawKey = true;
      const end = this.entryEnd(i, 0);
      if (kv.key === 'jobs') {
        if (kv.value !== '') fail(`"jobs" at line ${line} is not a block map`);
        for (const job of this.parseJobs(i + 1, end)) jobs.push(job);
      }
      i = end;
    }
    return jobs;
  }

  /**
   * @param {number} start
   * @param {number} end
   * @returns {Array<object>}
   */
  parseJobs(start, end) {
    return this.mapEntries(start, end, '"jobs"').map((entry) => this.parseJob(entry));
  }

  /** @param {WorkflowEntry} entry */
  parseJob(entry) {
    const job = { id: entry.key, name: null, condition: null, permissions: null, steps: [] };
    if (entry.value === '{}') return job;
    if (entry.value !== '') {
      if (entry.value.startsWith('{')) {
        fail(`job "${entry.key}" is a flow map at line ${entry.line}, which the reader does not model`);
      }
      fail(`job "${entry.key}" at line ${entry.line} is not a map`);
    }
    for (const key of this.mapEntries(entry.bodyStart, entry.bodyEnd, `job "${entry.key}"`)) {
      if (key.key === 'name') job.name = this.scalarValue(key, 'name');
      else if (key.key === 'if') job.condition = this.scalarValue(key, 'if');
      else if (key.key === 'permissions') job.permissions = this.mapOrScalar(key, 'permissions');
      else if (key.key === 'steps') job.steps = this.parseSteps(key, entry.key);
    }
    return job;
  }

  /**
   * @param {WorkflowEntry} entry
   * @param {string} key
   * @returns {string}
   */
  scalarValue(entry, key) {
    if (BLOCK_SCALAR.test(entry.value)) return this.readBlockScalar(entry.start, entry.indent).text;
    if (entry.value === '') fail(`"${key}" at line ${entry.line} has no value`);
    return unquote(entry.value);
  }

  /**
   * @param {WorkflowEntry} entry
   * @param {string} key
   * @returns {Record<string, string> | string}
   */
  mapOrScalar(entry, key) {
    if (entry.value === '{}') return {};
    if (entry.value.startsWith('{')) return parseFlowMap(entry.value, entry.line);
    if (entry.value !== '') return unquote(entry.value);
    return this.mapValue(entry, key);
  }

  /**
   * @param {WorkflowEntry} entry
   * @param {string} key
   * @returns {Record<string, string>}
   */
  mapValue(entry, key) {
    const map = {};
    for (const child of this.mapEntries(entry.bodyStart, entry.bodyEnd, `"${key}" at line ${entry.line}`)) {
      if (BLOCK_SCALAR.test(child.value)) {
        map[child.key] = this.readBlockScalar(child.start, child.indent).text;
      } else {
        map[child.key] = child.value === '' ? '' : unquote(child.value);
      }
    }
    return map;
  }

  /**
   * @param {WorkflowEntry} entry
   * @param {string} jobId
   * @returns {Array<object>}
   */
  parseSteps(entry, jobId) {
    if (entry.value === '[]') return [];
    if (entry.value !== '') fail(`"steps" at line ${entry.line} is not a block sequence`);

    /** @type {Array<object>} */
    const steps = [];
    let i = this.next(entry.bodyStart);
    if (i >= entry.bodyEnd) return steps;
    const dashIndent = this.indent(i);
    if (dashIndent <= entry.indent) {
      fail(`unexpected indentation at line ${this.lines[i].no} in the steps of "${jobId}"`);
    }
    while (i < entry.bodyEnd) {
      if (this.skippable(i)) {
        i += 1;
        continue;
      }
      const line = this.lines[i].no;
      if (this.indent(i) !== dashIndent) {
        fail(`unexpected indentation at line ${line} in the steps of "${jobId}"`);
      }
      const text = this.content(i);
      if (text !== '-' && !text.startsWith('- ')) fail(`expected a step at line ${line}`);
      const parsed = this.parseStep(i, dashIndent, entry.bodyEnd, steps.length);
      steps.push(parsed.step);
      i = parsed.end;
    }
    return steps;
  }

  /**
   * @param {number} start
   * @param {number} dashIndent
   * @param {number} end
   * @returns {number}
   */
  stepEnd(start, dashIndent, end) {
    let i = start + 1;
    while (i < end) {
      if (this.skippable(i)) {
        i += 1;
        continue;
      }
      if (this.indent(i) <= dashIndent) break;
      i += 1;
    }
    return i;
  }

  /**
   * @param {number} start
   * @param {number} dashIndent
   * @param {number} end
   * @param {number} index
   * @returns {{ step: object, end: number }}
   */
  parseStep(start, dashIndent, end, index) {
    const line = this.lines[start].no;
    const text = this.content(start);
    const rawRest = text.slice(1).trim();
    const rest = stripComment(rawRest).trim();
    const stop = this.stepEnd(start, dashIndent, end);
    /** @type {{ index: number, line: number, name: string | null, uses: string | null, raw: string | null, with: Record<string, string>, run: string | null }} */
    const step = { index, line, name: null, uses: null, raw: null, with: {}, run: null };

    if (rest.startsWith('{')) {
      const pairs = parseFlowMap(rest, line);
      const after = this.next(start + 1);
      if (after < stop) fail(`unexpected nesting at line ${this.lines[after].no} after a flow-style step`);
      for (const [key, value] of Object.entries(pairs)) {
        this.applyStepKey(step, {
          key,
          value,
          rawValue: value,
          line,
          indent: dashIndent + 2,
          start,
          bodyStart: start + 1,
          bodyEnd: stop,
        });
      }
      return { step, end: stop };
    }

    if (rest === '') {
      const first = this.next(start + 1);
      if (first >= stop) fail(`step at line ${line} is neither a map nor a scalar`);
      for (const entry of this.mapEntries(first, stop, `the step at line ${line}`)) {
        this.applyStepKey(step, entry);
      }
      return { step, end: stop };
    }

    const kv = splitKeyValue(rest);
    if (!kv) {
      const after = this.next(start + 1);
      if (after < stop) fail(`unexpected nesting at line ${this.lines[after].no} after a scalar step`);
      return { step, end: stop };
    }

    const keyIndent = this.indent(start) + this.content(start).indexOf(rest);
    const rawKv = splitKeyValue(rawRest);
    const firstEntry = {
      key: kv.key,
      value: kv.value,
      rawValue: rawKv ? rawKv.value : kv.value,
      line,
      indent: keyIndent,
      start,
      bodyStart: start + 1,
      bodyEnd: this.entryEnd(start, keyIndent, stop),
    };
    this.applyStepKey(step, firstEntry);
    const nextKey = this.next(firstEntry.bodyEnd);
    if (nextKey < stop) {
      for (const entry of this.mapEntries(nextKey, stop, `the step at line ${line}`)) {
        this.applyStepKey(step, entry);
      }
    }
    return { step, end: stop };
  }

  /**
   * @param {object} step
   * @param {WorkflowEntry} entry
   */
  applyStepKey(step, entry) {
    if (entry.key === 'name') {
      step.name = this.scalarValue(entry, 'name');
      return;
    }
    if (entry.key === 'uses') {
      if (BLOCK_SCALAR.test(entry.value)) {
        fail(`"uses" at line ${entry.line} is a block scalar, which the reader does not attribute`);
      }
      if (entry.value === '') fail(`"uses" at line ${entry.line} has no value`);
      const normalized = unquote(entry.value);
      if (normalized === '') fail(`"uses" at line ${entry.line} has no value`);
      step.raw = entry.rawValue ?? entry.value;
      step.uses = normalized;
      return;
    }
    if (entry.key === 'run') {
      if (BLOCK_SCALAR.test(entry.value)) step.run = this.readBlockScalar(entry.start, entry.indent).text;
      else if (entry.value === '') fail(`"run" at line ${entry.line} has no value`);
      else step.run = unquote(entry.value);
      return;
    }
    if (entry.key === 'with') step.with = this.mapValue(entry, 'with');
  }
}

/**
 * @param {string} text
 * @returns {{ ok: true, jobs: Array<object> } | { ok: false, reason: 'unparseable-workflow', detail: string }}
 */
export function parseWorkflow(text) {
  try {
    return { ok: true, jobs: new Reader(text).parse() };
  } catch (error) {
    if (error instanceof UnparseableWorkflow) {
      return { ok: false, reason: 'unparseable-workflow', detail: error.message };
    }
    return {
      ok: false,
      reason: 'unparseable-workflow',
      detail: `unreadable workflow: ${error && error.message}`,
    };
  }
}

/** A character that continues a name, so a token boundary is never inside a trigger name. */
const NAME_CHARACTER = /[A-Za-z0-9_.-]/;

/**
 * Whether `value` carries `name` as a standalone token: a bare scalar, a flow-sequence item or a
 * flow-map key. `pull_request` is not a token of `pull_request_target`.
 * @param {string} value
 * @param {string} name
 * @returns {boolean}
 */
function hasToken(value, name) {
  let index = value.indexOf(name);
  while (index !== -1) {
    const before = index === 0 ? '' : value[index - 1];
    const after = value[index + name.length] ?? '';
    if (!NAME_CHARACTER.test(before) && !NAME_CHARACTER.test(after)) return true;
    index = value.indexOf(name, index + 1);
  }
  return false;
}

/**
 * Whether the workflow's top-level `on:` key declares `name` as a trigger event, read the way YAML
 * defines it: a top-level key whose value is an inline scalar, a flow sequence, a flow map, or an
 * indented block of keys. Comments are stripped first, so a commented-out trigger is not a
 * declaration, and a trigger named in a `run:` body, a job `if:` or a job `name:` is not one either:
 * only the `on:` value is read (RFC 8.3, 16 F5 G3).
 * @param {string} text
 * @param {string} name
 * @returns {boolean}
 */
export function declaresTrigger(text, name) {
  if (typeof text !== 'string' || typeof name !== 'string' || name === '') return false;
  const lines = text.split(/\r\n|\n|\r/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = stripComment(lines[i]);
    if (line.trim() === '') continue;
    if (/^[ \t]/.test(line)) continue;
    const entry = splitKeyValue(line.trim());
    if (entry === null || entry.key !== 'on') continue;

    if (entry.value !== '') return hasToken(entry.value, name);

    let bodyIndent = null;
    for (let j = i + 1; j < lines.length; j += 1) {
      const body = stripComment(lines[j]);
      if (body.trim() === '') continue;
      const indent = /^[ \t]*/.exec(body)[0].length;
      if (indent === 0) break;
      if (bodyIndent === null) bodyIndent = indent;
      if (indent !== bodyIndent) continue;

      const item = body.trim();
      if (item === '-' || item.startsWith('- ')) {
        if (hasToken(item.slice(1).trim(), name)) return true;
        continue;
      }
      const trigger = splitKeyValue(item);
      if (trigger !== null && trigger.key === name) return true;
    }

    return false;
  }

  return false;
}
