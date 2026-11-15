import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FOREIGN_PIN_FLAG, LOCKFILE_ONLY_STEP, resolveLockfileStep } from '../src/lib/foreign-pin.js';
import rule, { pinCommand } from '../src/rules/exact-versions.js';
import {
  FOREIGN_PACKAGE_MANAGER,
  LOCKFILE,
  PROBE_PIN,
  PROBE_RESOLVE_PIN,
  PROBE_SCOPED_PIN,
  judgeField,
  judgeLockfile,
  lockfileCommand,
  probe,
  resolveManifest,
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

test('the foreign resolve is the shape the catalogue builds for a foreign packageManager', () => {
  // The second shape the catalogue prints is the one a repository migrating off npm follows (0018). It
  // is built by `resolveLockfileStep`, so the probe asks that builder instead of remembering the flag:
  // a copy here would keep passing after the catalogue stopped printing it (S7).
  const foreign = { files: { packageJson: { json: { packageManager: FOREIGN_PACKAGE_MANAGER } } } };

  assert.equal(lockfileCommand(foreign), resolveLockfileStep(foreign), 'the probe re-derives a command the catalogue builds');
  assert.equal(
    lockfileCommand(foreign),
    `pnpm install --lockfile-only ${FOREIGN_PIN_FLAG}`,
    'the emitted text moved',
  );

  // The same builder answers bare for a repository that declares pnpm, or declares nothing: the flag is
  // for the foreign declaration only, and a probe that always asked for it would measure neither shape.
  const pinned = { files: { packageJson: { json: { packageManager: 'pnpm@12.3.4' } } } };
  assert.equal(lockfileCommand(pinned), LOCKFILE_ONLY_STEP, 'a pnpm declaration gained the foreign flag');
  assert.equal(lockfileCommand(), LOCKFILE_ONLY_STEP, 'the step for no context gained the foreign flag');
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

/** The lockfile pnpm writes for a manifest with nothing declared, measured on 12.3.4. */
const EMPTY_LOCKFILE = [
  "lockfileVersion: '9.0'",
  '',
  'settings:',
  '  autoInstallPeers: true',
  '  excludeLinksFromLockfile: false',
  '',
  'importers:',
  '',
  '  .: {}',
  '',
].join('\n');

/** The importer record pnpm writes for the resolve fixture, measured on 12.3.4. */
function resolvedLockfile(version) {
  return [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      local-pin:',
    '        specifier: file:./vendor',
    `        version: ${version}`,
    '',
  ].join('\n');
}

test('the resolve fixture declares the dependency under the section the judgement reads', () => {
  // The fixture and the judgement were written from two literals that happened to agree. One constant
  // now feeds both, and this is what says so: an edit to PROBE_RESOLVE_PIN.type that the fixture did not
  // follow leaves the section absent here (native review of #278, R2-001).
  const manifest = JSON.parse(resolveManifest());

  assert.deepEqual(
    Object.keys(manifest[PROBE_RESOLVE_PIN.type] ?? {}),
    [PROBE_RESOLVE_PIN.dependency],
    'the fixture writes the section the judgement reads',
  );
});

test('the importer record is the measurement, not the file, and each failure is named apart', () => {
  const command = 'pnpm install --lockfile-only';
  const judged = (overrides = {}) =>
    judgeLockfile({ text: resolvedLockfile('file:vendor'), command, dependency: 'local-pin', ...overrides });

  assert.deepEqual(judged(), { ok: true, problems: [] });

  const absent = judged({ text: null });
  assert.equal(absent.ok, false, 'a lockfile that was never written passed');
  assert.equal(absent.problems.length, 1);
  assert.ok(absent.problems[0].includes(LOCKFILE), 'the absence does not name the file it looked for');
  assert.ok(absent.problems[0].includes(command), 'the absence does not name the step that was supposed to write it');

  // The gap this judgement closes: a manifest with nothing declared produced a lockfile whose root
  // importer is `.: {}`, and asking whether the file existed called that a pass (docs/validation.md:71).
  const empty = judged({ text: EMPTY_LOCKFILE });
  assert.equal(empty.ok, false, 'a lockfile that recorded nothing passed as the effect');
  assert.equal(empty.problems.length, 1);
  assert.ok(empty.problems[0].includes(PROBE_RESOLVE_PIN.type), 'the section judged is not named');
  assert.ok(empty.problems[0].includes('local-pin'), 'the dependency judged is not named');
  assert.ok(empty.problems[0].includes(command), 'the command that produced it is not named');

  // A shape this reader refuses is not a pass either: an unjudged lockfile proves nothing.
  const unreadable = judged({ text: 'lockfileVersion: 6.0\nimporters: {\n' });
  assert.equal(unreadable.ok, false, 'a lockfile the reader refused passed');
  assert.ok(unreadable.problems[0].includes(LOCKFILE), 'the unreadable lockfile is not named');
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

test('the probe runs the four command shapes the catalogue prints, each in a directory of its own', (t) => {
  const root = scratch(t);
  const seen = [];
  probe({ root, run: (command) => seen.push(command) });

  // The commands, in order, and nothing the catalogue does not print: both resolve shapes — the bare step
  // and the one carrying the foreign flag — then the root pin, then the importer pin with its `-C <dir>`
  // prefix. The pin value is a local link because the probe measures the form, never a registry's uptime.
  assert.equal(seen.length, 4, 'a command shape the catalogue prints is still unmeasured');
  assert.equal(seen[0], LOCKFILE_ONLY_STEP, 'the plain resolve is not the catalogue string');
  assert.equal(seen[1], lockfileCommand({ files: { packageJson: { json: { packageManager: FOREIGN_PACKAGE_MANAGER } } } }));
  assert.ok(seen[1].endsWith(` ${FOREIGN_PIN_FLAG}`), 'the foreign resolve lost the flag the catalogue prints');
  assert.equal(seen[2], pinCommand(PROBE_PIN));
  assert.equal(seen[3], pinCommand(PROBE_SCOPED_PIN));
  assert.ok(seen[3].startsWith(`pnpm -C ${PROBE_SCOPED_PIN.dir} pkg set`), 'the importer form lost its prefix');
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

/**
 * The manifest shape `pnpm pkg set 'dependencies["name"]=…'` writes, produced by hand so the judgement
 * is exercised without pnpm, an install or a network. The importer form writes into the directory its
 * `-C` names, which is the difference between measuring the form and guessing it.
 */
function pinEffect(command, cwd) {
  const scoped = command.includes(`-C ${PROBE_SCOPED_PIN.dir}`);
  const pin = scoped ? PROBE_SCOPED_PIN : PROBE_PIN;
  const target = scoped ? join(cwd, PROBE_SCOPED_PIN.dir) : cwd;
  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
  manifest[pin.type] = { [pin.dependency]: pin.version };
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** A transport that leaves whatever the resolve step is asked to leave, and the pin fields behind. */
function transport(lockfile) {
  return (command, cwd) => {
    if (command.startsWith(LOCKFILE_ONLY_STEP)) {
      writeFileSync(join(cwd, LOCKFILE), lockfile);
      return;
    }
    pinEffect(command, cwd);
  };
}

test('a transport that leaves every effect behind is the only way probe() answers ok', (t) => {
  const root = scratch(t);
  assert.deepEqual(probe({ root, run: transport(resolvedLockfile('file:vendor')) }), { ok: true, problems: [] });
});

test('a lockfile that exists and records nothing is not the effect', (t) => {
  const root = scratch(t);
  const nothing = probe({ root, run: transport(EMPTY_LOCKFILE) });

  assert.equal(nothing.ok, false, 'a resolve step that recorded nothing passed because the file appeared');
  assert.ok(
    nothing.problems.some((problem) => problem.includes(LOCKFILE) && problem.includes('local-pin')),
    'the empty lockfile was not reported against the dependency it never recorded',
  );
});
