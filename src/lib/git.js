/**
 * Git read helpers (RFC 12.1). Read-only: no `add`, no `commit`, no `checkout`.
 *
 * Each helper returns `null` when the probe could not answer, so a rule can report `skip` instead of
 * a false `pass`. The ignore probe is invoked **without `-v`**: with `-v` a negated path exits `0`
 * and prints the negation, which inverts the verdict (E3).
 */

function lines(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function nul(text) {
  return text.split('\0').filter((value) => value !== '');
}

/**
 * The worktree root, or `null` outside git.
 *
 * This is the one probe that must run from the invocation directory: it is the question whose answer
 * *is* the root, so asking it from the root would assume the fact it resolves.
 * @returns {Promise<string | null>} the worktree root, or null outside git
 */
export async function repoRoot(collector) {
  const result = await collector.git(['rev-parse', '--show-toplevel']);
  if (!result.ok || result.code !== 0) return null;
  const [root] = lines(result.stdout ?? '');
  return root ?? null;
}

/**
 * Every tracked path, repo-relative, POSIX separators.
 *
 * `git ls-files` answers in the coordinate system of the directory it runs in: from a nested one it
 * lists only the tracked paths below that directory, spelled relative to it. A caller that compares
 * the answer with repository-relative names must therefore pass the repository root, or a committed
 * `pnpm-lock.yaml` disappears from the set and the lockfile is reported untracked (issue 347).
 * @param {ReturnType<import('./probes.js').createCollector>} collector
 * @param {string} [cwd] the directory git runs in; the repository root, for the reason above
 * @returns {Promise<string[] | null>} every tracked path, repo-relative, POSIX separators
 */
export async function trackedFiles(collector, cwd) {
  const result =
    cwd === undefined
      ? await collector.git(['ls-files', '-z'])
      : await collector.git(['ls-files', '-z'], { cwd });
  if (!result.ok || result.code !== 0) return null;
  return nul(result.stdout ?? '');
}

/**
 * Tracked or not. The pathspec is read relative to `cwd`, so a repository-relative `path` needs the
 * repository root here for the same reason `trackedFiles` does.
 * @param {ReturnType<import('./probes.js').createCollector>} collector
 * @param {string} path repository-relative path
 * @param {string} [cwd] the directory git runs in; the repository root
 * @returns {Promise<boolean | null>} tracked or not; null when git cannot answer
 */
export async function isTracked(collector, path, cwd) {
  const args = ['ls-files', '--error-unmatch', '--', path];
  const result = cwd === undefined ? await collector.git(args) : await collector.git(args, { cwd });
  if (!result.ok) return null;
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  return null;
}

/**
 * Behavioral ignore evaluation for a batch of candidate paths (RFC 8.2 R7, E3).
 * The verdict is the per-path presence in the NUL-separated output; the aggregate exit code is
 * never read as one path's answer, and `-v` is never passed.
 *
 * `check-ignore` resolves every path it is given relative to the directory it runs in, so candidate
 * paths declared repository-relative need `cwd` = the repository root: from a nested directory a
 * root `.gitignore` rule is asked about a path it never mentioned and the answer is not ignored
 * (issue 347).
 * @param {ReturnType<import('./probes.js').createCollector>} collector
 * @param {string[]} paths repository-relative candidate paths
 * @param {string} [cwd] the directory git runs in; the repository root, for the reason above
 * @returns {Promise<Set<string> | null>} the ignored paths, or null when the probe failed
 */
export async function ignoredPaths(collector, paths, cwd) {
  if (paths.length === 0) return new Set();
  const options = { input: paths.map((path) => `${path}\0`).join('') };
  if (cwd !== undefined) options.cwd = cwd;
  const result = await collector.git(['check-ignore', '--no-index', '--stdin', '-z'], options);
  if (!result.ok) return null;
  if (result.code !== 0 && result.code !== 1) return null;
  return new Set(nul(result.stdout ?? ''));
}

/**
 * @param {ReturnType<import('./probes.js').createCollector>} collector
 * @param {string[]} paths
 * @returns {Promise<string[] | null>} porcelain entries limited to those paths
 */
/**
 * The porcelain entries for these paths, or `null` when git could not answer.
 *
 * `paths` are repository-relative, which is the form the entries come back in: porcelain reports from
 * the worktree root whatever the cwd is. A pathspec, on the other hand, git reads relative to the cwd,
 * so the call runs from `cwd` and the caller names the root. Asking in one coordinate system while
 * reading the answer in another is how a dirty tree was called clean (issue 210).
 *
 * @param {ReturnType<import('./probes.js').createCollector>} collector
 * @param {string[]} paths repository-relative paths
 * @param {string} [cwd] the directory git runs in; the repository root, for the reason above
 * @returns {Promise<string[] | null>} porcelain entries limited to those paths
 */
export async function statusPorcelain(collector, paths, cwd) {
  const args = ['status', '--porcelain', '-z'];
  if (paths.length > 0) args.push('--', ...paths);
  const result = cwd === undefined ? await collector.git(args) : await collector.git(args, { cwd });
  if (!result.ok || result.code !== 0) return null;
  return nul(result.stdout ?? '');
}

/** @returns {Promise<string | null>} */
export async function currentBranch(collector) {
  const result = await collector.git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!result.ok || result.code !== 0) return null;
  const [branch] = lines(result.stdout ?? '');
  return branch ?? null;
}

/**
 * The default branch, read from the remote HEAD (RFC 12.1). A repository without a remote cannot
 * resolve it; the caller states that fallback in its refusal message.
 * @returns {Promise<string | null>}
 */
export async function defaultBranch(collector) {
  const result = await collector.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (!result.ok || result.code !== 0) return null;
  const [ref] = lines(result.stdout ?? '');
  if (ref === undefined) return null;
  return ref.replace(/^origin\//, '');
}
