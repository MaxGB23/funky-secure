/**
 * The one sentence a rule states when it has no repository facts, and the place that decides which
 * of the two reasons it gives (#334, I-21).
 *
 * `repo: null` has two causes and they send a reader in opposite directions: `--scope machine`
 * excludes the repository before anything is resolved, while a scope that asked and found none is a
 * different fact entirely. The scan puts the reason in the context, so no rule re-derives it from the
 * flags and no two rules can word it differently. The skip code is unchanged — `no-repo` means no
 * repository facts in this scope, and the caller that passed the flag already holds it.
 */

/**
 * @param {object | null | undefined} ctx resolved context, carrying `repoOutOfScope`
 * @param {string} [consequence] what the rule could not do without the facts, after `so`
 * @returns {string} the `skipped: ` sentence, in the repository's voice
 */
export function repoSkipMessage(ctx, consequence) {
  const reason =
    ctx?.repoOutOfScope === true
      ? 'the repository was excluded by --scope machine'
      : 'no repository was resolved';

  return consequence === undefined ? `skipped: ${reason}` : `skipped: ${reason}, so ${consequence}`;
}
