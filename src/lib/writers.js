/**
 * The five writes of `init --apply` (RFC 11.2): W1a, W1b, W2, W3 and W4.
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

import { upsertBlock } from './managed-block.js';
import { validateWriteTarget } from './paths.js';
import { planItem } from './plan.js';
import { QUARANTINE_STRICT_MINUTES } from './policy.js';

export const WORKSPACE_RELATIVE = 'pnpm-workspace.yaml';
export const GITIGNORE_RELATIVE = '.gitignore';
export const PACKAGE_JSON_RELATIVE = 'package.json';
export const CONFIG_RELATIVE = 'funky-secure.config.json';

/** The ignore entries R7 requires, in the order the block prints them (RFC 8.2 R7, 11.2). */
export const GITIGNORE_ENTRIES = Object.freeze([
  '.env',
  '.env.*',
  '!.env.example',
  '!.env.test.example',
  '*.pem',
  '*.key',
]);

const QUARANTINE_GATE_LINE = 'minimumReleaseAgeStrict: true';
const AUTH_TOKEN = /_authToken=/;

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
 * configuration was not available, so W1a cannot be planned from it.
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
    return { tracked: true, hasToken: resolved.hasToken === true };
  }
  if (resolved && resolved.tracked === false) {
    return { tracked: false, hasToken: resolved.hasToken === true };
  }
  const tracked = ctx?.repo?.tracked ?? null;
  if (tracked === null) return null;
  const text = ctx?.repo?.files?.npmrc?.text ?? null;
  return {
    tracked: tracked.has('.npmrc'),
    hasToken: typeof text === 'string' && AUTH_TOKEN.test(text),
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
 * W1a and W1b in one managed block of `pnpm-workspace.yaml`.
 *
 * `minimumReleaseAgeStrict: true` is always written (the gate flip). `minimumReleaseAge: 4320` is
 * written only for the strict preset, in the same block, so the file stays one unit of review.
 * A file that declares either key outside the block is a conflict: two sources for one setting is
 * the defect this product reports. A missing file is created with the block only — never a
 * `packages:` key — and the reason says the repository becomes a pnpm workspace root.
 *
 * @param {{ workspaceYaml?: string | null, preset?: string }} [options]
 * @returns {{ ok: true, operation: string, content: string, reason: string, state: string } | { ok: false, state: 'conflict', reason: string, key: string | null }}
 */
export function writeQuarantineGate({ workspaceYaml = null, preset = 'baseline' } = {}) {
  const existing = typeof workspaceYaml === 'string' ? workspaceYaml : null;
  const strictFloor = preset === 'strict';
  const body = [QUARANTINE_GATE_LINE];
  const keys = ['minimumReleaseAgeStrict'];
  if (strictFloor) {
    body.push(`minimumReleaseAge: ${QUARANTINE_STRICT_MINUTES}`);
    keys.push('minimumReleaseAge');
  }

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

  const values = strictFloor
    ? 'minimumReleaseAgeStrict: true and minimumReleaseAge: 4320'
    : 'minimumReleaseAgeStrict: true';
  const effect = strictFloor
    ? 'turn the quarantine into a gate and set the strict floor'
    : 'turns the quarantine into a gate';

  let reason;
  if (upserted.changed) {
    const creates = existing === null;
    reason = `${values} ${effect}${creates ? `; creating ${WORKSPACE_RELATIVE} makes this repository a pnpm workspace root` : ''}`;
  } else {
    reason = `the managed block already carries ${values}`;
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
export function writeGitignoreBlock({ gitignore = null, trackedNpmrc = null } = {}) {
  const existing = typeof gitignore === 'string' ? gitignore : null;
  const omitNpmrc =
    trackedNpmrc !== null && trackedNpmrc.tracked === true && trackedNpmrc.hasToken !== true;
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

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      state: 'conflict',
      reason: `${PACKAGE_JSON_RELATIVE} is not valid JSON; it is not rewritten`,
      key: 'packageManager',
    };
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return {
      ok: false,
      state: 'conflict',
      reason: `${PACKAGE_JSON_RELATIVE} does not contain a JSON object; it is not rewritten`,
      key: 'packageManager',
    };
  }

  if (typeof version !== 'string' || version === '') {
    return {
      ok: false,
      state: 'conflict',
      reason: 'no pnpm version answered, so there is no pin to write',
      key: 'packageManager',
    };
  }

  const target = `pnpm@${version}`;
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

  const indent = detectIndent(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  json.packageManager = target;
  let content = JSON.stringify(json, null, indent);
  if (eol === '\r\n') content = content.replace(/\n/g, '\r\n');
  if (text.endsWith('\n') || text.endsWith('\r')) content += eol;

  return {
    ok: true,
    operation,
    content,
    reason: `sets packageManager to "${target}"`,
    state: 'would-write',
  };
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
 * a context and a report. Conditions follow RFC 11.2 — W1a when the effective strictness is false,
 * W1b when the preset is `strict`, W2 when `sensitive-ignored` failed, W3 when
 * `package-manager-pin` failed (a conflicting pin becomes a conflict item), W4 when the preset is
 * `strict`. Without a report the rule-driven writes (W2, W3) are not planned: no finding, no fix.
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

  // W1a: the quarantine auto-approves instead of gating. W1b: the strict preset also asks for the
  // floor, whether or not the gate is already strict.
  if (quarantineStrictness(ctx) === false || preset === 'strict') {
    items.push(
      planTarget(ctx, {
        relative: WORKSPACE_RELATIVE,
        operation: 'managed block',
        result: writeQuarantineGate({
          workspaceYaml: ctx.repo.files?.workspaceYaml?.text ?? null,
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
  if (pinFailed) {
    items.push(
      planTarget(ctx, {
        relative: PACKAGE_JSON_RELATIVE,
        operation: 'set packageManager',
        result: writePackageManagerPin({
          packageJsonText: ctx.repo.files?.packageJson?.text ?? null,
          version: ctx.machine?.version ?? null,
        }),
      }),
    );
  }

  // W4: the strict preset persists itself.
  if (preset === 'strict') {
    items.push(planStrictConfig(ctx, { configText, existingPath: configPath }));
  }

  return items;
}
