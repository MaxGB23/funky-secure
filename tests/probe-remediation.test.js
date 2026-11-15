import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LOCKFILE_ONLY_STEP } from '../src/lib/foreign-pin.js';
import rule, { pinCommand } from '../src/rules/exact-versions.js';
import {
  LOCKFILE,
  PROBE_PIN,
  judgeField,
  judgeLockfile,
  lockfileCommand,
  probe,
} from '../scripts/probe-remediation.js';

/**
 * A plain context: manifest texts and a lockfile text are the only inputs, so no filesystem and no
 * probe are involved. The shape is the one `tests/rules/exact-versions.test.js` builds.
 */
function ctx({ importers = [], lockfile = null } = {}) {
  return {
    scope: 'repo',
    cwd: '/repo',
    root: '/repo',
    env: {},
    configPath: null,
    machine: null,
    repo: {
      root: '/repo',
      inGit: true,
      branch: 'main',
      files: {
        packageJson: importers[0] ?? null,
        workspaceYaml: null,
        lockfile,
        npmrc: null,
        gitignore: null,
      },
      present: ['package.json'],
      tracked: new Set(['package.json']),
      ignoreCandidates: [],
      ignored: new Set([]),
      importers,
      workflows: [],
      botFiles: [],
      editorFiles: [],
      skippedGlobs: [],
    },
  };
}

function importer(dir, text) {
  return {
    path: dir === '.' ? '/repo/package.json' : `/repo/${dir}/package.json`,
    text,
    json: JSON.parse(text),
    error: null,
    dir,
  };
}

const FLOATING = `{
  "dependencies": {
    "left-pad": "^1.3.0"
  }
}`;

function lockfileWith(importerDir, body) {
  return ["lockfileVersion: '9.0'", '', 'importers:', '', `  ${importerDir}:`, ...body, ''].join('\n');
}

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-probe-remediation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the lockfile claim is the string the catalogue prints, not a copy of it', () => {
  // `docs/validation.md` carried "every remediation that needs an install" as not verified. The claim
  // is about what the tool prints, so the probe resolves the same string the finding carries: a copy
  // here would drift from the catalogue and measure a command nobody is ever told to run (S7).
  const desynced = rule.detect(
    ctx({
      importers: [importer('.', '{ "dependencies": { "left-pad": "1.3.0" } }')],
      lockfile: {
        path: '/repo/pnpm-lock.yaml',
        text: lockfileWith('.', ['    dependencies:', '      left-pad:', '        specifier: ^1.3.0', '        version: 1.3.0']),
      },
    }),
  );
  const [finding] = desynced.filter((entry) => entry.code === 'lockfile-desync');
  assert.equal(finding?.remediation?.command, lockfileCommand(), 'the probe runs a command the catalogue never prints');

  assert.equal(lockfileCommand(), LOCKFILE_ONLY_STEP, 'the probe carries its own copy instead of importing the constant');
  assert.equal(lockfileCommand(), 'pnpm install --lockfile-only', 'the emitted text moved');
});

test('the pin claim is the pkg set form the catalogue prints, at the root and in an importer', () => {
  const rootFindings = rule
    .detect(
      ctx({
        importers: [importer('.', FLOATING)],
        lockfile: {
          path: '/repo/pnpm-lock.yaml',
          text: lockfileWith('.', ['    dependencies:', '      left-pad:', '        specifier: ^1.3.0', '        version: 1.3.0']),
        },
      }),
    )
    .filter((entry) => entry.code === 'floating-range');
  assert.equal(rootFindings[0]?.remediation?.command, pinCommand({ type: 'dependencies', dependency: 'left-pad', version: '1.3.0' }));

  // create-t3-app: a finding in a workspace importer is pinned in THAT manifest, so the builder has to
  // carry the `-C <dir>` prefix the catalogue prints, or the probe measures the root manifest instead.
  const nestedFindings = rule
    .detect(
      ctx({
        importers: [importer('packages/api', FLOATING)],
        lockfile: {
          path: '/repo/pnpm-lock.yaml',
          text: lockfileWith('packages/api', [
            '    dependencies:',
            '      left-pad:',
            '        specifier: ^1.3.0',
            '        version: 1.3.0',
          ]),
        },
      }),
    )
    .filter((entry) => entry.code === 'floating-range');
  const nested = pinCommand({ type: 'dependencies', dependency: 'left-pad', version: '1.3.0', dir: 'packages/api' });

  assert.equal(nestedFindings[0]?.remediation?.command, nested, 'the probe runs a command the catalogue never prints');
  assert.equal(
    nested,
    `pnpm -C packages/api pkg set 'dependencies["left-pad"]=1.3.0' && pnpm -C packages/api install`,
    'the emitted text moved',
  );
});

