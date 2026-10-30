/**
 * The writes of `init --apply` (RFC 11.2): W1a, W1b and W1c in one managed block, W2, W3, W3b and
 * W4.
 *
 * A builder receives bytes and resolved facts and returns the bytes it would write; none of them
 * reads or writes a file, so the plan is a pure function of the repository state the scan already
 * collected. `planFor` adds the one decision that is not content — the RFC 11.5 write-target guard —
 * through `paths.validateWriteTarget`, which only answers containment (a realpath check, never a
 * content read, never a write).
 *
 * Two rules apply to every builder:
 *
 * - Never overwrite. A value that exists and differs is reported as `conflict` and left alone
 *   (RFC 4.3); there is no builder that replaces a value it did not write.
 * - Idempotent by marker. The managed block is located by its markers and compared as content, so a
 *   second run returns `would-skip` with the file's own bytes unchanged (RFC 4.3, 11.2).
 */

import { basename, resolve } from 'node:path';

import { upsertBlock, blockValues } from './managed-block.js';
import { validateWriteTarget } from './paths.js';
import { planItem } from './plan.js';
import { QUARANTINE_DEFAULT_MINUTES, QUARANTINE_STRICT_MINUTES } from './policy.js';

export const WORKSPACE_RELATIVE = 'pnpm-workspace.yaml';
export const GITIGNORE_RELATIVE = '.gitignore';
export const PACKAGE_JSON_RELATIVE = 'package.json';
export const CONFIG_RELATIVE = 'funky-secure.config.json';

/** The ignore entries R7 requires, in the order the block prints them (RFC 8.2 R7, 11.2). */
export const GITIGNORE_ENTRIES = Object.freeze([
  '.env',
  '.env.*',
  // The template family, negated as a family. Enumerating spellings twice (`.env.example` and
  // `.env.test.example`) left `.env.local.example` matching `.env.*` and therefore ignored, so a repository
  // that ran `init --apply` could not add a `.env.production.example` afterwards — the write path
  // contradicting the rule that accepts the family (S3, 0024).
  '!.env*.example',
  '*.pem',
  '*.key',
  // The install step of the path creates it, so ignoring it is the tool closing its own loop rather
  // than a preference about the project: a generated repository ended with `?? node_modules/` and the
  // path that promises a clean tree could not deliver one (0022). Nothing framework-specific is added.
  'node_modules/',
]);

const QUARANTINE_GATE_KEY = 'minimumReleaseAgeStrict';
const QUARANTINE_GATE_LINE = `${QUARANTINE_GATE_KEY}: true`;
const SAVE_PREFIX_KEY = 'savePrefix';
const SAVE_PREFIX_LINE = `${SAVE_PREFIX_KEY}: ''`;
const EMPTY_PREFIX_VALUES = new Set(["''", '""']);
const AUTH_TOKEN = /_authToken\s*=/;

/**
 * `a`, `a and b`, `a, b and c`: the shapes the reason sentences are built from.
 * @param {string[]} items
 * @returns {string}
 */
function joinWords(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * What this repository's own managed block declares (RFC 11.2.1, W1a and W1c).
 *
 * W1a's condition is "the block does not declare `minimumReleaseAgeStrict: true`", never "the effective
 * strictness is false": the plan reads these bytes and the bytes next to them, so a machine whose
 * global configuration already satisfies the policy cannot suppress the write. The machine's effective
 * value stays a *finding* of the `quarantine` rule; it is never a plan input.
 *
 * A key declared outside the block declares nothing here: that is the duplicate source `upsertBlock`
 * refuses, so it becomes a conflict instead of a silent `would-skip`.
 *
 * @param {string | null | undefined} text the bytes of `pnpm-workspace.yaml`, `null` when absent
 * @returns {{ gate: boolean, savePrefix: boolean }}
 */
export function workspaceBlockFacts(text) {
  const block = blockValues(typeof text === 'string' ? text : '');
  return {
    gate: block.values[QUARANTINE_GATE_KEY] === 'true',
    savePrefix: EMPTY_PREFIX_VALUES.has(block.values[SAVE_PREFIX_KEY]),
  };
}

/**
 * The findings the engine reported for one rule. Plan functions read the report instead of calling
 * `detect` a second time, so a plan can never disagree with the report of the same run.
 * @param {{ findings?: Array<object> } | undefined} report
 * @param {string} ruleId
 * @returns {Array<object>}
 */
export function findingsOf(report, ruleId) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  return findings.filter((finding) => finding.rule === ruleId);
}

