/**
 * `migrate` (RFC 11.3): the five-step plan for leaving npm or yarn behind.
 *
 * The tool never runs steps 1-3 or 5. `--apply` performs step 4 only, and only after
 * `pnpm-lock.yaml` exists; the removal itself lands with F3, so the apply path refuses today.
 */

import { ConfigError } from '../lib/errors.js';
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
 * @param {object} options
 * @param {string} options.cwd
 * @param {object} options.env
 * @param {object} options.stdout
 * @param {string} [options.from]
 * @param {boolean} [options.apply]
 * @param {boolean} [options.allowDirty] reserved for the F3 removal
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
  allowDirty = false, // reserved for the F3 removal
  catalog = defaultCatalog,
  collector,
}) {
  const { ctx } = await collectScan({
    cwd,
    env,
    scope: 'repo',
    failOn: 'none',
    catalog,
    collector,
  });

  if (ctx.repo?.inGit !== true) {
    throw new ConfigError(
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

  if (!hasPnpmLock) {
    throw new ConfigError(
      `refusing to remove ${foreign.length === 0 ? 'a foreign lockfile' : foreign.join(', ')}: pnpm-lock.yaml is absent (never delete the only lockfile)`,
    );
  }

  throw new ConfigError('refused: removing the foreign lockfile lands with F3');
}
