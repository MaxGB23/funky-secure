/**
 * The write plan (RFC 11.2): items, both renderings, and the only write path in the product.
 *
 * A plan item is derived from a rule that knows how to fix what it reported; the writer itself is
 * generic. Nothing here chooses *where* to write — the target comes from the closed catalog of the
 * RFC, and `paths.js` validates containment before the bytes leave the process.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';

import { ConfigError } from './errors.js';
import { statusPorcelain } from './git.js';

export const PLAN_STATES = ['would-write', 'would-skip', 'conflict'];

/** @param {string} content */
export function digestOf(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * @param {{ target: string, operation: string, path: string, content?: string | null, state?: string, reason?: string }} item
 */
export function planItem({ target, operation, path, content = null, state = 'would-write', reason = '' }) {
  return {
    target,
    operation,
    path,
    digest: content === null ? null : digestOf(content),
    reason,
    state,
    content,
  };
}

/**
 * Collects the plan items of every active rule that can plan (RFC 11.2).
 * @param {{ ctx: object, policy: object, catalog: Array<object>, report?: object }} options
 */
export function derivePlan({ ctx, policy, catalog = [], report }) {
  const items = [];
  for (const rule of catalog) {
    if (!policy.active.includes(rule.id)) continue;
    if (typeof rule.plan !== 'function') continue;
    for (const item of rule.plan(ctx, { policy, severity: policy.severities[rule.id], report })) {
      items.push(item);
    }
  }
  return items;
}

function serializable(item) {
  const { content, ...rest } = item;
  return rest;
}

/**
 * @param {{ tool: { name: string, version: string }, command: string, policy: object, plan: Array<object>, refused?: Array<object>, timestamp?: string }} options
 */
export function renderPlanJson({ tool, command, policy, plan, refused = [], timestamp }) {
  const document = {
    schemaVersion: 1,
    tool,
    command,
    policy: { preset: policy.preset, quarantineMinutes: policy.quarantineMinutes, failOn: policy.failOn },
    plan: plan.map(serializable),
    refused,
  };
  if (timestamp !== undefined) document.generatedAt = timestamp;
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * @param {{ command: string, preset: string, plan: Array<object>, refused?: Array<object> }} options
 */
export function renderPlanHuman({ command, preset, plan, refused = [], apply = false }) {
  const mode = apply ? 'applying the plan below' : 'plan only (nothing has been written)';
  const lines = [`funky-secure ${command}  ·  preset ${preset}  ·  ${mode}`, ''];

  if (plan.length === 0) {
    lines.push('nothing to apply', '');
  } else {
    const groups = [
      ['would write', 'would-write'],
      ['would not write', 'would-skip'],
      ['conflicts', 'conflict'],
    ];
    for (const [heading, state] of groups) {
      const items = plan.filter((item) => item.state === state);
      if (items.length === 0) continue;
      lines.push(heading);
      for (const item of items) {
        const reason = item.reason === '' ? '' : `   (${item.reason})`;
        lines.push(`  ${item.path}`, `    ${item.operation}${reason}`);
      }
      lines.push('');
    }
  }

  for (const refusal of refused) lines.push(`refused  ${refusal.reason}`, '');

  const writes = plan.filter((item) => item.state === 'would-write').length;
  const skips = plan.filter((item) => item.state === 'would-skip').length;
  const conflicts = plan.filter((item) => item.state === 'conflict').length;
  lines.push(`summary  ${writes} write${writes === 1 ? '' : 's'} · ${skips} already at policy · ${conflicts} conflict${conflicts === 1 ? '' : 's'}`);

  return `${lines.join('\n')}\n`;
}

/**
 * The only place in the product that writes a file (RFC 11.2, 11.5).
 *
 * A dirty target is refused unless `--allow-dirty`: a security tool does not mix its edits with a
 * stranger's. Every write is printed before it happens, with its digest, in the same run.
 *
 * @param {{ plan: Array<object>, allowDirty?: boolean, cwd: string, collector: object, stdout: object }} options
 * @returns {Promise<number>} exit code
 */
export async function applyPlan({ plan, allowDirty = false, cwd, collector, stdout }) {
  const writes = plan.filter((item) => item.state === 'would-write');
  if (writes.length === 0) {
    stdout.write('nothing to apply\n');
    return 0;
  }

  if (!allowDirty) {
    const paths = writes.map((item) => relative(cwd, item.path));
    const dirty = await statusPorcelain(collector, paths);
    if (dirty === null) {
      throw new ConfigError('cannot check the working tree: git status failed');
    }
    const touched = dirty.filter((entry) => paths.includes(entry.slice(3)));
    if (touched.length > 0) {
      throw new ConfigError(
        `refusing to write over uncommitted changes: ${touched.map((entry) => entry.slice(3)).join(', ')} (commit them, or pass --allow-dirty)`,
      );
    }
  }

  for (const item of writes) {
    if (typeof item.content !== 'string') {
      throw new ConfigError(`plan item for ${item.path} carries no content`);
    }
    if (digestOf(item.content) !== item.digest) {
      throw new ConfigError(`plan item for ${item.path} changed after it was planned`);
    }
    stdout.write(`write  ${item.path}  ${item.operation}  ${item.digest}\n`);
    await mkdir(dirname(item.path), { recursive: true });
    await writeFile(item.path, item.content, 'utf8');
  }

  return 0;
}