/**
 * The effective quarantine strictness the manager applies (E1): a reported flag wins, and an
 * explicitly configured `minimumReleaseAge` makes pnpm default the flag to true. `null` means the
 * configuration was not available.
 *
 * This is the `quarantine` rule's *finding* input and never a plan input: W1a reads the repository's
 * own managed block (RFC 11.2.1).
 * @param {object} ctx
 * @returns {boolean | null}
 */
export function quarantineStrictness(ctx) {
  const config = ctx?.machine?.config ?? null;
  if (config === null || typeof config !== 'object') return null;
  if (typeof config.minimumReleaseAgeStrict === 'boolean') return config.minimumReleaseAgeStrict;
  return typeof config.minimumReleaseAge !== 'undefined';
}

/**
 * The fact W2 needs to decide whether `.npmrc` belongs in the block: a tracked root `.npmrc`
 * without a token is a configuration file the repository may commit, so it is not ignored.
 * `null` means the tracked set was not measured, and the safe answer is to include `.npmrc`.
 * @param {object} ctx
 * @returns {{ tracked: boolean, hasToken: boolean } | null}
 */
export function trackedNpmrcFacts(ctx) {
  // The collector resolves this fact once (src/lib/targets.js); the rule and the write read the
  // same value, so they cannot disagree about whether the tracked .npmrc is legitimate.
  const resolved = ctx?.repo?.npmrc;
  if (resolved && resolved.tracked === true) {
    return {
      tracked: true,
      hasToken: resolved.hasToken === true,
      tokenlessTracked: resolved.tokenlessTracked === true,
    };
  }
  if (resolved && resolved.tracked === false) {
    return { tracked: false, hasToken: resolved.hasToken === true, tokenlessTracked: false };
  }
  const tracked = ctx?.repo?.tracked ?? null;
  if (tracked === null) return null;
  const text = ctx?.repo?.files?.npmrc?.text ?? null;
  const hasToken = typeof text === 'string' && AUTH_TOKEN.test(text);
  return {
    tracked: tracked.has('.npmrc'),
    hasToken,
    tokenlessTracked: tracked.has('.npmrc') && typeof text === 'string' && !hasToken,
  };
}

/**
 * Turns a builder result into a plan item, resolving the absolute path through the RFC 11.5 guard.
 * A refused target never becomes a write: the guard's reason becomes the conflict's reason.
 *
 * @param {object} ctx
 * @param {{ relative: string, operation: string, result: object }} options
 * @returns {object} plan item
 */
export function planTarget(ctx, { relative, operation, result }) {
  const target = basename(relative);
  const root = ctx?.repo?.root ?? ctx?.cwd;
  const guard = validateWriteTarget({ root, relative, expectedBasename: target });

  if (!guard.ok) {
    return planItem({
      target,
      operation,
      path: typeof root === 'string' ? resolve(root, relative) : relative,
      state: 'conflict',
      reason: guard.reason,
    });
  }

  return planItem({
    target,
    operation,
    path: guard.path,
    content: result.ok ? result.content : null,
    state: result.ok ? result.state : 'conflict',
    reason: result.reason,
  });
}

/**
 * W1a, W1b and W1c in one managed block of `pnpm-workspace.yaml`.
 *
 * `minimumReleaseAgeStrict: true` is always written (the gate flip, W1a). The age itself is written too,
 * always (W1b): `1440` under `baseline` and `4320` under `strict`, in the same block, so the file stays
 * one unit of review. Leaving it out made the gate inherit pnpm's own default, which is `0` up to pnpm 10
 * and `1440` from pnpm 11 on — a block claiming a gate that an older major enforces nowhere (0017).
 * `savePrefix: ''` is always written too (W1c): it is the project-level setting that stops a later
 * `pnpm add` from saving a caret, which measurement on pnpm 12.3.4 confirms (`^1.3.0` without the key,
 * `1.3.0` with it). A file that declares any of these keys outside the block is a conflict: two sources
 * for one setting is the defect this product reports. A missing file is created with the block only —
 * never a `packages:` key — and the reason says the repository becomes a pnpm workspace root.
 *
 * @param {{ workspaceYaml?: string | null, preset?: string }} [options]
 * @returns {{ ok: true, operation: string, content: string, reason: string, state: string } | { ok: false, state: 'conflict', reason: string, key: string | null }}
 */
