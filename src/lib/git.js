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

/** @returns {Promise<string | null>} the worktree root, or null outside git */
export async function repoRoot(collector) {
  const result = await collector.git(['rev-parse', '--show-toplevel']);
  if (!result.ok || result.code !== 0) return null;
  const [root] = lines(result.stdout ?? '');
  return root ?? null;
}

/** @returns {Promise<string[] | null>} every tracked path, repo-relative, POSIX separators */
export async function trackedFiles(collector) {
  const result = await collector.git(['ls-files', '-z']);
  if (!result.ok || result.code !== 0) return null;
  return nul(result.stdout ?? '');
}

/** @returns {Promise<boolean | null>} tracked or not; null when git cannot answer */
export async function isTracked(collector, path) {
  const result = await collector.git(['ls-files', '--error-unmatch', '--', path]);
  if (!result.ok) return null;
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  return null;
}

/**
 * Behavioral ignore evaluation for a batch of candidate paths (RFC 8.2 R7, E3).
 * The verdict is the per-path presence in the NUL-separated output; the aggregate exit code is
 * never read as one path's answer, and `-v` is never passed.
 * @param {ReturnType<import('./probes.js').createCollector>} collector
 * @param {string[]} paths
 * @returns {Promise<Set<string> | null>} the ignored paths, or null when the probe failed
 */
export async function ignoredPaths(collector, paths) {
  if (paths.length === 0) return new Set();
  const result = await collector.git(['check-ignore', '--no-index', '--stdin', '-z'], {
    input: paths.map((path) => `${path}\0`).join(''),
  });
  if (!result.ok) return null;
  if (result.code !== 0 && result.code !== 1) return null;
  return new Set(nul(result.stdout ?? ''));
}

/**
 * @param {ReturnType<import('./probes.js').createCollector>} collector
 * @param {string[]} paths
 * @returns {Promise<string[] | null>} porcelain entries limited to those paths
 */
export async function statusPorcelain(collector, paths) {
  const args = ['status', '--porcelain', '-z'];
  if (paths.length > 0) args.push('--', ...paths);
  const result = await collector.git(args);
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
