/**
 * `migrate` (RFC 11.3, 4.6): the five-step plan for leaving npm or yarn behind.
 *
 * The tool never runs steps 1-3 or 5. `--apply` performs step 4 only: it removes the foreign
 * lockfile(s) after re-checking every precondition (RFC 11.5 point 4), and refuses with the action a
 * human must take first, followed by the reason (S5) — never a silent no-op.
 */

import { lstat, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { ConfigError, RefusalError } from '../lib/errors.js';
import { defaultBranch, statusPorcelain } from '../lib/git.js';
import { validateWriteTarget } from '../lib/paths.js';
import { collectScan } from '../lib/scan.js';
import { FOREIGN_LOCKFILES } from '../lib/targets.js';
import { catalog as defaultCatalog } from '../rules/index.js';

/** `.npmrc` keys pnpm no longer reads, and where the same decision does work (RFC 1.3, 4.1, E8). */
const REPORT_ONLY_KEYS = Object.freeze([
  {
    key: 'minimum-release-age',
    works: 'minimumReleaseAge in pnpm-workspace.yaml (or the pnpm global config)',
  },
  {
    key: 'save-exact',
    works: 'saveExact in the pnpm global config (pnpm config set save-exact true --location=global)',
  },
  {
    key: 'ignore-scripts',
    works: 'ignoreScripts in pnpm-workspace.yaml (or the pnpm global config)',
  },
]);

const SECRET_LINE = /(?:^|[\s"'=])(?:[A-Za-z0-9_]*?(?:TOKEN|SECRET|PASSWORD|_AUTH)[A-Za-z0-9_]*)\s*[:=]/i;

/**
 * The branch names the RFC 11.3 fallback treats as a default branch when no remote HEAD can be read.
 * Matching one of them is a refusal, and the refusal says that the check is a fallback.
 */
const FALLBACK_DEFAULT_BRANCHES = Object.freeze(['main', 'master']);

/** Why a catalog path may not be removed here (RFC 11.5 points 2-4), in the user's words. */
const TARGET_REFUSALS = Object.freeze({
  'not-relative': 'the path is not a repository-relative path',
  'basename-mismatch': 'the resolved file name does not match the lockfile catalog entry',
  unresolvable: 'the file or its directory cannot be resolved',
  'outside-root': 'the file resolves outside the repository root',
});

/**
 * A refusal that leads with the action (S5). `cli.run` prints `action` on the first line and the
 * diagnosis after a `reason:` label, so the diagnosis stays the error message.
 *
 * The distinction this file has to make: a refusal (exit 3) is a decision about a situation the tool
 * understood — the branch is the default one, the tree is dirty, the only lockfile would be deleted.
 * An unanswered question (exit 2) is a situation it could not read, and `unanswered` below names those.
 * @param {string} action what the human must do first
 * @param {string} message the internal diagnosis
 * @returns {RefusalError}
 */
function refusal(action, message) {
  return new RefusalError(message, action);
}

/**
 * The other half of the same distinction: the tool asked git and git did not answer, so there was no
 * situation to decide about and nothing was refused (exit 2).
 * @param {string} action what the human must do first
 * @param {string} message the internal diagnosis
 * @returns {ConfigError}
 */
function unanswered(action, message) {
  const error = new ConfigError(message);
  error.action = action;
  return error;
}

/** The action of a branch precondition: the removal only makes sense on a feature branch (S5). */
const FEATURE_BRANCH_ACTION = 'switch to a feature branch and re-run migrate --apply';

function npmrcLines(text) {
  if (typeof text !== 'string') return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith(';'));
}

function npmrcKey(line) {
  const equals = line.indexOf('=');
  return (equals === -1 ? line : line.slice(0, equals)).trim();
}

function resolvedOrigin({ from, foreign }) {
  if (from !== 'auto') return from;
  if (foreign.includes('yarn.lock')) return 'yarn';
  if (foreign.includes('package-lock.json')) return 'npm';
  if (foreign.some((name) => name.startsWith('bun.lock'))) return 'bun';
  return 'unknown';
}

function workflowSuggestions(workflows) {
  const suggestions = [];
  for (const workflow of workflows) {
    const lines = workflow.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/\b(?:npm|yarn)\b/i.test(line)) return;
      if (SECRET_LINE.test(line)) return;
      suggestions.push({ path: workflow.path, line: index + 1, text: line.trim() });
    });
  }
  return suggestions;
}

