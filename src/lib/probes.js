/**
 * The closed probe list (RFC 12.1) and the measured win32 spawn mechanics (E7, 12.1).
 *
 * Every probe is spawned with an argument array and `shell: false`. A probe is never retried with
 * different arguments and never replaced by a second command: if the declared probe fails, the fact
 * is unavailable and the rules that need it report `skip` (or `error` under `--strict-probes`).
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { readFile as nodeReadFile } from 'node:fs/promises';
import { win32 } from 'node:path';

/** The closed list. Adding a probe is a reviewed change, not an incidental import. */
export const PROBES = Object.freeze([
  'pnpm --version',
  'pnpm config list --json',
  'where pnpm (win32) / which pnpm (POSIX)',
  'git rev-parse --show-toplevel',
  'git ls-files -z',
  'git check-ignore --no-index --stdin -z',
  'git ls-files --error-unmatch',
  'git status --porcelain -z',
  'git rev-parse --abbrev-ref HEAD',
  'git symbolic-ref --short refs/remotes/origin/HEAD',
  'bounded file reads',
]);

const MAX_OUTPUT = 8 * 1024 * 1024;

/**
 * Runs one process and resolves; it never rejects. A spawn failure is a fact, not an exception.
 * @param {string} file
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, input?: string, spawn?: Function, windowsVerbatimArguments?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, code?: number | null, stdout?: string, stderr?: string, error?: Error }>}
 */
export function runProcess(
  file,
  args,
  { cwd, env, input, spawn = nodeSpawn, windowsVerbatimArguments = false } = {},
) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let child;
    try {
      child = spawn(file, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments,
      });
    } catch (error) {
      settle({ ok: false, error, stdout, stderr });
      return;
    }

    child.on('error', (error) => settle({ ok: false, error, stdout, stderr }));
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString();
    });

    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(input ?? '');
    }

    child.on('close', (code) => settle({ ok: true, code, stdout, stderr }));
  });
}

function expandWindowsShim(text, shimPath, env) {
  // A win32 shim path is parsed with win32 rules wherever this runs: `dirname` from the host would
  // treat the backslashes of `C:\…\pnpm.cmd` as ordinary characters and expand `%~dp0` to garbage.
  const dp0 = `${win32.dirname(shimPath)}\\`;
  return text
    // `%~dp0` already carries the trailing separator in cmd semantics.
    .replace(/%~dp0\\?/gi, dp0)
    .replace(/%([A-Za-z0-9_()]+)%/g, (match, name) => env[name] ?? env[name.toUpperCase()] ?? match);
}

/**
 * Finds the real executable a win32 `.cmd`/`.ps1` shim delegates to (E7).
 *
 * `C:\…\pnpm\bin\` holds only shims; the native executable lives behind a content-hashed path
 * (`…\pnpm\global\v11\<hash>\node_modules\@pnpm\exe\pnpm.exe`) and is only discoverable from the
 * shim's own `%~dp0` line. When the shim names nothing usable the answer is `null`, never a guess.
 *
 * @param {string} text shim contents
 * @param {string} shimPath absolute path of the shim, for expanding `%~dp0`
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function executableFromShim(text, shimPath, env = process.env) {
  const expanded = expandWindowsShim(text, shimPath, env);
  const candidates = [...expanded.matchAll(/([A-Za-z]:[\\/][^"'\r\n]*?\.exe)/gi)]
    .map((match) => match[1].trim())
    .filter((value) => value !== '');

  return (
    candidates.find((value) => /@pnpm[\\/]exe[\\/]pnpm\.exe$/i.test(value)) ??
    candidates.find((value) => /[\\/]pnpm\.exe$/i.test(value)) ??
    null
  );
}

/**
 * Resolves the pnpm answering on this machine without `shell: true` (E7).
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, spawn?: Function, readText?: (path: string) => Promise<string>, cwd?: string }} [options]
 * @returns {Promise<{ file: string, prefixArgs: string[], installations: string[], source: string } | { file: null, reason: string, installations: string[], source: string }>}
 */