export function writeQuarantineGate({ workspaceYaml = null, exists = false, preset = 'baseline' } = {}) {
  if (exists && typeof workspaceYaml !== 'string') {
    return {
      ok: false,
      state: 'conflict',
      reason: `${WORKSPACE_RELATIVE} exists but could not be read, so it is never rewritten`,
      key: null,
    };
  }
  const existing = typeof workspaceYaml === 'string' ? workspaceYaml : null;
  const minutes = preset === 'strict' ? QUARANTINE_STRICT_MINUTES : QUARANTINE_DEFAULT_MINUTES;
  const body = [QUARANTINE_GATE_LINE];
  const keys = [QUARANTINE_GATE_KEY];
  const values = [QUARANTINE_GATE_LINE];
  const effects = ['turn the quarantine into a gate'];
  body.push(`minimumReleaseAge: ${minutes}`);
  keys.push('minimumReleaseAge');
  values.push(`minimumReleaseAge: ${minutes}`);
  effects.push(preset === 'strict' ? 'set the 3-day floor' : 'declare the day the repository waits');
  body.push(SAVE_PREFIX_LINE);
  keys.push(SAVE_PREFIX_KEY);
  values.push(SAVE_PREFIX_LINE);
  effects.push('stop a later pnpm add from saving a caret');

  const upserted = upsertBlock(existing ?? '', body.join('\n'), { keys });
  if (!upserted.ok) {
    if (upserted.reason === 'duplicate-key') {
      return {
        ok: false,
        state: 'conflict',
        reason: `${WORKSPACE_RELATIVE} already declares ${upserted.key} outside the managed block; two sources for one setting are not written`,
        key: upserted.key,
      };
    }
    return {
      ok: false,
      state: 'conflict',
      reason: `the managed block in ${WORKSPACE_RELATIVE} is malformed`,
      key: null,
    };
  }

  const written = joinWords(values);
  const effect = joinWords(effects);

  let reason;
  if (upserted.changed) {
    const creates = existing === null;
    reason = `${written} ${effect}${creates ? `; creating ${WORKSPACE_RELATIVE} makes this repository a pnpm workspace root` : ''}`;
  } else {
    reason = `the managed block already carries ${written}`;
  }

  return {
    ok: true,
    operation: 'managed block',
    content: upserted.text,
    reason,
    state: upserted.changed ? 'would-write' : 'would-skip',
  };
}

/**
 * W2: the managed block of `.gitignore`.
 *
 * The block always lists the full required set, so a repository that already has some of the
 * entries ends up with one block that names all of them. `.npmrc` is included unless the repository
 * tracks a root `.npmrc` without a token (`trackedNpmrc`).
 *
 * @param {{ gitignore?: string | null, trackedNpmrc?: { tracked: boolean, hasToken: boolean } | null }} [options]
 * @returns {{ ok: true, operation: string, content: string, reason: string, state: string } | { ok: false, state: 'conflict', reason: string, key: null }}
 */
