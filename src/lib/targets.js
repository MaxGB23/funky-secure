/**
 * Target resolution (RFC 7.1) and the context every rule receives.
 *
 * A scan does not walk a repository: it resolves targets and reads a bounded, declared set of files
 * (RFC 12.1). Everything a rule needs is resolved here, once, so a rule stays pure.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { currentBranch, ignoredPaths, trackedFiles } from './git.js';

export const TARGET_KINDS = ['machine', 'repo-root', 'importer', 'ci', 'editor'];

/**
 * The candidate paths whose ignore behavior must be resolved before any rule runs (RFC 8.2 R7).
 * Declared here, once, so the collector runs a single bounded `git check-ignore` per scan and a rule
 * only reads a resolved fact.
 */
export const IGNORE_CANDIDATES = [
  '.env',
  '.env.local',
  '.env.production',
  'secrets.pem',
  'server.key',
  '.npmrc',
];

export const FOREIGN_LOCKFILES = ['package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'];
export const BOT_CONFIGS = ['.github/dependabot.yml', '.github/renovate.json'];
export const EDITOR_FILES = ['.vscode/tasks.json', '.claude/settings.json'];

/**
 * @param {string} version
 * @returns {number | null}
 */
export function majorOf(version) {
  if (typeof version !== 'string') return null;
  const major = Number(version.split('.')[0]);
  return Number.isInteger(major) ? major : null;
}

