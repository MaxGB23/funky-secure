/**
 * `pin` (RFC 11.9): print the exact-versions pins, and perform them with `--apply`.
 *
 * Running the command is the approval: there is no prompt, and the plan is the diff. The `--apply`
 * split is the family convention (`init`, `migrate`) — no verb in this tool writes on its first
 * invocation — and it is what makes the change reviewable before it exists.
 *
 * It reads the same collection `scan` and `init` read, so it cannot disagree with the report about the
 * same repository: the pins come from `package.json` and the versions from `pnpm-lock.yaml`, exactly
 * the two facts `exact-versions` compares.
 */

import { applyPlan, renderPlanHuman, renderPlanJson } from '../lib/plan.js';
import { collectScan } from '../lib/scan.js';
import { planPins } from '../lib/pins.js';
import { TOOL } from '../lib/tool.js';
import { catalog as defaultCatalog } from '../rules/index.js';

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {object} options.env
 * @param {object} options.stdout
 * @param {object} [options.stderr]
 * @param {string} [options.preset]
 * @param {string} [options.format]
 * @param {boolean} [options.apply]
 * @param {boolean} [options.allowDirty]
 * @param {Array<object>} [options.catalog]
 * @param {object} [options.collector]
 * @returns {Promise<number>} exit code
 */
export async function run({
  cwd,
  env,
  stdout,
  stderr,
  preset,
  format = 'human',
  apply = false,
  allowDirty = false,
  catalog = defaultCatalog,
  collector,
}) {
  const { ctx, policy, probes } = await collectScan({
    cwd,
    env,
    scope: 'all',
    preset,
    failOn: 'none',
    catalog,
    collector,
  });

  const { items, notes, pins } = planPins({ ctx });
  const writes = items.filter((item) => item.state === 'would-write');

  // With `--format json` stdout carries the plan document and nothing else: the ledger of writes would
  // make it unparseable, so it goes to stderr, exactly as `init --apply` does.
  const ledger = format === 'json' ? stderr ?? stdout : stdout;

  const text =
    format === 'json'
      ? renderPlanJson({ tool: TOOL, command: 'pin', policy, plan: items })
      : renderPlanHuman({
          command: 'pin',
          preset: policy.preset,
          plan: items,
          apply,
          // Writing an exact specifier is half the change: the lockfile still records the range it
          // replaced, so the next scan reports a desync until the lockfile is rewritten. The tool never
          // runs an install (RFC 11.6), so it names the step instead.
          nextSteps: writes.length > 0 ? ['pnpm install --lockfile-only'] : [],
        });
  stdout.write(text);

  // The plan names the file and the count; what a reviewer needs is the line list — which specifier
  // moves from which range to which exact version — so the human rendering adds it. The JSON document
  // stays the plan alone: its item carries the whole rewritten file, which is the diff.
  if (format !== 'json' && pins.length > 0) {
    stdout.write(`
pins
`);
    for (const pin of pins) {
      stdout.write(`  ${pin.section}.${pin.name}  ${pin.from} → ${pin.to}
`);
    }
  }

  // The notes are prose about what was not pinned, so they never reach the JSON document.
  if (format !== 'json' && notes.length > 0) {
    stdout.write(`\nnot pinned\n`);
    for (const note of notes) stdout.write(`  ${note}\n`);
  }

  if (!apply) return 0;
  if (writes.length === 0) return 0;
  return applyPlan({ plan: items, allowDirty, cwd, collector: probes, stdout: ledger });
}
