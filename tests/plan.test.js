/**
 * The applier's own guard rails (RFC 11.2, 10.4).
 *
 * The two `ConfigError`s in `applyPlan` are invariants: a plan item is built by this tool with its
 * content and its digest, so neither can fail on the printed path. That is exactly why they are worth
 * one test — the assertion is not that the tool is wrong, it is that the guard throws the class the
 * contract names, so a failure surfaces as exit `2` with a message instead of a `ReferenceError` with
 * a stack (issue 142).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigError } from '../src/lib/errors.js';
import { applyPlan } from '../src/lib/plan.js';
import { createCollector } from '../src/lib/probes.js';

test('a plan item with no content is a ConfigError, and nothing is written (10.4, issue 142)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'funky-plan-'));
  try {
    const item = join(dir, 'pnpm-workspace.yaml');
    const plan = [{ state: 'would-write', path: item, operation: 'create', content: null, digest: 'x' }];

    await assert.rejects(
      () =>
        applyPlan({
          plan,
          allowDirty: true,
          cwd: dir,
          collector: createCollector({ cwd: dir }),
          stdout: { write() {} },
        }),
      (error) => {
        assert.ok(
          error instanceof ConfigError,
          `a guard the contract maps to exit 2 threw ${error.name}: ${error.message}`,
        );
        assert.match(error.message, /carries no content/);
        return true;
      },
    );

    assert.deepEqual(readdirSync(dir), [], 'an item that cannot be applied writes nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