/**
 * Step 4 (RFC 11.3): remove the foreign lockfile(s), or refuse with the reason.
 *
 * Every precondition is checked here, again, immediately before the removal (RFC 11.5 point 4), and a
 * refusal always writes nothing. The paths come from `ctx.repo.present` filtered by the fixed lockfile
 * catalog, never from an argument or from a repository string.
 *
 * @param {object} options
 * @param {string} options.root resolved worktree root
 * @param {string} options.cwd
 * @param {string[]} options.foreign foreign lockfiles present at the root
 * @param {boolean} options.hasPnpmLock
 * @param {string | null} options.branch the current branch, as `repoFacts` resolved it
 * @param {boolean} options.allowDirty
 * @param {object} options.collector
 * @param {object} options.stdout
 * @returns {Promise<number>} exit code
 */
async function applyRemoval({ root, cwd, foreign, hasPnpmLock, branch, allowDirty, collector, stdout }) {
  if (foreign.length === 0) {
    // Nothing is at risk, so this is not a refusal: it is the honest answer for an already-migrated
    // repository. It is printed, so it is never a silent no-op.
    stdout.write('nothing to remove: no foreign lockfile is present\n');
    return 0;
  }

  const names = foreign.join(', ');

  if (!hasPnpmLock) {
    throw refusal(
      'create pnpm-lock.yaml first (run pnpm install), then re-run migrate --apply',
      `refusing to remove ${names}: pnpm-lock.yaml is absent (never delete the only lockfile)`,
    );
  }

  if (!allowDirty) {
    const paths = foreign.map((name) => relative(cwd, join(root, name)));
    const dirty = await statusPorcelain(collector, paths);
    if (dirty === null) {
      throw unanswered(
        'pass --allow-dirty, or fix git so git status answers, then re-run',
        `refusing to remove ${names}: git could not report the working tree status (git status --porcelain -z failed)`,
      );
    }
    const touched = [...new Set(dirty.map((entry) => entry.slice(3)))];
    if (touched.length > 0) {
      throw refusal(
        `commit ${touched.join(', ')} or pass --allow-dirty, then re-run`,
        `refusing to remove ${names}: uncommitted changes for ${touched.join(', ')} (git status --porcelain -z)`,
      );
    }
  }

  if (branch === null) {
    throw unanswered(
      'check out a feature branch and re-run migrate --apply',
      `refusing to remove ${names}: git could not resolve the current branch (git rev-parse --abbrev-ref HEAD failed)`,
    );
  }
  if (branch === 'HEAD') {
    throw refusal(
      'check out a branch and re-run migrate --apply',
      `refusing to remove ${names}: HEAD is detached`,
    );
  }

  const base = await defaultBranch(collector);
  if (base === null) {
    if (FALLBACK_DEFAULT_BRANCHES.includes(branch)) {
      throw refusal(
        FEATURE_BRANCH_ACTION,
        `refusing to remove ${names}: the current branch ${branch} matches the main/master check, which is a fallback because refs/remotes/origin/HEAD could not be read (the repository has no remote)`,
      );
    }
  } else if (branch === base) {
    throw refusal(
      FEATURE_BRANCH_ACTION,
      `refusing to remove ${names}: the current branch ${branch} is the default branch, read from refs/remotes/origin/HEAD`,
    );
  }

  const removed = [];
  const approved = [];

  // Validation runs over the whole set before the first deletion: a refusal on the third lockfile
  // must not leave the first two gone, because step 4 has no rollback (RFC 11.4).
  for (const name of foreign) {
    const path = join(root, name);
    const target = validateWriteTarget({ root, relative: name, expectedBasename: name });
    if (!target.ok) {
      throw refusal(
        `remove ${name} by hand if it is the foreign lockfile you meant to delete`,
        `refusing to remove ${path}: ${TARGET_REFUSALS[target.reason] ?? target.reason}`,
      );
    }
    let info;
    try {
      info = await lstat(path);
    } catch {
      throw refusal(
        're-run migrate --apply to re-read the lockfiles',
        `refusing to remove ${path}: it disappeared before the removal`,
      );
    }
    if (!info.isFile()) {
      throw refusal(
        `remove ${path} by hand if it is a lockfile you meant to delete`,
        `refusing to remove ${path}: it is not a regular file (step 4 removes files only)`,
      );
    }
    approved.push({ name, path });
  }

  for (const { name, path } of approved) {
    stdout.write(`remove  ${path}\n`);
    await rm(path);
    removed.push(name);
  }

  stdout.write(`step 4 complete: removed ${removed.join(', ')}\n`);
  return 0;
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {object} options.env
 * @param {object} options.stdout
 * @param {string} [options.from]
 * @param {boolean} [options.apply]
 * @param {boolean} [options.allowDirty] allow step 4 over uncommitted lockfile changes
 * @param {Array<object>} [options.catalog]
 * @param {object} [options.collector]
 * @returns {Promise<number>} exit code
 */
export async function run({
  cwd,
  env,
  stdout,
  from = 'auto',
  apply = false,
  allowDirty = false,
  catalog = defaultCatalog,
  collector,
}) {
  const { ctx, probes } = await collectScan({
    cwd,
    env,
    scope: 'repo',
    failOn: 'none',
    catalog,
    collector,
  });

  if (ctx.repo?.inGit !== true) {
    throw refusal(
      'run migrate inside a git worktree',
      'migrate needs a git repository: step 4 removes a tracked lockfile on a branch, and this directory is not inside one',
    );
  }

  const present = ctx.repo.present ?? [];
  const foreign = present.filter((name) => FOREIGN_LOCKFILES.includes(name));
  const packageJson = ctx.repo.files?.packageJson?.json ?? null;
  const packageManager =
    typeof packageJson?.packageManager === 'string' ? packageJson.packageManager : null;
  const npmrc = npmrcLines(ctx.repo.files?.npmrc?.text ?? '');
  const managerLines = npmrc.filter((line) =>
    /^(?:package-manager|package_manager|packageManager)\b/i.test(line),
  );

  const hasPnpmLock = present.includes('pnpm-lock.yaml');
  const origin = resolvedOrigin({ from, foreign });
  const reportOnly = REPORT_ONLY_KEYS.filter((entry) =>
    npmrc.some((line) => npmrcKey(line).toLowerCase() === entry.key),
  );
  const suggestions = workflowSuggestions(ctx.repo.workflows ?? []);

  const lines = [
    `funky-secure migrate  ·  from ${origin}${apply ? '  ·  apply' : '  ·  plan only (nothing has been written)'}`,
    '',
    '1. evidence',
    `   foreign lockfiles   ${foreign.length === 0 ? '(none present)' : foreign.join(', ')}`,
    `   packageManager      ${packageManager ?? '(not declared)'}`,
    `   .npmrc              ${managerLines.length === 0 ? '(no manager lines)' : managerLines.join(' / ')}`,
    '',
    '2. report-only .npmrc keys pnpm does not read',
  ];

  if (reportOnly.length === 0) {
    lines.push('   (none present)');
  } else {
    for (const entry of reportOnly) {
      lines.push(`   ${entry.key}  →  ${entry.works}`);
    }
  }

  lines.push(
    '',
    '3. human step (this tool never runs it)',
    foreign.includes('yarn.lock')
      ? '   pnpm import   # reads yarn.lock and writes pnpm-lock.yaml'
      : '   pnpm install   # resolves and downloads; writes pnpm-lock.yaml',
    '',
    '4. removal (only after pnpm-lock.yaml exists)',
    `   pnpm-lock.yaml      ${hasPnpmLock ? 'present' : 'absent — finish step 3 first'}`,
    `   would remove        ${foreign.length === 0 ? '(nothing)' : foreign.join(', ')}`,
    '',
    '5. ci follow-up (suggestions only)',
  );

  if (suggestions.length === 0) {
    lines.push('   (no workflow mentions npm or yarn)');
  } else {
    for (const suggestion of suggestions) {
      lines.push(`   ${suggestion.path}:${suggestion.line}  ${suggestion.text}`);
    }
  }

  lines.push('');
  stdout.write(`${lines.join('\n')}\n`);

  if (!apply) return 0;

  return applyRemoval({
    root: ctx.repo.root,
    cwd,
    foreign,
    hasPnpmLock,
    branch: ctx.repo.branch ?? null,
    allowDirty,
    collector: probes,
    stdout,
  });
}
