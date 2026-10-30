/**
 * Target resolution (RFC 7.1) and the context every rule receives.
 *
 * A scan does not walk a repository: it resolves targets and reads a bounded, declared set of files
 * (RFC 12.1). Everything a rule needs is resolved here, once, so a rule stays pure.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, relative as relativePath } from 'node:path';

import { currentBranch, ignoredPaths, trackedFiles } from './git.js';
import { validateWriteTarget } from './paths.js';

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

/**
 * The lockfile is probed for its ignore state too, but it is the one path that must NOT be ignored:
 * keeping it out of `IGNORE_CANDIDATES` is what stops R7 from demanding that the lockfile be ignored
 * while letting R2 report a repository that hides its own lockfile (RFC 8.2 R2).
 */
export const PROBED_IGNORE_PATHS = [...IGNORE_CANDIDATES, 'pnpm-lock.yaml'];

export const FOREIGN_LOCKFILES = ['package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'];
export const BOT_CONFIGS = ['.github/dependabot.yml', '.github/renovate.json'];
export const EDITOR_FILES = ['.vscode/tasks.json', '.claude/settings.json'];

/**
 * The metadata filenames of a GitHub action, collected under `.github/actions/**` (RFC 7.1, S11).
 * Both spellings are read because GitHub reads either one for the same action; supporting only
 * `.yml` would make an action written as `action.yaml` invisible for no reason the user could see.
 */
export const ACTION_METADATA = ['action.yml', 'action.yaml'];

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

/**
 * What is wrong with a manifest this module could not interpret, or `null` when it read one (S4).
 *
 * The parse error was stored on the file record and read by nobody, so a truncated `package.json` or
 * one that opens with a byte-order mark produced no finding at all: every rule that needed the
 * manifest skipped, and the verdict was `pass`. The classification lives here, once, so the two rules
 * that read a manifest cannot describe the same file two different ways.
 *
 * A byte-order mark is not "invalid JSON": it is a mark the file starts with, JSON.parse refuses it,
 * and a reader told "not valid JSON" would go looking for a syntax error that is not there. It is
 * said in its own words, first, before the parse error it caused is considered.
 *
 * @param {{ text?: string, json?: unknown, error?: string } | null | undefined} file a file record
 * @returns {{ code: 'byte-order-mark' | 'invalid-json' | 'not-an-object', detail: string } | null}
 *   `detail` is a phrase that follows the file name: `package.json ${detail}` reads as one sentence.
 */
export function manifestProblem(file) {
  if (file === null || file === undefined) return null;
  const text = typeof file.text === 'string' ? file.text : '';
  if (text.startsWith('\uFEFF')) {
    return {
      code: 'byte-order-mark',
      detail: 'starts with a byte-order mark (U+FEFF), which JSON does not allow',
    };
  }
  if (typeof file.error === 'string' && file.error !== '') {
    return { code: 'invalid-json', detail: `is not valid JSON (${file.error})` };
  }
  const json = file.json;
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { code: 'not-an-object', detail: 'does not contain a JSON object' };
  }
  return null;
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
 * Single-level expansion of a `packages:` entry (RFC 7.1). A nested glob is reported, never silently
 * ignored, and an entry that leaves the repository root is refused before anything is read.
 *
 * The containment question is the one `paths.js` already answers for a write target, reused here
 * instead of a second check that could disagree with it: a `packages:` entry of `..` was expanded as a
 * plain path, so the scan read the parent manifest and reported `../package.json`, a file the
 * repository does not contain (S3).
 * @returns {{ dirs: string[], skipped: Array<{ entry: string, code: string, reason: string }> }}
 */
async function expandEntry(root, entry) {
  const cleaned = entry.replace(/\/+$/, '');
  // `unresolvable` is not a refusal: it means the parent directory does not exist, which is the
  // ordinary empty case below. `not-relative` and `outside-root` are the two answers that say this
  // entry would be read outside the repository, and both are refused under the name a reader sees.
  const guard = validateWriteTarget({ root, relative: cleaned });
  if (!guard.ok && (guard.reason === 'not-relative' || guard.reason === 'outside-root')) {
    return {
      dirs: [],
      skipped: [
        {
          entry,
          code: 'outside-root',
          reason: 'resolves outside the repository root, so the entry is not expanded',
        },
      ],
    };
  }
  if (!cleaned.includes('*')) return { dirs: [cleaned], skipped: [] };
  if (cleaned.split('*').length - 1 > 1 || cleaned.slice(cleaned.indexOf('*')).includes('/')) {
    return {
      dirs: [],
      skipped: [
        {
          entry,
          code: 'unsupported-glob',
          reason: 'a nested glob is not expanded, so its directories are not read',
        },
      ],
    };
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
export async function machineFacts(collector, { withConfig = true } = {}) {
  const version = await collector.pnpmVersion();
  // `--scope repo` is the supported CI gate (RFC 7.2): the answering version is still needed by
  // `package-manager-pin`, while the machine's store, registry and age policy stay out of contract.
  const configuration = withConfig ? await collector.pnpmConfig() : { ok: false, reason: 'out-of-scope' };

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
    configOutOfScope: !withConfig,
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

  const ignored = inGit ? await ignoredPaths(collector, PROBED_IGNORE_PATHS) : null;

  // A root `.npmrc` that is tracked and carries no token is the one legitimate exception to the
  // ignore requirement (RFC 8.2 R7): the rule must not demand that it be ignored, and the write that
  // fixes ignore coverage must not add it. The fact is resolved here, once, for both readers.
  const npmrcText = npmrc?.text ?? null;
  const npmrcTracked = tracked === null ? null : tracked.includes('.npmrc');
  const npmrcTokenlessTracked =
    npmrcTracked === true &&
    typeof npmrcText === 'string' &&
    !/(^|[^A-Za-z0-9])_authToken\s*=/m.test(npmrcText);

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

  // A composite action carries the same `steps:` a workflow job does, and its steps run in every
  // workflow that references it, so `.github/actions/**/action.y(a)ml` is CI too (S11). Only the
  // metadata file is read: a step's `uses:` never appears anywhere else in an action directory.
  const actionFiles = [];
  const actionsRoot = join(at, '.github', 'actions');
  try {
    const entries = await readdir(actionsRoot, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !ACTION_METADATA.includes(entry.name)) continue;
      const dir = entry.parentPath ?? entry.path;
      const nested = relativePath(actionsRoot, join(dir, entry.name)).replaceAll('\\', '/');
      const file = await readTextFile(collector, join(actionsRoot, nested));
      if (file === null) continue;
      actionFiles.push({ path: `.github/actions/${nested}`, text: file.text });
    }
  } catch {
    // no actions directory: no composite action to read
  }
  actionFiles.sort((a, b) => a.path.localeCompare(b.path));

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
  if (actionFiles.length > 0) targets.push({ kind: 'ci', path: '.github/actions' });
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
    npmrc: {
      tracked: npmrcTracked,
      hasToken: typeof npmrcText === 'string' && /(^|[^A-Za-z0-9])_authToken\s*=/m.test(npmrcText),
      tokenlessTracked: npmrcTokenlessTracked,
    },
    importers,
    workflows: workflowFiles,
    actionFiles,
    botFiles,
    editorFiles,
    skippedGlobs,
  };

  return { facts, targets };
}