export async function resolvePnpm({
  platform = process.platform,
  env = process.env,
  spawn = nodeSpawn,
  readText = (path) => nodeReadFile(path, 'utf8'),
  cwd,
} = {}) {
  const isWindows = platform === 'win32';
  const source = isWindows ? 'where pnpm' : 'which pnpm';
  const listing = await runProcess(isWindows ? 'where' : 'which', ['pnpm'], { cwd, env, spawn });

  if (!listing.ok || listing.code !== 0) {
    return { file: null, reason: 'not-on-path', installations: [], source };
  }

  const installations = listing.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const path of installations) {
    if (/\.exe$/i.test(path)) {
      return { file: path, prefixArgs: [], installations, source };
    }
    if (isWindows && /\.(cmd|bat|ps1)$/i.test(path)) {
      let text;
      try {
        text = await readText(path);
      } catch {
        continue;
      }
      const target = executableFromShim(text, path, env);
      if (target !== null) {
        return { file: target, prefixArgs: [], installations, source };
      }
    }
    if (!isWindows) {
      // A POSIX shim is executable on its own; a shebang is enough for `shell: false`.
      return { file: path, prefixArgs: [], installations, source };
    }
  }

  return { file: null, reason: 'unresolved-shim', installations, source };
}

/**
 * Builds the per-run collector. Every probe is cached; nothing is retried.
 * @param {{ cwd: string, platform?: string, env?: NodeJS.ProcessEnv, spawn?: Function, readText?: (path: string) => Promise<string> }} options
 */
export function createCollector({
  cwd,
  platform = process.platform,
  env = process.env,
  spawn = nodeSpawn,
  readText = (path) => nodeReadFile(path, 'utf8'),
} = {}) {
  const cache = new Map();
  const memo = (key, compute) => {
    if (!cache.has(key)) cache.set(key, compute());
    return cache.get(key);
  };

  const run = (file, args, options = {}) => runProcess(file, args, { cwd, env, spawn, ...options });
  const git = (args, options = {}) => run('git', args, options);
  const read = async (path) => {
    try {
      return { ok: true, value: await readText(path) };
    } catch (error) {
      return { ok: false, error };
    }
  };

  const pnpm = () => memo('pnpm', () => resolvePnpm({ platform, env, spawn, readText, cwd }));

  const pnpmVersion = () =>
    memo('pnpmVersion', async () => {
      const resolved = await pnpm();
      if (resolved.file === null) return { ok: false, reason: resolved.reason, installations: resolved.installations };
      const result = await run(resolved.file, [...resolved.prefixArgs, '--version']);
      if (!result.ok) return { ok: false, reason: 'spawn-failed', error: result.error };
      if (result.code !== 0) return { ok: false, reason: 'failed' };
      const version = (result.stdout ?? '').trim();
      const major = Number(version.split('.')[0]);
      if (!/^\d+\.\d+\.\d+/.test(version) || !Number.isInteger(major)) {
        return { ok: false, reason: 'unparsable' };
      }
      return {
        ok: true,
        version,
        major,
        executable: resolved.file,
        installations: resolved.installations,
      };
    });

  const pnpmConfig = () =>
    memo('pnpmConfig', async () => {
      const resolved = await pnpm();
      if (resolved.file === null) return { ok: false, reason: resolved.reason };
      const result = await run(resolved.file, [...resolved.prefixArgs, 'config', 'list', '--json']);
      if (!result.ok) return { ok: false, reason: 'spawn-failed', error: result.error };
      if (result.code !== 0) return { ok: false, reason: 'failed' };
      try {
        const config = JSON.parse(result.stdout ?? '');
        if (config === null || typeof config !== 'object' || Array.isArray(config)) {
          return { ok: false, reason: 'unparsable' };
        }
        return { ok: true, config };
      } catch {
        return { ok: false, reason: 'unparsable' };
      }
    });

  return { cwd, platform, env, run, git, read, pnpm, pnpmVersion, pnpmConfig };
}