test('the root pin keeps the bare form, with the property path bracketed for a scoped name', () => {
  assert.equal(
    pinCommand({ type: 'devDependencies', dependency: '@types/node', version: '20.19.43' }),
    `pnpm pkg set 'devDependencies["@types/node"]=20.19.43' && pnpm install`,
  );
});

test('a lockfile that exists afterwards is the measurement, and its absence names the step', () => {
  assert.deepEqual(judgeLockfile({ present: true }), { ok: true, problems: [] });

  const absent = judgeLockfile({ present: false });
  assert.equal(absent.ok, false, 'a lockfile that was never written passed');
  assert.equal(absent.problems.length, 1);
  assert.ok(absent.problems[0].includes(LOCKFILE), 'the absence does not name the file it looked for');
  assert.ok(
    absent.problems[0].includes('pnpm install --lockfile-only'),
    'the absence does not name the step that was supposed to write it',
  );
});

test('the manifest carrying the value afterwards is the measurement, and anything else is named', () => {
  const manifest = { name: 'probe', devDependencies: { 'local-pin': 'file:./vendor' } };
  const judged = (overrides = {}) =>
    judgeField({ manifest, type: 'devDependencies', dependency: 'local-pin', expected: 'file:./vendor', ...overrides });

  assert.deepEqual(judged(), { ok: true, problems: [] });

  const absentSection = judged({ manifest: { name: 'probe' } });
  assert.equal(absentSection.ok, false, 'a manifest with no devDependencies passed');
  assert.match(absentSection.problems.join(' '), /devDependencies/);

  const absentName = judged({ manifest: { name: 'probe', devDependencies: { other: '1.0.0' } } });
  assert.equal(absentName.ok, false, 'a manifest with no local-pin passed');
  assert.match(absentName.problems.join(' '), /local-pin/);

  const otherValue = judged({ manifest: { name: 'probe', devDependencies: { 'local-pin': '^1.0.0' } } });
  assert.equal(otherValue.ok, false, 'a range was accepted as the value the command carries');
  assert.match(otherValue.problems.join(' '), /1\.0\.0/, 'the value found is not named');
});

test('the probe runs the two commands the catalogue prints, in a directory of its own', (t) => {
  const root = scratch(t);
  const seen = [];
  probe({ root, run: (command) => seen.push(command) });

  // The commands, in order, and nothing the catalogue does not print: the pin value is a local link
  // because the probe must measure the form and never a registry's uptime (S8 is about effect, not
  // about a resolution).
  assert.deepEqual(seen, [lockfileCommand(), pinCommand(PROBE_PIN)]);
  assert.equal(PROBE_PIN.version, 'file:./vendor', 'the pin needs no registry, so the measurement needs no network');
});

test('a command that ran and left nothing behind is a failure, never a pass', (t) => {
  const root = scratch(t);
  const nothing = probe({ root, run: () => {} });

  assert.equal(nothing.ok, false, 'a probe that produced no effect answered ok');
  assert.ok(
    nothing.problems.some((problem) => problem.includes(LOCKFILE)),
    'the missing lockfile was not reported',
  );
  assert.ok(
    nothing.problems.some((problem) => problem.includes(PROBE_PIN.dependency)),
    'the manifest the command never touched was not reported',
  );
});

test('a transport that leaves the two effects behind is the only way probe() answers ok', (t) => {
  const root = scratch(t);
  const effect = (command, cwd) => {
    if (command === lockfileCommand()) {
      writeFileSync(join(cwd, LOCKFILE), "lockfileVersion: '9.0'\n");
      return;
    }
    // The manifest shape `pnpm pkg set 'devDependencies["local-pin"]=…'` writes, produced by hand so
    // the judgement is exercised without pnpm, an install or a network.
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    manifest[PROBE_PIN.type] = { [PROBE_PIN.dependency]: PROBE_PIN.version };
    writeFileSync(join(cwd, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  };

  assert.deepEqual(probe({ root, run: effect }), { ok: true, problems: [] });
});