export function writeGitignoreBlock({ gitignore = null, exists = false, trackedNpmrc = null } = {}) {
  if (exists && typeof gitignore !== 'string') {
    return {
      ok: false,
      state: 'conflict',
      reason: `${GITIGNORE_RELATIVE} exists but could not be read, so it is never rewritten`,
      key: null,
    };
  }
  const existing = typeof gitignore === 'string' ? gitignore : null;
  // Only the fact the collector resolved on purpose removes the entry: a tracked .npmrc whose text
  // was not read is not evidence that it is tokenless (RFC 8.2 R7).
  const omitNpmrc = trackedNpmrc !== null && trackedNpmrc.tokenlessTracked === true;
  const entries = omitNpmrc ? [...GITIGNORE_ENTRIES] : [...GITIGNORE_ENTRIES, '.npmrc'];

  const upserted = upsertBlock(existing ?? '', entries.join('\n'));
  if (!upserted.ok) {
    return {
      ok: false,
      state: 'conflict',
      reason: `the managed block in ${GITIGNORE_RELATIVE} is malformed`,
      key: null,
    };
  }

  const listed = entries.join(', ');
  const omission = omitNpmrc
    ? '; .npmrc is omitted because the repository tracks a root .npmrc without a token'
    : '';
  const reason = upserted.changed
    ? `adds ${listed} to the managed block${omission}`
    : `the managed block already carries ${listed}`;

  return {
    ok: true,
    operation: 'managed block',
    content: upserted.text,
    reason,
    state: upserted.changed ? 'would-write' : 'would-skip',
  };
}

/**
 * Detects the indentation of a JSON document from its first indented line: two spaces, four spaces
 * or a tab. Anything else falls back to two spaces, the format `funky-secure` itself writes.
 * @param {string} text
 * @returns {string}
 */
export function detectIndent(text) {
  const match = text.match(/^([ \t]+)\S/m);
  if (match === null) return '  ';
  const whitespace = match[1];
  if (whitespace.startsWith('\t')) return '\t';
  return whitespace.length >= 4 ? '    ' : '  ';
}

/**
 * W3: set `packageManager` in `package.json` when the key is absent (RFC 4.3, 11.2).
 *
 * The document's own indentation and trailing newline are preserved. An existing pin is never
 * overwritten: a different value is a conflict, the same value is `would-skip`.
 *
 * @param {{ packageJsonText?: string | null, version?: string | null }} [options]
 * @returns {{ ok: true, operation: string, content: string, reason: string, state: string } | { ok: false, state: 'conflict', reason: string, key: string }}
 */
export function writePackageManagerPin({ packageJsonText = null, version = null } = {}) {
  const text = typeof packageJsonText === 'string' ? packageJsonText : null;
  const operation = 'set packageManager';

  if (text === null) {
    return {
      ok: false,
      state: 'conflict',
      reason: `${PACKAGE_JSON_RELATIVE} could not be read, so the pin cannot be written`,
      key: 'packageManager',
    };
  }

  const read = readManifestObject(text);
  if (read.ok === false) {
    return { ok: false, state: 'conflict', reason: read.reason, key: 'packageManager' };
  }
  const json = read.json;

  if (typeof version !== 'string' || version === '') {
    return {
      ok: false,
      state: 'conflict',
      reason: 'no pnpm version answered, so there is no pin to write',
      key: 'packageManager',
    };
  }

  const target = `pnpm@${version}`;

  // A value this writer cannot interpret is not a missing value (S1). `packageManager` is a string in
  // every shape pnpm reads, so an object, an array, a number or `null` is something the user wrote and
  // this write has no business replacing: treating it as absent turned
  // `"packageManager": {"name":"pnpm","version":"10.0.0"}` into `"pnpm@12.3.4"` and exited 0. The
  // reason names the field and what was found, like every other conflict here.
  if (typeof json.packageManager !== 'undefined' && typeof json.packageManager !== 'string') {
    return {
      ok: false,
      state: 'conflict',
      reason: `${PACKAGE_JSON_RELATIVE} already declares packageManager as ${JSON.stringify(json.packageManager)}, which is not a string; it is not overwritten`,
      key: 'packageManager',
    };
  }

  const declared =
    typeof json.packageManager === 'string' && json.packageManager !== ''
      ? json.packageManager
      : null;

  if (declared === target) {
    return {
      ok: true,
      operation,
      content: text,
      reason: `${PACKAGE_JSON_RELATIVE} already declares packageManager "${target}"`,
      state: 'would-skip',
    };
  }
  if (declared !== null) {
    return {
      ok: false,
      state: 'conflict',
      reason: `${PACKAGE_JSON_RELATIVE} already declares packageManager "${declared}"; it is not overwritten`,
      key: 'packageManager',
    };
  }

  json.packageManager = target;

  return {
    ok: true,
    operation,
    content: serializeManifest(text, json),
    reason: `sets packageManager to "${target}"`,
    state: 'would-write',
  };
}