function parseJson(text) {
  try {
    return { json: JSON.parse(text), error: null };
  } catch (error) {
    return { json: null, error: error.message };
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {ReturnType<import('./probes.js').createCollector>} collector
 * @param {string} path
 * @returns {Promise<{ path: string, text: string, json?: object, error?: string } | null>}
 */
async function readJsonFile(collector, path) {
  const read = await collector.read(path);
  if (!read.ok) return null;
  const parsed = parseJson(read.value);
  return { path, text: read.value, ...parsed };
}

async function readTextFile(collector, path) {
  const read = await collector.read(path);
  return read.ok ? { path, text: read.value } : null;
}

/**
 * Single-level expansion of a `packages:` entry (RFC 7.1). A nested glob is reported, never
 * silently ignored.
 * @returns {{ dirs: string[], skipped: string[] }}
 */
async function expandEntry(root, entry) {
  const cleaned = entry.replace(/\/+$/, '');
  if (!cleaned.includes('*')) return { dirs: [cleaned], skipped: [] };
  if (cleaned.split('*').length - 1 > 1 || cleaned.slice(cleaned.indexOf('*')).includes('/')) {
    return { dirs: [], skipped: [entry] };
  }

  const [prefix, suffix] = cleaned.split('*');
  const base = join(root, prefix);
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return { dirs: [], skipped: [] };
  }

  const dirs = entries
    .filter((item) => item.isDirectory())
    .map((item) => `${prefix}${item.name}${suffix ?? ''}`)
    .filter((dir) => dir !== '')
    .sort();
  return { dirs, skipped: [] };
}

/**
 * Reads the `packages:` list from `pnpm-workspace.yaml` by lines, not with a YAML parser (RFC 4.7).
 * @param {string} text
 * @returns {{ entries: string[] }}
 */
export function workspacePackageEntries(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let inPackages = false;

  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    if (/^\S/.test(line)) {
      inPackages = /^packages\s*:/.test(line);
      continue;
    }
    if (!inPackages) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item === null) continue;
    const value = item[1].trim().replace(/^['"]|['"]$/g, '');
    if (value !== '') entries.push(value);
  }

  return { entries };
}

/**
 * Resolves the machine facts of RFC 12.1/12.2. A missing probe yields `available: false`; the
 * version ambiguity between `--version` and the reported `userAgent` is reported, never resolved by
 * picking one.
 */
export async function machineFacts(collector) {
  const [version, configuration] = await Promise.all([
    collector.pnpmVersion(),
    collector.pnpmConfig(),
  ]);

  const config = configuration.ok ? configuration.config : null;
  const userAgent = typeof config?.userAgent === 'string' ? config.userAgent : null;
  const reported = userAgent?.match(/pnpm\/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  const observed = version.ok ? version.version : null;

  const facts = {
    available: version.ok || configuration.ok,
    version: observed,
    major: observed === null ? null : majorOf(observed),
    executable: version.ok ? version.executable : null,
    installations: version.ok ? version.installations : [],
    config,
    storePath: typeof config?.storeDir === 'string' ? config.storeDir : null,
    userAgent,
    reportedVersion: reported,
    versionAmbiguous: observed !== null && reported !== null && observed !== reported,
  };

  const targets = [];
  if (facts.version !== null) {
    const detail =
      facts.storePath === null
        ? `pnpm ${facts.version} (${facts.executable})`
        : `pnpm ${facts.version} (${facts.executable})  ·  store ${facts.storePath}`;
    targets.push({ kind: 'machine', detail });
  } else if (facts.available) {
    targets.push({ kind: 'machine', detail: 'pnpm configuration read; version unavailable' });
  } else {
    targets.push({ kind: 'machine', detail: 'pnpm unavailable on this machine' });
  }
  if (facts.versionAmbiguous) {
    targets.push({
      kind: 'machine',
      detail: `version ambiguity: pnpm --version answered ${facts.version}, configuration reports pnpm/${facts.reportedVersion}`,
    });
  }

  return { facts, targets };
}

/**
 * Resolves repository targets and the bounded reads rules consume.
 * @param {{ collector: ReturnType<import('./probes.js').createCollector>, cwd: string, root?: string | null }} options
 */
export async function repoFacts({ collector, cwd, root = null }) {
  const inGit = root !== null;
  const at = inGit ? root : cwd;

  const [packageJson, workspaceYaml, lockfile, npmrc, gitignore, tracked, branch] =
    await Promise.all([
      readJsonFile(collector, join(at, 'package.json')),
      readTextFile(collector, join(at, 'pnpm-workspace.yaml')),
      readTextFile(collector, join(at, 'pnpm-lock.yaml')),
      readTextFile(collector, join(at, '.npmrc')),
      readTextFile(collector, join(at, '.gitignore')),
      inGit ? trackedFiles(collector) : Promise.resolve(null),
      inGit ? currentBranch(collector) : Promise.resolve(null),
    ]);

  const present = [];
  for (const name of ['pnpm-lock.yaml', ...FOREIGN_LOCKFILES, 'pnpm-workspace.yaml', 'package.json']) {
    if (await exists(join(at, name))) present.push(name);
  }

  const ignored = inGit ? await ignoredPaths(collector, IGNORE_CANDIDATES) : null;

  const importers = [];
  const importerTargets = [];
  if (packageJson !== null) {
    importers.push({ ...packageJson, dir: '.' });
    importerTargets.push({ kind: 'importer', path: '.' });
  }

  const skippedGlobs = [];
  if (workspaceYaml !== null) {
    const { entries } = workspacePackageEntries(workspaceYaml.text);
    for (const entry of entries) {
      const { dirs, skipped } = await expandEntry(at, entry);
      skippedGlobs.push(...skipped);
      for (const dir of dirs) {
        const file = await readJsonFile(collector, join(at, dir, 'package.json'));
        if (file === null) continue;
        importers.push({ ...file, dir });
        importerTargets.push({ kind: 'importer', path: `${dir}/package.json` });
      }
    }
  }
  importerTargets.sort((a, b) => (a.path === '.' ? -1 : b.path === '.' ? 1 : a.path.localeCompare(b.path)));

  const workflowFiles = [];
  try {
    const entries = await readdir(join(at, '.github', 'workflows'), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
      const file = await readTextFile(collector, join(at, '.github', 'workflows', entry.name));
      if (file === null) continue;
      workflowFiles.push({ path: `.github/workflows/${entry.name}`, text: file.text });
    }
  } catch {
    // no workflows directory: no ci target
  }
  workflowFiles.sort((a, b) => a.path.localeCompare(b.path));

  const botFiles = [];
  for (const path of BOT_CONFIGS) {
    if (await exists(join(at, path))) botFiles.push(path);
  }
  const editorFiles = [];
  for (const path of EDITOR_FILES) {
    if (await exists(join(at, path))) editorFiles.push(path);
  }

  const targets = [];
  if (inGit || packageJson !== null) targets.push({ kind: 'repo-root', path: '.' });
  targets.push(...importerTargets);
  if (workflowFiles.length > 0) targets.push({ kind: 'ci', path: '.github/workflows' });
  if (editorFiles.length > 0) targets.push({ kind: 'editor', path: '.' });

  const facts = {
    root: at,
    inGit,
    branch,
    files: {
      packageJson,
      workspaceYaml,
      lockfile,
      npmrc,
      gitignore,
    },
    present,
    tracked: tracked === null ? null : new Set(tracked),
    ignoreCandidates: IGNORE_CANDIDATES,
    ignored,
    importers,
    workflows: workflowFiles,
    botFiles,
    editorFiles,
    skippedGlobs,
  };

  return { facts, targets };
}
