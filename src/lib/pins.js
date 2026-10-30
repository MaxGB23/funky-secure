/**
 * `funky-secure pin` (RFC 11.9): the exact-versions findings, turned into one write.
 *
 * The report says which specifiers float; the lockfile says what they resolved to. A pin writes the
 * version the lockfile already recorded — never a guessed one — so the change moves no package and
 * only removes the freedom to move later (RFC 4.9).
 *
 * Two shapes are deliberate:
 * - **One plan item per file.** `applyPlan` writes each item's whole content, so two items for one
 *   `package.json` would leave only the last one's edit behind.
 * - **Root importer only.** The scan collects a fixed set of files; a workspace importer's manifest is
 *   not among them, so those pins are reported as not written instead of read with a probe `pin` would
 *   be the only command to need.
 */

import { planTarget } from './writers.js';
import { parseLockfile, recordedVersion } from './lockfile.js';
import { DEPENDENCY_SECTIONS, isFloating } from './specifiers.js';

const PACKAGE_JSON = 'package.json';
/** The importer `pnpm-lock.yaml` uses for the repository root. */
const ROOT_IMPORTER = '.';

/** @param {string} text */
function detectIndent(text) {
  const match = text.match(/\n([ \t]+)"/);
  return match === null ? 2 : match[1];
}

/**
 * Every pin the root manifest needs, from the lockfile's own record.
 *
 * @param {{ packageJsonText?: string | null, lockfileText?: string | null }} options
 * @returns {{ pins: Array<{ section: string, name: string, from: string, to: string }>, exact: string[], unrecorded: string[], workspace: number, reason: string | null }}
 */
export function collectPins({ packageJsonText = null, lockfileText = null } = {}) {
  const empty = { pins: [], exact: [], unrecorded: [], workspace: 0, reason: null };
  if (typeof packageJsonText !== 'string') {
    return { ...empty, reason: `${PACKAGE_JSON} could not be read` };
  }
  let manifest;
  try {
    manifest = JSON.parse(packageJsonText);
  } catch {
    return { ...empty, reason: `${PACKAGE_JSON} is not valid JSON` };
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ...empty, reason: `${PACKAGE_JSON} does not contain a JSON object` };
  }

  const parsed = typeof lockfileText === 'string' ? parseLockfile(lockfileText) : null;
  const lock = parsed?.supported === true ? parsed.importers?.[ROOT_IMPORTER] ?? null : null;

  const pins = [];
  const exact = [];
  const unrecorded = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = manifest[section];
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      continue;
    }
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (!isFloating(specifier)) {
        // Counted, not ignored: a second run that writes nothing must still say the manifest is at
        // policy, or its summary claims zero of both and reads as if nothing had been checked (0013).
        if (typeof specifier === 'string') exact.push(`${name} (${section})`);
        continue;
      }
      const version = recordedVersion(lock, name, section);
      if (typeof version !== 'string' || version === '') {
        unrecorded.push(`${name} (${section})`);
        continue;
      }
      pins.push({ section, name, from: specifier, to: version });
    }
  }

  const workspace = Object.keys(parsed?.importers ?? {}).filter((key) => key !== ROOT_IMPORTER).length;
  return { pins, exact, unrecorded, workspace, reason: null };
}

/**
 * Adds the pins to one manifest, keeping its indentation and its line endings.
 *
 * A specifier that is not a plain string is left alone: `pin` rewrites the manifests it understands and
 * reports the rest, which is also why a conflict never reaches `applyPlan`.
 *
 * @param {string} text
 * @param {Array<{ section: string, name: string, to: string }>} pins
 * @returns {{ ok: true, content: string } | { ok: false, reason: string }}
 */
export function applyPins(text, pins) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${PACKAGE_JSON} is not valid JSON` };
  }

  for (const pin of pins) {
    const section = manifest?.[pin.section];
    if (section === null || typeof section !== 'object') {
      return { ok: false, reason: `${pin.section} disappeared while writing` };
    }
    section[pin.name] = pin.to;
  }

  const indent = detectIndent(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let content = JSON.stringify(manifest, null, indent);
  if (eol === '\r\n') content = content.replace(/\n/g, '\r\n');
  if (text.endsWith('\n') || text.endsWith('\r')) content += eol;
  return { ok: true, content };
}

/**
 * The plan `pin` prints and `--apply` performs.
 *
 * @param {{ ctx: object }} options
 * @returns {{ items: Array<object>, notes: string[] }}
 */
export function planPins({ ctx }) {
  const packageJsonText = ctx?.repo?.files?.packageJson?.text ?? null;
  const lockfileText = ctx?.repo?.files?.lockfile?.text ?? null;
  const collected = collectPins({ packageJsonText, lockfileText });

  if (collected.reason !== null) {
    return { items: [], notes: [collected.reason], pins: [] };
  }

  const notes = [];
  for (const missing of collected.unrecorded) {
    notes.push(`${missing} floats and the lockfile records no version, so it is not pinned`);
  }
  if (collected.workspace > 0) {
    notes.push(
      `${collected.workspace} workspace importer${collected.workspace === 1 ? '' : 's'} not pinned: their manifests are outside the files the scan collects`,
    );
  }

  if (collected.pins.length === 0) {
    // Nothing to write is a plan too. An item with `would-skip` is how the renderer says "this file is
    // already at policy", which is the truth here and what the old summary contradicted (0013).
    if (collected.exact.length === 0) return { items: [], notes, pins: [] };
    const count = collected.exact.length;
    return {
      items: [
        planTarget(ctx, {
          relative: PACKAGE_JSON,
          operation: 'keep exact versions',
          result: {
            ok: true,
            state: 'would-skip',
            reason: `${count} specifier${count === 1 ? ' is' : 's are'} already exact`,
          },
        }),
      ],
      notes,
      pins: [],
    };
  }

  const written = applyPins(packageJsonText, collected.pins);
  const result = written.ok
    ? {
        ok: true,
        operation: 'set exact versions',
        content: written.content,
        state: 'would-write',
        reason: `pins ${collected.pins.length} specifier${collected.pins.length === 1 ? '' : 's'} to the version pnpm-lock.yaml records`,
      }
    : { ok: false, state: 'conflict', reason: written.reason, key: null };

  return {
    items: [planTarget(ctx, { relative: PACKAGE_JSON, operation: 'set exact versions', result })],
    notes,
    pins: collected.pins,
  };
}