/**
 * The parsed manifest, or the reason it is not rewritten. W3 and W3b refuse the same files with the
 * same words, so the two writes cannot disagree about what is readable.
 * @param {string} text
 * @returns {{ ok: true, json: object } | { ok: false, reason: string }}
 */
function readManifestObject(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${PACKAGE_JSON_RELATIVE} is not valid JSON; it is not rewritten` };
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return {
      ok: false,
      reason: `${PACKAGE_JSON_RELATIVE} does not contain a JSON object; it is not rewritten`,
    };
  }
  return { ok: true, json };
}

/**
 * The document re-emitted in its own formatting, so a writer changes the keys it owns and nothing
 * else — one serializer for every write over `package.json`.
 * @param {string} text the bytes the document was read from
 * @param {object} json the parsed document, already mutated
 * @returns {string}
 */
function serializeManifest(text, json) {
  const indent = detectIndent(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let content = JSON.stringify(json, null, indent);
  if (eol === '\r\n') content = content.replace(/\n/g, '\r\n');
  if (text.endsWith('\n') || text.endsWith('\r')) content += eol;
  return content;
}

/**
 * Whether a declared guard already names the pair this writer owns, `name` and `version`.
 *
 * Only those two keys are compared. `pnpm init` writes `onFail: "download"` beside them, and any value
 * of that key is a decision one of the two managers loses (RFC 0030), so a manifest that carries it is
 * equal — already at policy — and the key is never rewritten.
 * @param {unknown} found
 * @param {{ name: string, version: string }} target
 * @returns {boolean}
 */
function isGuardFor(found, target) {
  if (found === null || typeof found !== 'object' || Array.isArray(found)) return false;
  return found.name === target.name && found.version === target.version;
}

/**
 * W3b: set `devEngines.packageManager` beside the pin W3 writes (RFC 11.2, 0030).
 *
 * This is the field npm enforces — `packageManager` is a Corepack pin npm ignores — and it is written
 * **without** `onFail` on purpose: npm treats the absent value as `error`, pnpm's default is its own
 * version switch, and any explicit value is a regression for one of the two managers (measured in
 * `rfcs/0030-the-guard-both-managers-read/evidence/onfail-and-autoswitch.md`).
 *
 * The version is the one the pin establishes, never a second opinion: the caller passes the same
 * value W3 writes, and a plan that establishes no version (a conflicting pin) plans no guard.
 *
 * Three states, and only the first writes:
 *
 * 1. Absent — no `devEngines`, or one without `packageManager`: `would-write`, keeping every other
 *    key of `devEngines` (a manifest may already carry `devEngines.runtime`) and of the document.
 * 2. Declared and naming the pair this writer owns in `name` and `version`: `would-skip`, with the
 *    file's own bytes, like a matching pin. Any other key of the declared object — `onFail` in
 *    particular — is neither compared nor rewritten.
 * 3. Declared and different, or not interpretable: a `conflict` naming the field and the value found,
 *    and no bytes to write. A value the tool cannot interpret is never treated as absent (0027,
 *    decision I-58).
 *
 * @param {{ packageJsonText?: string | null, version?: string | null }} [options]
 * @returns {{ ok: true, operation: string, content: string, reason: string, state: string } | { ok: false, state: 'conflict', reason: string, key: string }}
 */
export function writeDevEnginesPackageManager({ packageJsonText = null, version = null } = {}) {
  const text = typeof packageJsonText === 'string' ? packageJsonText : null;
  const operation = 'set devEngines.packageManager';

  if (text === null) {
    return {
      ok: false,
      state: 'conflict',
      reason: `${PACKAGE_JSON_RELATIVE} could not be read, so devEngines.packageManager cannot be written`,
      key: 'devEngines.packageManager',
    };
  }

  const read = readManifestObject(text);
  if (read.ok === false) {
    return {
      ok: false,
      state: 'conflict',
      reason: read.reason,
      key: 'devEngines.packageManager',
    };
  }
  const json = read.json;

  if (typeof version !== 'string' || version === '') {
    return {
      ok: false,
      state: 'conflict',
      reason: 'no pnpm version answered, so there is no devEngines.packageManager to write',
      key: 'devEngines.packageManager',
    };
  }

  const target = { name: 'pnpm', version };
  const declared = json.devEngines;

  if (typeof declared !== 'undefined') {
    if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) {
      return {
        ok: false,
        state: 'conflict',
        reason: `${PACKAGE_JSON_RELATIVE} already declares devEngines as ${JSON.stringify(declared)}, which is not an object; it is not overwritten`,
        key: 'devEngines',
      };
    }

    if (Object.hasOwn(declared, 'packageManager')) {
      const found = declared.packageManager;
      if (isGuardFor(found, target)) {
        return {
          ok: true,
          operation,
          content: text,
          reason: `${PACKAGE_JSON_RELATIVE} already declares devEngines.packageManager "pnpm@${version}"`,
          state: 'would-skip',
        };
      }
      return {
        ok: false,
        state: 'conflict',
        reason: `${PACKAGE_JSON_RELATIVE} already declares devEngines.packageManager as ${JSON.stringify(found)}; it is not overwritten with ${JSON.stringify(target)}`,
        key: 'devEngines.packageManager',
      };
    }
  }

  json.devEngines = { ...(declared ?? {}), packageManager: target };

  return {
    ok: true,
    operation,
    content: serializeManifest(text, json),
    reason: `sets devEngines.packageManager to ${JSON.stringify(target)} and writes no onFail`,
    state: 'would-write',
  };
}

/**
 * The version a declared pin establishes, or `null` when the declaration is not a versioned pnpm.
 *
 * This reads the manifest, never the machine: the guard the plan writes must carry the version the
 * manifest ends up declaring, and a `packageManager` the tool keeps is a second opinion if its version
 * is replaced with whatever pnpm answered (RFC 0030, 11.2).
 * @param {object | null} json the parsed manifest
 * @returns {string | null}
 */
function declaredPinVersion(json) {
  const value = json?.packageManager;
  if (typeof value !== 'string') return null;
  const match = /^pnpm@(\d+\.\d+\.\d+\S*)$/.exec(value);
  return match === null ? null : match[1];
}

/**
 * W3 and W3b, in the order the plan prints them: the pin, then the guard beside it.
 *
 * Two plan items over one file on purpose — the plan is the only place a human sees what will be
 * written, so a writer that reports one path and changes two keys is the defect 0019 and 0027 both
 * name. The guard's input is the pin's own bytes when the pin writes, so applying both items leaves one
 * file carrying both keys instead of the second overwriting the first.
 *
 * **The guard is planned whenever the manifest declares no `devEngines.packageManager` and a versioned
 * pnpm pin is established**, whichever of the two established it (0030):
 *
 * - the pin is written by this plan, so the guard rides on the pin's bytes and carries its version;
 * - the manifest already declares the pin and this plan keeps it, so the guard rides on the manifest's
 *   own bytes and carries the version that declaration names — never the answering one;
 * - the pin is a conflict, so nothing establishes a version and no guard is planned. The two
 *   declarations are then never written disagreeing.
 *
 * Nothing is emitted for a file this plan would not touch: a repository carrying both declarations gets
 * no `package.json` item at all.
 *
 * @param {object} ctx
 * @param {{ version?: string | null, pinFailing?: boolean }} [options] `version` is what the pin writes
 *   when `pinFailing`, and `pinFailing` is the rule's own verdict on the declaration
 * @returns {Array<object>} plan items
 */
export function planPackageManagerWrites(ctx, { version = null, pinFailing = false } = {}) {
  const packageJsonText = ctx?.repo?.files?.packageJson?.text ?? null;
  const packageJson = ctx?.repo?.files?.packageJson?.json ?? null;
  const items = [];

  let guardInput = packageJsonText;
  let established = null;

  if (pinFailing) {
    const pin = writePackageManagerPin({ packageJsonText, version });
    const pinItem = planTarget(ctx, {
      relative: PACKAGE_JSON_RELATIVE,
      operation: 'set packageManager',
      result: pin,
    });
    items.push(pinItem);

    // A conflict — the writer's or the write-target guard's — is the whole answer: nothing establishes
    // the version the guard would carry.
    if (pinItem.state === 'conflict') return items;

    established = version;
    if (pin.ok === true && pin.state === 'would-write') guardInput = pin.content;
  } else {
    // The declaration this plan keeps is the one that establishes the version.
    established = declaredPinVersion(packageJson);
    if (established === null) return items;
  }

  if (typeof established !== 'string' || established === '') return items;

  const guard = writeDevEnginesPackageManager({
    packageJsonText: guardInput,
    version: established,
  });
  const guardItem = planTarget(ctx, {
    relative: PACKAGE_JSON_RELATIVE,
    operation: 'set devEngines.packageManager',
    result: guard,
  });

  // Already at policy with nothing else over this file: no item, because this plan would not touch it.
  if (items.length === 0 && guardItem.state === 'would-skip') return items;

  items.push(guardItem);
  return items;
}

/**
 * W4: persist `{ "preset": "strict" }` in `funky-secure.config.json` so CI agrees (RFC 11.2).
 *
 * The write never replaces what the file already declares: any other preset, or any other key the
 * document would drop, is a conflict. A file that already declares exactly this preset is a
 * `would-skip` and keeps its own formatting.
 *
 * @param {{ existingConfigText?: string | null }} [options]
 * @returns {{ ok: true, operation: string, content: string, reason: string, state: string } | { ok: false, state: 'conflict', reason: string, key: string }}
 */
export function writeStrictConfig({ existingConfigText = null } = {}) {
  const operation = 'set preset';
  const content = `${JSON.stringify({ preset: 'strict' }, null, 2)}\n`;
  const text = typeof existingConfigText === 'string' ? existingConfigText : null;

  if (text === null) {
    return {
      ok: true,
      operation,
      content,
      reason: 'persists preset "strict" so CI agrees',
      state: 'would-write',
    };
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      state: 'conflict',
      reason: `${CONFIG_RELATIVE} is not valid JSON; it is not overwritten`,
      key: 'preset',
    };
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return {
      ok: false,
      state: 'conflict',
      reason: `${CONFIG_RELATIVE} does not contain a JSON object; it is not overwritten`,
      key: 'preset',
    };
  }

  const keys = Object.keys(json);
  const declaresPreset = Object.hasOwn(json, 'preset');

  if (keys.length === 1 && declaresPreset && json.preset === 'strict') {
    return {
      ok: true,
      operation,
      content: text,
      reason: 'the repository already declares preset "strict"',
      state: 'would-skip',
    };
  }

  if (keys.length === 0) {
    return {
      ok: true,
      operation,
      content,
      reason: 'persists preset "strict" so CI agrees',
      state: 'would-write',
    };
  }

  const others = keys.filter((key) => key !== 'preset');
  const declared = declaresPreset ? `preset ${JSON.stringify(json.preset)}` : null;
  const detail =
    declared !== null && others.length > 0
      ? `${declared} and ${others.join(', ')}`
      : (declared ?? others.join(', '));

  return {
    ok: false,
    state: 'conflict',
    reason: `${CONFIG_RELATIVE} already declares ${detail}; writing { "preset": "strict" } would replace it`,
    key: declaresPreset ? 'preset' : others[0],
  };
}

/**
 * The W4 plan item. Init owns this write, but the decision lives here so `planFor` and `init` cannot
 * disagree. `configText` is `null` when the file is absent, a string when it exists, and
 * `undefined` when it exists but could not be read (never treated as absent).
 *
 * @param {object} ctx
 * @param {{ configText?: string | null, existingPath?: string | null }} [options]
 * @returns {object | null} plan item
 */
export function planStrictConfig(ctx, { configText = null, existingPath = null } = {}) {
  const operation = 'set preset';

  if (configText === undefined) {
    return planTarget(ctx, {
      relative: CONFIG_RELATIVE,
      operation,
      result: {
        ok: false,
        state: 'conflict',
        reason: `${CONFIG_RELATIVE} exists but could not be read; it is not overwritten`,
        key: 'preset',
      },
    });
  }

  if (typeof existingPath === 'string') {
    const root = ctx?.repo?.root ?? ctx?.cwd;
    if (typeof root === 'string' && resolve(existingPath) !== resolve(root, CONFIG_RELATIVE)) {
      return planTarget(ctx, {
        relative: CONFIG_RELATIVE,
        operation,
        result: {
          ok: false,
          state: 'conflict',
          reason: `a config already exists at ${existingPath}; a second one at the repository root would shadow it`,
          key: 'preset',
        },
      });
    }
  }

  return planTarget(ctx, {
    relative: CONFIG_RELATIVE,
    operation,
    result: writeStrictConfig({ existingConfigText: configText }),
  });
}

/**
 * Every write the RFC authorizes for this run, in W1..W4 order: a convenience for callers that hold
 * a context and a report. Conditions follow RFC 11.2 and 11.2.1 — W1a when this repository's managed
 * block does not declare the gate, whatever the machine applies, W1b when the preset is `strict`, W1c
 * when the block does not carry `savePrefix: ''`, W2 when `sensitive-ignored` failed, W3 and W3b when
 * `package-manager-pin` failed (a conflicting pin becomes a conflict item and plans no guard), W3b alone
 * when the pin passes and the manifest declares no guard, and W4 when the preset is `strict`. Without a
 * report the rule-driven writes (W2, W3) are not planned: no finding, no fix; the guard follows the pin
 * itself, which the manifest already declares.
 *
 * @param {object} ctx
 * @param {{ policy?: object, severity?: object, report?: object, configText?: string | null, configPath?: string | null }} [options]
 * @returns {Array<object>} plan items
 */
export function planFor(
  ctx,
  { policy = {}, report, configText = null, configPath = null } = {},
) {
  if (ctx?.repo === null || ctx?.repo === undefined) return [];

  const items = [];
  const preset = policy.preset === 'strict' ? 'strict' : 'baseline';
  const block = workspaceBlockFacts(ctx.repo.files?.workspaceYaml?.text ?? null);

  // W1a, W1b, W1c: the repository's own block is the condition, never the effective strictness.
  if (!block.gate || !block.savePrefix || preset === 'strict') {
    items.push(
      planTarget(ctx, {
        relative: WORKSPACE_RELATIVE,
        operation: 'managed block',
        result: writeQuarantineGate({
          workspaceYaml: ctx.repo.files?.workspaceYaml?.text ?? null,
          exists: (ctx.repo.present ?? []).includes(WORKSPACE_RELATIVE),
          preset,
        }),
      }),
    );
  }

  // W2: sensitive-ignored failed.
  const sensitiveFailed = findingsOf(report, 'sensitive-ignored').some(
    (finding) => finding.status === 'fail',
  );
  if (sensitiveFailed) {
    items.push(
      planTarget(ctx, {
        relative: GITIGNORE_RELATIVE,
        operation: 'managed block',
        result: writeGitignoreBlock({
          gitignore: ctx.repo.files?.gitignore?.text ?? null,
          exists: (ctx.repo.present ?? []).includes(GITIGNORE_RELATIVE),
          trackedNpmrc: trackedNpmrcFacts(ctx),
        }),
      }),
    );
  }

  // W3: package-manager-pin failed without a conflict (a conflict is reported, never written).
  const pinFailed = findingsOf(report, 'package-manager-pin').some(
    (finding) =>
      finding.status === 'fail' &&
      (finding.code === 'pin-missing' || finding.code === 'pin-conflict'),
  );
  // W3 and W3b: the pin when the rule failed, and the guard beside it whenever a versioned pnpm pin is
  // established and the manifest declares none — a pin-by-pin decision, so a failing and a passing pin
  // are two inputs to one derivation instead of two conditions in two places.
  items.push(
    ...planPackageManagerWrites(ctx, {
      version: ctx.machine?.version ?? null,
      pinFailing: pinFailed,
    }),
  );

  // W4: the strict preset persists itself.
  if (preset === 'strict') {
    items.push(planStrictConfig(ctx, { configText, existingPath: configPath }));
  }

  return items;
}
