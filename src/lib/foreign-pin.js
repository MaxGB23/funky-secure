/**
 * The one flag that lets a pnpm step run under a `packageManager` naming another manager (0018).
 *
 * pnpm refuses every command with `ERR_PNPM_OTHER_PM_EXPECTED` when the manifest declares another
 * manager, and this tool never rewrites a declaration a human made (W3 refuses with a conflict). The
 * flag is the one pnpm answers to, measured on pnpm 12.3.4 under `"packageManager": "npm@11.13.0"`:
 * `pnpm --pm-on-fail=ignore import` and `pnpm --pm-on-fail=ignore install --lockfile-only` both exit
 * `0` where the same commands without it exit `1` (issue 111).
 *
 * The constant, the read of the manifest and the predicate live here, in one module, because a step
 * printed in two places is two answers the moment the condition is written twice: `start`'s numbered
 * path, `migrate`'s human step and the writers' next steps all print pnpm commands, and a reader who
 * obeys the nearest line instead of the ordered one is the defect issue 132 reports. A writer never
 * imports this module to decide *what* to write — the flag changes no file, only the text of a step a
 * human runs.
 *
 * The directory a step acts on lives here for the same reason (#535). A pnpm command acts on the nearest
 * project manifest at or above the directory it runs in, not on "the directory it runs in": from
 * `apps/web`, `pnpm add` writes `apps/web/package.json`. Every writer this tool plans acts on the
 * repository root, so a step printed for that project names it with `-C`, and the flag is computed once
 * so `start` and `pin` cannot spell one step two ways.
 */

import { pathsAtCwd } from './paths.js';

export const FOREIGN_PIN_FLAG = '--pm-on-fail=ignore';

/** The resolve that re-syncs the lockfile `pin` desynced on purpose (0011, 11.9), at the root. */
export const LOCKFILE_ONLY_STEP = 'pnpm install --lockfile-only';
/** The step that reads a foreign lockfile and writes `pnpm-lock.yaml` without resolving over the pins (0021). */
export const IMPORT_STEP = 'pnpm import';

/**
 * The `packageManager` string the repository's root manifest declares, or `null`.
 *
 * Read from the manifest the collector already resolved (L10), so the question costs no probe and the
 * three callers cannot disagree about which file the declaration came from. A value this reader cannot
 * interpret is not a declaration: the writes refuse it with a conflict, and the steps name no flag for
 * it.
 *
 * @param {object | null} repo
 * @returns {string | null}
 */
export function declaredPackageManager(repo) {
  const declared = repo?.files?.packageJson?.json?.packageManager;
  return typeof declared === 'string' ? declared : null;
}

/**
 * The manager `package.json` declares, when it is not pnpm.
 *
 * A declared pnpm pin, a declaration this reader cannot parse, and an absent declaration all yield
 * `null`: no step gains a flag for the manager the steps already name, and none pretends a pin exists.
 *
 * @param {string | null} declared the `packageManager` string the manifest carries, if any
 * @returns {string | null}
 */
export function declaredForeignManager(declared) {
  if (typeof declared !== 'string' || declared === '') return null;
  const name = declared.split('@')[0];
  if (name === '' || name === 'pnpm') return null;
  return declared;
}

/**
 * The suffix every pnpm step carries in this repository: ` --pm-on-fail=ignore`, or nothing.
 * @param {object | null} repo
 * @returns {string}
 */
export function pnpmFlag(repo) {
  return declaredForeignManager(declaredPackageManager(repo)) === null ? '' : ` ${FOREIGN_PIN_FLAG}`;
}

/**
 * The `-C <the repository root, from here>` a pnpm step carries, or the empty string.
 *
 * The value is the same arithmetic a printed `git add` path uses, so the two cannot disagree about how
 * far the root is: `pathsAtCwd` rebases a name and keeps the guard, and the guard is what makes a step
 * printed at the repository root byte-identical to the step printed before this existed (issue 210).
 * A repository the plan is derived from always contains the directory the reader stands in, so the
 * relative path never leaves it.
 *
 * @param {object | null} repo
 * @param {string | null} cwd the directory the step is pasted in
 * @returns {string}
 */
export function pnpmDirFlag(repo, cwd) {
  const [relative] = pathsAtCwd(['.'], repo?.root ?? null, cwd ?? null);
  if (typeof relative !== 'string' || relative === '' || relative === '.') return '';
  return ` -C ${relative}`;
}

/**
 * `pnpm install --lockfile-only` with the flag this repository's declaration requires: the step the
 * path prints after `pin --apply` and the step `pin` prints in its own next steps (11.2.2, 11.7, 11.9).
 *
 * It names the project the plan is about wherever the reader does not stand at it: `pin --apply` writes
 * the root manifest, so the resolve that re-records that write is the root's too, and a step pasted from
 * a member without `-C` would resolve the member instead.
 *
 * @param {object | null} repo
 * @param {string | null} [cwd] the directory the step is pasted in; omit it for the root itself
 * @returns {string}
 */
export function resolveLockfileStep(repo, cwd = null) {
  return `pnpm${pnpmDirFlag(repo, cwd)} install --lockfile-only${pnpmFlag(repo)}`;
}
