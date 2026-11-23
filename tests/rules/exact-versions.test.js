import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../../src/cli.js';
import { renderHuman } from '../../src/lib/render-human.js';
import { createCollector } from '../../src/lib/probes.js';
import { buildReport } from '../../src/lib/report.js';
import { catalog as ruleCatalog } from '../../src/rules/index.js';
import rule, { pinCommand } from '../../src/rules/exact-versions.js';

/**
 * A plain context: package.json texts and a lockfile text are the only inputs, so no filesystem and
 * no probe are involved. Line numbers asserted below are the lines of these literals.
 */
function ctx({ importers = [], lockfile = null, workspaceYaml = null } = {}) {
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
        // The real shape: the collector hands the reader `{ path, text }`, never a bare string.
        workspaceYaml: workspaceYaml === null ? null : { path: '/repo/pnpm-workspace.yaml', text: workspaceYaml },
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

const ROOT_FLOATING = `{
  "name": "demo",
  "dependencies": {
    "left-pad": "^1.3.0",
    "yaml": "2.9.0",
    "tiny": "1.x",
    "tagged": "latest",
    "remote": "github:owner/repo",
    "waved": "~2.0.0"
  }
}`;

const ROOT_FLOATING_LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    specifiers:
      left-pad: '^1.3.0'
      yaml: 2.9.0
      tiny: 1.x
      tagged: latest
      remote: github:owner/repo
      waved: '~2.0.0'
`;

test('declares the fixed contract fields of R5', () => {
  assert.equal(rule.id, 'exact-versions');
  assert.equal(rule.friction, 2);
  assert.deepEqual(rule.severity, { baseline: 'warn', strict: 'error' });
  assert.deepEqual(rule.scope, ['repo']);
  assert.deepEqual(rule.targets, ['importer']);
  assert.equal(rule.docs, 'docs/rules/exact-versions.md');
});

test('reports every floating specifier with its dependency, type and file:line', () => {
  const findings = rule.detect(
    ctx({
      importers: [importer('.', ROOT_FLOATING)],
      lockfile: { path: '/repo/pnpm-lock.yaml', text: ROOT_FLOATING_LOCKFILE },
    }),
  );
  const failures = findings.filter((finding) => finding.status === 'fail');

  assert.deepEqual(
    failures.map((finding) => finding.code),
    ['floating-range', 'floating-range', 'floating-range', 'floating-range', 'floating-range'],
  );
  assert.deepEqual(
    failures.map((finding) => finding.evidence.specifier),
    ['^1.3.0', '1.x', 'latest', 'github:owner/repo', '~2.0.0'],
  );
  assert.deepEqual(failures[0].evidence, {
    specifier: '^1.3.0',
    dependency: 'left-pad',
    type: 'dependencies',
  });
  assert.deepEqual(
    failures.map((finding) => finding.path),
    ['package.json', 'package.json', 'package.json', 'package.json', 'package.json'],
  );
  assert.ok(failures.every((finding) => finding.remediation.kind === 'manual'));
  // That lockfile records specifiers only, so no resolved version was measured: the remediation
  // resolves the range first and the next scan prints the exact pin (S4, RFC 4.9).
  assert.equal(
    failures[0].remediation.command,
    'pnpm install --lockfile-only && funky-secure scan --only exact-versions',
  );
});

test('a floating range is pinned with pnpm pkg set, in the section the entry lives in', () => {
  const text = `{
  "dependencies": {
    "left-pad": "^1.3.0"
  },
  "devDependencies": {
    "@scope/tool": "~2.0.0"
  }
}`;
  const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      left-pad:
        specifier: ^1.3.0
        version: 1.3.0
    devDependencies:
      '@scope/tool':
        specifier: ~2.0.0
        version: 2.0.1
`;
  const findings = rule.detect(
    ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
  );
  const floats = findings.filter((finding) => finding.code === 'floating-range');

  assert.deepEqual(
    floats.map((finding) => finding.remediation),
    [
      // `left-pad` is unscoped, carries no dot and does not start with a digit, so it takes the
      // quote-free dotted path; the scoped name takes the bracketed one, double-quoted with its inner
      // quotes escaped, which is the spelling `cmd`, `bash` and `sh` all read (0042).
      { kind: 'manual', command: `pnpm pkg set dependencies.left-pad=1.3.0 && pnpm install` },
      {
        kind: 'manual',
        command: `pnpm pkg set "devDependencies[\\"@scope/tool\\"]=2.0.1" && pnpm install`,
      },
    ],
  );
  assert.deepEqual(
    floats.map((finding) => finding.remediation.command.includes('--save-exact')),
    [false, false],
    'the measured no-op command is never printed',
  );
});

test('a repository that declares its own lockfile freeze gets a route with no install, because no install clears it (373)', () => {
  // Measured on pnpm 12.3.4 in a repository whose pnpm-workspace.yaml carries `frozenLockfile: true`:
  // `pnpm pkg set` exits 0 and `pnpm install` exits 1 with ERR_PNPM_OUTDATED_LOCKFILE, and so does
  // `pnpm install --lockfile-only`. Only `--no-frozen-lockfile` records the pin, and that is the flag
  // R10 (`ci-no-safety-overrides`) reports, so this product never prints it. The finding keeps its
  // kind and loses the command that cannot work.
  const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      left-pad:
        specifier: ^1.3.0
        version: 1.3.0
`;
  const findings = rule.detect(
    ctx({
      importers: [importer('.', `{"dependencies":{"left-pad":"^1.3.0"}}`)],
      lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile },
      workspaceYaml: 'packages:\n  - .\nfrozenLockfile: true\n',
    }),
  );
  const float = findings.find((finding) => finding.code === 'floating-range');

  assert.equal(float.remediation.kind, 'manual');
  for (const text of ['pnpm install', '--no-frozen-lockfile', '--lockfile-only', 'pnpm pkg set']) {
    assert.equal(
      float.remediation.command.includes(text),
      false,
      `the route names no command that refuses under the declared freeze: ${text}`,
    );
  }
  assert.match(float.remediation.command, /frozenLockfile: true/);
  assert.match(float.remediation.command, /left-pad/);
  assert.match(float.remediation.command, /pnpm-lock\.yaml/);
});

test('the two freeze spellings pnpm ignores are not read, so the printed pin survives them (373)', () => {
  // Measured on pnpm 12.3.4: `.npmrc` with `frozen-lockfile=true` leaves `pnpm config get
  // frozen-lockfile` answering `undefined` and the install exits 0; the kebab `frozen-lockfile:` in
  // pnpm-workspace.yaml is ignored with a warning and the install exits 0. Reading either would turn
  // a lockfile that updates fine into a route that names no command — the defect, inverted.
  const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      left-pad:
        specifier: ^1.3.0
        version: 1.3.0
`;
  const expected = `pnpm pkg set dependencies.left-pad=1.3.0 && pnpm install`;

  for (const [label, workspaceYaml] of [
    ['kebab in pnpm-workspace.yaml', 'packages:\n  - .\nfrozen-lockfile: true\n'],
    ['no freeze declared', 'packages:\n  - .\n'],
    ['the file not read at all', null],
  ]) {
    const findings = rule.detect(
      ctx({
        importers: [importer('.', `{"dependencies":{"left-pad":"^1.3.0"}}`)],
        lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile },
        workspaceYaml,
      }),
    );
    const float = findings.find((finding) => finding.code === 'floating-range');
    assert.equal(float.remediation.command, expected, label);
  }
});

test('a scoped name takes the bracketed path, because a dot path cannot carry an @', () => {
  // Measured on pnpm 12.3.4: `pnpm pkg set 'devDependencies.@types/node=20.19.43'` exits non-zero with
  // ERR_PNPM_PKG_INVALID_PROPERTY_PATH ("Unexpected token \"@\" in property path"), while
  // `pnpm pkg set "devDependencies[\"@types/node\"]=20.19.43"` writes the exact version. Most of a
  // modern dependency set is scoped, so the dot form fails on the common case.
  const text = `{
  "devDependencies": {
    "@types/node": "^20.19.43"
  }
}`;
  const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      '@types/node':
        specifier: ^20.19.43
        version: 20.19.43
`;
  const [finding] = rule
    .detect(
      ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
    )
    .filter((entry) => entry.code === 'floating-range');

  assert.equal(
    finding.remediation.command,
    `pnpm pkg set "devDependencies[\\"@types/node\\"]=20.19.43" && pnpm install`,
  );
  assert.equal(
    finding.remediation.command.includes('devDependencies.@'),
    false,
    'the dot form never reaches a scoped name',
  );
});

test('the property path follows the name: the dotted path only where pnpm reads it as one path (0042)', () => {
  // Measured across `cmd`, `bash`, `sh`, `pwsh` 7 and Windows PowerShell 5.1, every cell executed. The
  // dotted path is the one spelling `cmd` reads with no quoting at all, and each clause of the
  // predicate is a measurement on a published name rather than a style preference: a scoped name is
  // refused with ERR_PNPM_PKG_INVALID_PROPERTY_PATH, `lodash.merge` is read as three path segments and
  // writes a nested `lodash` object beside the untouched entry while exiting 0, and `7zip-bin` is
  // refused with `Numeric suffix "z" is not supported`. Every other name takes the bracketed path,
  // the whole argument double-quoted with its inner quotes escaped.
  const pin = (dependency) => pinCommand({ type: 'devDependencies', dependency, version: '1.3.0' });

  const cases = [
    ['left-pad', `pnpm pkg set devDependencies.left-pad=1.3.0 && pnpm install`],
    ['left-pad2', `pnpm pkg set devDependencies.left-pad2=1.3.0 && pnpm install`],
    ['@scope/tool', `pnpm pkg set "devDependencies[\\"@scope/tool\\"]=1.3.0" && pnpm install`],
    ['lodash.merge', `pnpm pkg set "devDependencies[\\"lodash.merge\\"]=1.3.0" && pnpm install`],
    ['7zip-bin', `pnpm pkg set "devDependencies[\\"7zip-bin\\"]=1.3.0" && pnpm install`],
    ['0x', `pnpm pkg set "devDependencies[\\"0x\\"]=1.3.0" && pnpm install`],
  ];

  for (const [dependency, expected] of cases) {
    const command = pin(dependency);
    assert.equal(command, expected, `${dependency} did not take the spelling the predicate chooses`);
    assert.equal(command.includes("'"), false, `${dependency}: the command carries a single quote, which cmd passes through literally`);
  }

  // The predicate is three clauses, and `left-pad2` above is the one case that says so: a digit that is
  // not leading is not an array index.
  assert.equal(pin('left-pad2').includes('['), false, 'a trailing digit is not a leading one');
});

test('a name outside the grammar takes no command at all, and the route is the manifest edit', () => {
  // The escaped, double-quoted spelling stops `cmd` splitting the argument and it does NOT stop bash
  // expanding `$(…)`, `${…}` or a backtick inside those double quotes — the single-quoted spelling it
  // replaced did. A name is a string a manifest can carry, so the grammar npm itself enforces is the
  // only one a command may interpolate: lowercase `[a-z0-9._~-]`, optionally `@scope/`.
  const pin = (dependency) => pinCommand({ type: 'devDependencies', dependency, version: '1.3.0' });

  for (const dependency of [
    'evil$(touch pwned)',
    'tick`id`',
    'quote"name',
    "quote'name",
    'back\\slash',
    'spaced name',
    'UPPER',
    '@scope/tool$(id)',
  ]) {
    assert.equal(
      pin(dependency),
      null,
      `${dependency}: a command was printed for a name a shell would expand or split`,
    );
  }

  // Inside the grammar both spellings survive: the legal scoped name keeps the bracketed path.
  assert.equal(
    pin('@scope/tool'),
    `pnpm pkg set "devDependencies[\\"@scope/tool\\"]=1.3.0" && pnpm install`,
    'a legal scoped name lost its command',
  );
});

test('a version outside the grammar takes no command at all, and the route is the manifest edit', () => {
  // S2c (`R4-PIN-SHELL-VERSION`): the version is the third thing a command interpolates, and the
  // quote-free dotted path leaves it in the open — `pnpm pkg set dependencies.x=$(id)` expands on bash
  // and sh. The old single-quoted spelling suppressed that by accident of quoting, which is why no rule
  // ever needed a grammar; these spellings have no such accident, so the version needs one too. The
  // grammar is the record's `^[A-Za-z0-9._~:/@+-]+$` with `*`, because `workspace:*` — the exact form S4
  // and 368 make this rule print for an internal package — and the redacted `https://***@host` of a
  // tarball are shapes the rule itself mandates, and neither shell executes or splits a `*`.
  const pin = (version) => pinCommand({ type: 'devDependencies', dependency: 'left-pad', version });

  for (const version of [
    '$(id)',
    '1.2.3`id`',
    '1.2.3 4',
    'a"b',
    "a'b",
    'a&b',
    'a%NAME%',
    '1.0.0(react-dom@18.3.1)',
  ]) {
    assert.equal(
      pin(version),
      null,
      `${version}: a command was printed for a version a shell would expand or split`,
    );
  }

  // The shapes that must keep a command, each one a value this rule prints today.
  for (const version of [
    '1.2.3',
    'workspace:*',
    'file:./vendor',
    'link:../lib',
    'npm:lodash@4.17.21',
    'https://***@example.com/repo~beta+1.tgz',
  ]) {
    assert.equal(
      pin(version),
      `pnpm pkg set devDependencies.left-pad=${version} && pnpm install`,
      `${version}: a value inside the grammar lost its command`,
    );
  }
});

test('a dependency name, importer directory or version the grammar refuses is reported with a prose route', () => {
  // Fail closed: the finding is never dropped — it still names the range — and its route is the edit in
  // the file the reader owns, the same shape a declared `frozenLockfile` already produces. The three
  // values a command interpolates are the name, the importer directory and the version, so any one of
  // them outside its grammar removes the whole command.
  const hostileName = `{
  "dependencies": {
    "evil$(touch pwned)": "^1.3.0"
  }
}`;
  const nameLockfile = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      'evil$(touch pwned)':
        specifier: ^1.3.0
        version: 1.3.0
`;
  const [byName] = rule
    .detect(
      ctx({
        importers: [importer('.', hostileName)],
        lockfile: { path: '/repo/pnpm-lock.yaml', text: nameLockfile },
      }),
    )
    .filter((entry) => entry.code === 'floating-range');

  assert.equal(byName?.remediation?.kind, 'manual', 'the finding lost its kind');
  assert.equal(
    byName.remediation.command.includes('pnpm'),
    false,
    'a command was printed for a name a shell would expand before pnpm ever sees it',
  );
  assert.match(byName.remediation.command, /package\.json/, 'the prose route names no file to edit');
  assert.match(byName.remediation.command, /dependencies/, 'the prose route names no section');

  // The directory, with a legal name: the `-C` prefix of a command is not printed for a directory a
  // shell would expand, and the fallback is for the whole command, not only the prefix.
  const hostileDir = 'packages/a$b';
  const dirLockfile = `lockfileVersion: '9.0'

importers:

  .: {}

  ${hostileDir}:
    dependencies:
      left-pad:
        specifier: ^1.3.0
        version: 1.3.0
`;
  const [byDir] = rule
    .detect(
      ctx({
        importers: [importer(hostileDir, `{"dependencies":{"left-pad":"^1.3.0"}}`)],
        lockfile: { path: '/repo/pnpm-lock.yaml', text: dirLockfile },
      }),
    )
    .filter((entry) => entry.code === 'floating-range');

  assert.equal(byDir?.remediation?.kind, 'manual', 'the finding lost its kind');
  assert.equal(
    byDir.remediation.command.includes('pnpm'),
    false,
    'a command was printed for a directory bash would expand, so pnpm never acts on the manifest the finding names',
  );
  assert.match(
    byDir.remediation.command,
    /packages\/a\$b\/package\.json/,
    'the prose route names no manifest to edit',
  );

  // The version, with a legal name in the root importer: the recorded resolution is a string the
  // lockfile can carry, so a reading of that file is what must not become the command.
  for (const recorded of ['$(id)', '1.2.3`id`', '1.2.3 4']) {
    const versionLockfile = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      left-pad:
        specifier: ^1.3.0
        version: ${recorded}
`;
    const [byVersion] = rule
      .detect(
        ctx({
          importers: [importer('.', `{"dependencies":{"left-pad":"^1.3.0"}}`)],
          lockfile: { path: '/repo/pnpm-lock.yaml', text: versionLockfile },
        }),
      )
      .filter((entry) => entry.code === 'floating-range');

    assert.equal(byVersion?.remediation?.kind, 'manual', `${recorded}: the finding lost its kind`);
    assert.equal(
      byVersion.remediation.command.includes('pnpm'),
      false,
      `${recorded}: a command was printed for a version a shell would expand before pnpm ever sees it`,
    );
    assert.match(
      byVersion.remediation.command,
      /package\.json/,
      `${recorded}: the prose route names no file to edit`,
    );
  }
});

test('without a measured resolution the remediation resolves first, never a guessed version', () => {
  const findings = rule.detect(ctx({ importers: [importer('.', ROOT_FLOATING)] }));
  const [floating] = findings.filter((finding) => finding.code === 'floating-range');

  assert.deepEqual(floating.remediation, {
    kind: 'manual',
    command: 'pnpm install --lockfile-only && funky-secure scan --only exact-versions',
  });
  assert.equal(
    findings.some((finding) => /pnpm pkg set/.test(finding.remediation?.command ?? '')),
    false,
    'no version is invented when the lockfile records none',
  );
});

test('computes the 1-based line of each specifier key', () => {
  const findings = rule.detect(
    ctx({
      importers: [importer('.', ROOT_FLOATING)],
      lockfile: { path: '/repo/pnpm-lock.yaml', text: ROOT_FLOATING_LOCKFILE },
    }),
  );
  const lines = Object.fromEntries(
    findings
      .filter((finding) => finding.code === 'floating-range')
      .map((finding) => [finding.evidence.dependency, finding.line]),
  );

  assert.deepEqual(lines, {
    'left-pad': 4,
    tiny: 6,
    tagged: 7,
    remote: 8,
    waved: 9,
  });
});

test('reports floating ranges inside npm: redirects, file: tarballs and partial versions', () => {
  const text = `{
  "dependencies": {
    "redirected": "npm:left-pad@^1.3.0",
    "tarball": "file:../vendor/left-pad.tgz",
    "partial": "1.2",
    "major": "1",
    "ranged-workspace": "workspace:^1.3.0"
  }
}`;
  const findings = rule.detect(ctx({ importers: [importer('.', text)] }));
  const failures = findings.filter((finding) => finding.status === 'fail');

  assert.deepEqual(
    failures.map((finding) => finding.evidence.specifier),
    ['npm:left-pad@^1.3.0', 'file:../vendor/left-pad.tgz', '1.2', '1', 'workspace:^1.3.0'],
  );
});

test('exact versions, workspace:*, npm:<pkg>@<version> and link: are not findings', () => {
  const text = `{
  "dependencies": {
    "left-pad": "1.3.0",
    "prerelease": "2.0.0-rc.1",
    "internal": "workspace:*",
    "pinned": "workspace:1.2.3",
    "redirected": "npm:@scope/pkg@1.2.3",
    "linked": "link:../local"
  }
}`;
  const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    specifiers:
      left-pad: 1.3.0
      prerelease: 2.0.0-rc.1
      internal: 'workspace:*'
      pinned: 'workspace:1.2.3'
      redirected: npm:@scope/pkg@1.2.3
      linked: link:../local
`;
  const findings = rule.detect(
    ctx({
      importers: [importer('.', text)],
      lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile },
    }),
  );

  assert.deepEqual(
    findings.map((finding) => finding.status),
    ['pass'],
  );
});

test('a lockfile that records a different specifier is a lockfile-desync', () => {
  const text = `{
  "dependencies": {
    "left-pad": "^1.3.0",
    "missing": "1.0.0",
    "yaml": "2.9.0"
  }
}`;
  const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    specifiers:
      left-pad: 1.3.0
      yaml: 2.9.0
`;
  const findings = rule.detect(
    ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
  );
  const desync = findings.filter((finding) => finding.code === 'lockfile-desync');

  assert.deepEqual(desync.map((finding) => finding.evidence), [
    { specifier: '^1.3.0', resolved: '1.3.0' },
    { specifier: '1.0.0', resolved: null },
  ]);
  assert.deepEqual(desync.map((finding) => finding.line), [3, 4]);
  assert.ok(desync[1].message.includes('missing'));
  assert.deepEqual(desync[0].remediation, {
    kind: 'manual',
    command: 'pnpm install --lockfile-only',
  });
});

test('falls back to the importer dependency block when the specifiers map is absent', () => {
  const text = `{
  "dependencies": {
    "left-pad": "1.3.0"
  }
}`;
  const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      left-pad:
        specifier: 1.3.0
        version: 1.3.0
`;
  const findings = rule.detect(
    ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
  );

  assert.deepEqual(
    findings.map((finding) => finding.status),
    ['pass'],
  );
});

test('an unsupported lockfile shape is a skip and never a guessed comparison', () => {
  const text = `{
  "dependencies": {
    "left-pad": "1.3.0"
  }
}`;
  const findings = rule.detect(
    ctx({
      importers: [importer('.', text)],
      lockfile: { path: '/repo/pnpm-lock.yaml', text: "lockfileVersion: '8.0'\n\nimporters:\n\n  .:\n" },
    }),
  );

  assert.deepEqual(
    findings.map((finding) => [finding.status, finding.code]),
    [['skip', 'unsupported-lockfile-shape']],
  );
});

test('a lockfile skip names the file a reader can open, and keeps the line (S6)', () => {
  // `expected "key: value" at line 3` used to name no file: the skip carried no `path`, so a reader
  // could not tell which document the reader refused.
  const findings = rule.detect(
    ctx({
      importers: [importer('.', '{"dependencies":{"left-pad":"1.3.0"}}')],
      lockfile: { path: '/repo/pnpm-lock.yaml', text: "lockfileVersion: '9.0'\n\nimporters\n  .: {}\n" },
    }),
  );
  const [skip] = findings.filter((finding) => finding.code === 'unsupported-lockfile-shape');

  assert.equal(skip.path, 'pnpm-lock.yaml');
  assert.equal(skip.message, 'skipped: expected "key: value" at line 3');
  assert.match(skip.message, /line 3/, 'the line number stays, so the reader can open the file at it');
});

test('an importer that could not be parsed is named, never silently dropped (S4)', () => {
  // One unparseable importer beside a readable one used to disappear: the generic "no importer
  // package.json could be parsed" skip only fires when nothing was inspected at all.
  const broken = {
    path: '/repo/packages/api/package.json',
    text: '{ "dependencies": {',
    json: null,
    error: 'Unexpected end of JSON input',
    dir: 'packages/api',
  };
  const findings = rule.detect(
    ctx({
      importers: [importer('.', '{"dependencies":{"left-pad":"1.3.0"}}'), broken],
      lockfile: { path: '/repo/pnpm-lock.yaml', text: "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n" },
    }),
  );
  const skips = findings.filter((finding) => finding.code === 'unparseable-package-json');

  assert.equal(skips.length, 1);
  assert.equal(skips[0].status, 'skip');
  assert.equal(skips[0].path, 'packages/api/package.json');
  assert.match(skips[0].message, /packages\/api\/package\.json is not valid JSON/);
  assert.match(skips[0].message, /Unexpected end of JSON input/);
});

test('a byte-order mark is said in its own words here too (S4)', () => {
  const bom = {
    path: '/repo/package.json',
    text: '\uFEFF{"dependencies":{"left-pad":"1.3.0"}}',
    json: null,
    error: "Unexpected token '\uFEFF'",
    dir: '.',
  };
  const [skip] = rule.detect(
    ctx({
      importers: [bom],
      lockfile: { path: '/repo/pnpm-lock.yaml', text: "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n" },
    }),
  );

  assert.equal(skip.code, 'unparseable-package-json');
  assert.match(skip.message, /byte-order mark \(U\+FEFF\)/);
  assert.doesNotMatch(skip.message, /not valid JSON/);
});

test('a packages entry refused for escaping the root is named in the report (S8)', () => {
  // T3 refuses the entry and the importer disappears; an importer that disappears without a word is
  // the same defect in a quieter form, so the refusal reaches the report as a skip.
  const base = ctx({
    importers: [importer('.', '{"name":"inner"}')],
    lockfile: { path: '/repo/pnpm-lock.yaml', text: "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n" },
  });
  base.repo.skippedGlobs = [
    { entry: '..', code: 'outside-root', reason: 'resolves outside the repository root, so the entry is not expanded' },
  ];

  const [refused] = rule.detect(base);

  assert.equal(refused.status, 'skip');
  assert.equal(refused.code, 'workspace-entry-outside-root', 'the code says why');
  assert.equal(refused.path, 'pnpm-workspace.yaml', 'the file that holds the entry');
  assert.match(refused.message, /packages entry "\.\."/);
  assert.match(refused.message, /outside the repository root/);
  assert.deepEqual(refused.evidence, { entry: '..', reason: 'outside-root' });
  assert.deepEqual(refused.remediation, { kind: 'none' });
});

test('a nested glob is not reported as a refused importer (S8 names the refusal)', () => {
  // A nested glob is a documented limitation of the single-level expansion and not an entry the scan
  // refused: no positive pattern covered the directories it would have matched, so it stays silent. A
  // `!` negation is the other case and is named (0036), in its own words and never as a refusal.
  const base = ctx({
    importers: [importer('.', '{"name":"inner"}')],
    lockfile: { path: '/repo/pnpm-lock.yaml', text: "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n" },
  });
  base.repo.skippedGlobs = [
    { entry: 'apps/**', code: 'unsupported-glob', reason: 'a nested glob is not expanded, so its directories are not read' },
  ];

  assert.deepEqual(
    rule.detect(base).filter((finding) => String(finding.code ?? '').startsWith('workspace-entry')),
    [],
  );
});

/**
 * The skip `src/lib/targets.js` records for an entry that begins with `!` (0036). Spelled here so the
 * two tests below cannot disagree about what the expander hands the rule.
 */
const NEGATION_REASON = 'a negation is not applied, so it excludes nothing';

function negation(entry) {
  return { entry, code: 'workspace-entry-not-applied', reason: NEGATION_REASON };
}

function repoCtxWith(skippedGlobs) {
  const base = ctx({
    importers: [importer('.', '{"name":"root"}')],
    lockfile: { path: '/repo/pnpm-lock.yaml', text: "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n" },
  });
  base.repo.skippedGlobs = skippedGlobs;
  return base;
}

test('a packages negation is one skip finding naming the entry, never a refusal (S20, 0036)', () => {
  // A negation is the one entry a reader writes to keep something out, and funky-secure reads it
  // anyway: the line says that in those words, because saying the directories were not read — the
  // shape the `outside-root` refusal uses — would be false.
  const [finding] = rule.detect(repoCtxWith([negation('!**/test/**')])).filter(
    (item) => item.code === 'workspace-entry-not-applied',
  );

  assert.equal(finding.status, 'skip');
  assert.equal(finding.path, 'pnpm-workspace.yaml', 'the file that holds the entry');
  assert.match(finding.message, /packages entry "!\*\*\/test\/\*\*"/, 'the entry is named');
  assert.match(finding.message, /not applied/);
  assert.match(finding.message, /excludes nothing/);
  assert.doesNotMatch(finding.message, /refused/, 'a negation is ignored, not refused');
  assert.deepEqual(finding.evidence, { entry: '!**/test/**', reason: 'workspace-entry-not-applied' });
  assert.deepEqual(finding.remediation, { kind: 'none' });
});

test('four negations are four findings, and the verdict still counts the rule once (0008)', () => {
  // One finding per entry, because a reader who deletes one needs to see the remaining three — and the
  // verdict counts rules, not findings, so four lines under one rule stay `1 rule not verified`.
  const entries = ['!**/test/**', '!packages/*', '!test', '!**/generated/**'];
  const detected = rule.detect(repoCtxWith(entries.map(negation)));
  const named = detected.filter((finding) => finding.code === 'workspace-entry-not-applied');

  assert.equal(named.length, 4);
  assert.deepEqual(named.map((finding) => finding.evidence.entry), entries);

  const report = buildReport({
    scope: 'repo',
    policy: { preset: 'baseline', quarantineMinutes: 1440, failOn: 'error' },
    catalog: ruleCatalog,
    tool: { name: 'funky-secure', version: '0.1.0' },
    targets: [{ kind: 'repo-root', path: '.' }, { kind: 'importer', path: '.' }],
    findings: detected.map((finding) => ({
      ...finding,
      rule: 'exact-versions',
      severity: 'warn',
      scope: 'repo',
      target: 'importer',
      doc: 'funky-secure explain exact-versions',
      remediation: finding.remediation ?? { kind: 'none' },
    })),
  });
  const line = renderHuman(report)
    .split('\n')
    .find((rendered) => rendered.startsWith('verdict'));

  assert.equal(line, 'verdict  PASS (threshold: error · 1 rule not verified: exact-versions)');
});

test('floating findings survive an unsupported lockfile and the comparison is one skip', () => {
  const findings = rule.detect(
    ctx({
      importers: [importer('.', ROOT_FLOATING)],
      lockfile: { path: '/repo/pnpm-lock.yaml', text: "lockfileVersion: '8.0'\n\nimporters:\n\n  .:\n" },
    }),
  );

  assert.equal(findings.filter((finding) => finding.code === 'floating-range').length, 5);
  assert.deepEqual(
    findings.filter((finding) => finding.status === 'skip').map((finding) => finding.code),
    ['unsupported-lockfile-shape'],
  );
});

test('a missing lockfile reports the floating ranges and one skip for the comparison', () => {
  const findings = rule.detect(ctx({ importers: [importer('.', ROOT_FLOATING)] }));

  assert.equal(findings.filter((finding) => finding.code === 'floating-range').length, 5);
  assert.deepEqual(
    findings.filter((finding) => finding.status === 'skip').map((finding) => finding.code),
    ['no-lockfile'],
  );
});

test('uses the importer directory for the finding path and the lockfile importer key', () => {
  const api = `{
  "dependencies": {
    "left-pad": "^1.3.0"
  }
}`;
  const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    specifiers:
      left-pad: '^1.3.0'

  packages/api:
    specifiers:
      left-pad: '^1.3.0'
`;
  const findings = rule.detect(
    ctx({
      importers: [importer('.', ROOT_FLOATING), importer('packages/api', api)],
      lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile },
    }),
  );
  const apiFloat = findings.find(
    (finding) => finding.code === 'floating-range' && finding.path === 'packages/api/package.json',
  );

  assert.ok(apiFloat);
  assert.equal(apiFloat.line, 3);
  assert.equal(findings.filter((finding) => finding.code === 'lockfile-desync').length, 5);
});

test('an importer whose package.json did not parse is a skip, never a silent pass', () => {
  const broken = {
    path: '/repo/package.json',
    text: '{"dependencies": {"left-pad": "^1.3.0",}}',
    json: null,
    error: 'Unexpected token }',
    dir: '.',
  };
  const findings = rule.detect(
    ctx({ importers: [broken], lockfile: { path: '/repo/pnpm-lock.yaml', text: "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n" } }),
  );

  assert.deepEqual(
    findings.map((finding) => `${finding.status}:${finding.code}`),
    ['skip:unparseable-package-json'],
    'nothing was compared, so nothing may be claimed, and the file that could not be read is named',
  );
});

test('without a resolved repository the rule skips', () => {
  const [finding] = rule.detect({ ...ctx(), repo: null });

  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'no-repo');
  assert.equal(finding.probeUnavailable, true);
});

test('redacts credentials a URL specifier carries in its userinfo', () => {
  const text = `{
  "name": "demo",
  "dependencies": {
    "private-tarball": "https://user:ghp_secret@example.com/repo.tgz"
  }
}`;
  const [finding] = rule
    .detect(ctx({ importers: [importer('.', text)] }))
    .filter((entry) => entry.code === 'floating-range');

  assert.ok(finding, 'a URL specifier is a floating range');
  assert.equal(finding.evidence.specifier, 'https://***@example.com/repo.tgz');
  assert.match(finding.message, /https:\/\/\*\*\*@example\.com\/repo\.tgz/);
  assert.ok(!JSON.stringify(finding).includes('ghp_secret'), 'no credential reaches the report');
});

test('redacts a credential a recorded resolution carries, so the remediation never prints it', () => {
  const text = `{
  "dependencies": {
    "private-tarball": "https://user:ghp_secret@example.com/repo.tgz"
  }
}`;
  const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      private-tarball:
        specifier: https://user:ghp_secret@example.com/repo.tgz
        version: https://user:ghp_secret@example.com/repo.tgz
`;
  const [finding] = rule
    .detect(
      ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
    )
    .filter((entry) => entry.code === 'floating-range');

  assert.equal(
    finding.remediation.command,
    `pnpm pkg set dependencies.private-tarball=https://***@example.com/repo.tgz && pnpm install`,
  );
  assert.ok(!JSON.stringify(finding).includes('ghp_secret'), 'no credential reaches the report');
});

test('skips instead of passing when no package.json could be parsed', () => {
  const findings = rule.detect(
    ctx({
      importers: [
        { path: '/repo/package.json', text: '{ broken', json: null, error: null, dir: '.' },
      ],
      lockfile: { path: '/repo/pnpm-lock.yaml', text: ROOT_FLOATING_LOCKFILE },
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'skip');
  assert.equal(findings[0].code, 'unparseable-package-json');
  assert.equal(findings[0].path, 'package.json');
  assert.equal(findings[0].probeUnavailable, true);
});

/// The lockfile shapes real repositories have (field round 4): the pnpm 8 root record, the catalogue
/// map, and the two comparisons the reader used to invent.

test('a lockfileVersion 6.0 root record supplies the version a pin writes', () => {
  // vercel/nextjs-subscription-payments carries this shape. Every one of its floating ranges used to
  // be reported as "the lockfile records no version", which was false: the version is the line below
  // the specifier.
  const text = `{
  "dependencies": {
    "react": "^18.3.1"
  }
}`;
  const lockfile = [
    "lockfileVersion: '6.0'",
    '',
    'dependencies:',
    '  react:',
    '    specifier: ^18.3.1',
    '    version: 18.3.1(react-dom@18.3.1)',
    '',
  ].join('\n');

  const findings = rule.detect(
    ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
  );

  const floats = findings.filter((finding) => finding.code === 'floating-range');
  assert.equal(floats.length, 1);
  assert.equal(
    floats[0].remediation.command,
    `pnpm pkg set dependencies.react=18.3.1 && pnpm install`,
    'the version the 6.0 record carries is the version a pin writes',
  );
  assert.deepEqual(findings.filter((finding) => finding.status !== 'fail'), []);
});

test('a catalog: specifier is resolved through the catalogue the lockfile records', () => {
  // primefaces/primevue, sliced verbatim from its lockfile: `catalog:app` is exact when the app
  // catalogue pins it (`chart.js`), and floating when the catalogue itself holds a range.
  const text = `{
  "dependencies": {
    "chart.js": "catalog:app",
    "@docsearch/js": "catalog:app",
    "primeicons": "catalog:",
    "left-pad": "^1.3.0"
  }
}`;
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'catalogs:',
    '  app:',
    "    '@docsearch/js':",
    '      specifier: ^3',
    '      version: 3.9.0',
    '    chart.js:',
    '      specifier: 3.3.2',
    '      version: 3.3.2',
    '  default:',
    '    primeicons:',
    '      specifier: ^7.0.0',
    '      version: 7.0.0',
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    "      '@docsearch/js':",
    '        specifier: catalog:app',
    '        version: 3.9.0',
    '      chart.js:',
    '        specifier: catalog:app',
    '        version: 3.3.2',
    '      primeicons:',
    "        specifier: 'catalog:'",
    '        version: 7.0.0',
    '      left-pad:',
    '        specifier: ^1.3.0',
    '        version: 1.3.0',
    '',
  ].join('\n');

  const findings = rule.detect(
    ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
  );

  // The catalogs section no longer refuses the comparison: nothing is a skip and nothing desyncs.
  assert.deepEqual(
    findings.filter((finding) => finding.status === 'skip' || finding.code === 'lockfile-desync'),
    [],
  );

  const floats = findings.filter((finding) => finding.code === 'floating-range');
  assert.deepEqual(
    floats.map((finding) => [finding.path, finding.evidence.dependency]),
    [
      ['pnpm-workspace.yaml', '@docsearch/js'],
      ['pnpm-workspace.yaml', 'primeicons'],
      ['package.json', 'left-pad'],
    ],
    'the exact catalogue entry is not a finding, and a catalogue range names the file that holds it',
  );

  const [docsearch] = floats.filter((finding) => finding.evidence.dependency === '@docsearch/js');
  assert.equal(docsearch.line, undefined, 'the package.json line cannot be made exact, so no line is claimed');
  assert.match(docsearch.message, /catalog:app/);
  assert.match(docsearch.message, /pnpm-workspace\.yaml/);
  assert.match(docsearch.message, /app catalogue/);
  assert.deepEqual(docsearch.evidence, {
    specifier: '^3',
    dependency: '@docsearch/js',
    type: 'dependencies',
    catalog: 'app',
  });
  assert.match(docsearch.remediation.command, /pnpm-workspace\.yaml/);
  assert.match(docsearch.remediation.command, /3\.9\.0/);

  const primeicons = floats.find((finding) => finding.evidence.dependency === 'primeicons');
  assert.match(primeicons.message, /default catalogue/);
  assert.match(primeicons.remediation.command, /catalog\["primeicons"\]/);
});

test('a catalog: specifier the catalogue does not resolve is reported nowhere, never guessed', () => {
  const text = `{
  "dependencies": {
    "ghost": "catalog:missing"
  }
}`;
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'catalogs:',
    '  default:',
    '    left-pad:',
    '      specifier: 1.3.0',
    '      version: 1.3.0',
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      ghost:',
    '        specifier: catalog:missing',
    '        version: 1.3.0',
    '',
  ].join('\n');

  const findings = rule.detect(
    ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
  );

  assert.deepEqual(findings.filter((finding) => finding.status === 'fail'), []);
});

test('a peer dependency is never compared against another section record', () => {
  // shadcn-ui/ui packages/helpers: pnpm 9 records no `peerDependencies` in an importer block at all,
  // so the devDependency record of the same name is a different declaration and used to be reported
  // as a desync (7 of 8 were this).
  const text = `{
  "peerDependencies": {
    "@tanstack/ai": ">=0.40.0 <0.41.0"
  },
  "devDependencies": {
    "@tanstack/ai": "0.40.0"
  }
}`;
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    devDependencies:',
    '      @tanstack/ai:',
    '        specifier: 0.40.0',
    '        version: 0.40.0',
    '',
  ].join('\n');

  const findings = rule.detect(
    ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
  );

  assert.deepEqual(findings.filter((finding) => finding.code === 'lockfile-desync'), []);
  assert.equal(findings.filter((finding) => finding.code === 'floating-range').length, 1, 'the peer range still floats');
});

test('a peer dependency the lockfile does record as a peer is still compared', () => {
  const text = `{
  "peerDependencies": {
    "react": "18.3.1"
  }
}`;
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    peerDependencies:',
    '      react:',
    '        specifier: 17.0.2',
    '        version: 17.0.2',
    '',
  ].join('\n');

  const findings = rule.detect(
    ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
  );
  const desync = findings.filter((finding) => finding.code === 'lockfile-desync');

  assert.deepEqual(desync.map((finding) => finding.evidence), [{ specifier: '18.3.1', resolved: '17.0.2' }]);
});

test('a name the lockfile records under another kind is not a missing record', () => {
  // shadcn-ui/ui apps/v4 declares the same package in dependencies (^4.3.0, which the lockfile
  // records) and in devDependencies (^4). pnpm writes one record per importer, so the second entry is
  // not a desync, and comparing it against the first one invented one.
  const text = `{
  "dependencies": {
    "@tailwindcss/postcss": "^4.3.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4"
  }
}`;
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      @tailwindcss/postcss:',
    '        specifier: ^4.3.0',
    '        version: 4.3.0',
    '    devDependencies:',
    '      zod:',
    '        specifier: 3.25.76',
    '        version: 3.25.76',
    '',
  ].join('\n');

  const findings = rule.detect(
    ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
  );

  assert.deepEqual(findings.filter((finding) => finding.code === 'lockfile-desync'), []);
});

test('a specifier an override rewrote is not a desync', () => {
  // shadcn-ui/ui root: the manifest declares @types/react ^18.2.65 and the root `overrides` section
  // rewrites it to 19.2.2, so the lockfile record disagrees with the manifest by construction.
  const text = `{
  "dependencies": {
    "@types/react": "^18.2.65"
  }
}`;
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'overrides:',
    "  '@types/react': 19.2.2",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      @types/react:',
    '        specifier: 19.2.2',
    '        version: 19.2.2',
    '',
  ].join('\n');

  const findings = rule.detect(
    ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
  );

  assert.deepEqual(
    findings.filter((finding) => finding.status === 'skip'),
    [],
    'the overrides section no longer refuses the comparison',
  );
  assert.deepEqual(findings.filter((finding) => finding.code === 'lockfile-desync'), []);
  assert.equal(findings.filter((finding) => finding.code === 'floating-range').length, 1, 'the range still floats');
});

test('an override for another name does not exempt a desync', () => {
  const text = `{
  "dependencies": {
    "@types/react": "^18.2.65"
  }
}`;
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'overrides:',
    "  '@types/react-dom': 19.2.2",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      @types/react:',
    '        specifier: 19.2.2',
    '        version: 19.2.2',
    '',
  ].join('\n');

  const findings = rule.detect(
    ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
  );

  assert.deepEqual(
    findings.filter((finding) => finding.code === 'lockfile-desync').map((finding) => finding.evidence),
    [{ specifier: '^18.2.65', resolved: '19.2.2' }],
  );
});

test('a workspace range is pinned to workspace:*, and a registry range still names the recorded version', () => {
  const text = `{
  "dependencies": {
    "bare": "workspace:^",
    "waved": "workspace:~",
    "versioned": "workspace:^1.3.0",
    "registry": "^1.3.0"
  }
}`;
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      bare:',
    '        specifier: workspace:^',
    '        version: link:../lib',
    '      waved:',
    '        specifier: workspace:~',
    '        version: link:../lib',
    '      versioned:',
    '        specifier: workspace:^1.3.0',
    '        version: link:../lib',
    '      registry:',
    '        specifier: ^1.3.0',
    '        version: 1.3.0',
    '',
  ].join('\n');

  const commands = rule
    .detect(ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }))
    .filter((finding) => finding.code === 'floating-range')
    .map((finding) => finding.remediation.command);

  assert.deepEqual(
    commands,
    [
      // An internal package's resolved version is a path. Writing it replaces the protocol and takes
      // the package out of the workspace while the finding clears (#368); the exact form is the one
      // Detection names for an internal package.
      `pnpm pkg set dependencies.bare=workspace:* && pnpm install`,
      `pnpm pkg set dependencies.waved=workspace:* && pnpm install`,
      `pnpm pkg set dependencies.versioned=workspace:* && pnpm install`,
      `pnpm pkg set dependencies.registry=1.3.0 && pnpm install`,
    ],
    'a workspace range keeps the protocol and a registry range keeps the version the lockfile records',
  );
});

test('the remediation names the importer that owns the manifest', () => {
  // create-t3-app, 80 of 96 findings: `pnpm pkg set` run at the repository root wrote into the ROOT
  // package.json, not into the manifest the finding is about.
  const api = `{
  "dependencies": {
    "left-pad": "^1.3.0"
  }
}`;
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .: {}',
    '',
    '  packages/api:',
    '    dependencies:',
    '      left-pad:',
    '        specifier: ^1.3.0',
    '        version: 1.3.0',
    '',
  ].join('\n');

  const [finding] = rule
    .detect(
      ctx({ importers: [importer('packages/api', api)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
    )
    .filter((entry) => entry.code === 'floating-range');

  assert.equal(
    finding.remediation.command,
    `pnpm -C packages/api pkg set dependencies.left-pad=1.3.0 && pnpm -C packages/api install`,
  );
});

test('a -C directory takes a command only when it is provably safe (0042)', () => {
  // Measured on `cmd` and `bash`: bare `-C packages/a&b` splits the line and the install never runs, and
  // bare `-C packages/a^b` silently resolves to `packages/ab` with exit 0. Quoting fixes the split —
  // `-C "packages/a&b"`, `"packages/a;b"` and `"packages/a^b"` all arrive exact — and it does not fix
  // expansion: `%NAME%` still expands inside double quotes on `cmd`, and bash expands `$pkg`, `${pkg}`
  // and a backtick inside them, so `-C "packages/$pkg"` acts on a directory the manifest never named
  // (R1-SHELL-INJECTION-DIR, R4-DIR-QUOTING). A directory therefore takes a command only when every
  // character is one both shells pass through untouched; anything else takes the prose route.
  const pin = (dir) => pinCommand({ type: 'dependencies', dependency: 'left-pad', version: '1.3.0', dir });

  assert.equal(
    pin('packages/api'),
    `pnpm -C packages/api pkg set dependencies.left-pad=1.3.0 && pnpm -C packages/api install`,
    'a directory every shell passes through untouched lost its command',
  );

  for (const dir of [
    'packages/a&b',
    'packages/a;b',
    'packages/a^b',
    'packages/a b',
    'packages/a$b',
    'packages/a`b`',
    'packages/a%NAME%',
    'packages/a"b',
  ]) {
    assert.equal(pin(dir), null, `${dir}: a command was printed for a directory a shell would expand or split`);
  }
});

test('a workspace importer with no recorded version keeps the workspace-wide resolve step', () => {
  const api = `{
  "dependencies": {
    "ghost": "^9.9.9"
  }
}`;
  const lockfile = ["lockfileVersion: '9.0'", '', 'importers:', '', '  .: {}', '', '  packages/api: {}', ''].join('\n');

  const [finding] = rule
    .detect(
      ctx({ importers: [importer('packages/api', api)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
    )
    .filter((entry) => entry.code === 'floating-range');

  assert.equal(
    finding.remediation.command,
    'pnpm install --lockfile-only && funky-secure scan --only exact-versions',
    'the resolve step writes the lockfile, not a manifest, so it stays workspace-wide',
  );
});

test('a root finding keeps the bare pnpm form', () => {
  const text = `{
  "dependencies": {
    "left-pad": "^1.3.0"
  }
}`;
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      left-pad:',
    '        specifier: ^1.3.0',
    '        version: 1.3.0',
    '',
  ].join('\n');

  const [finding] = rule
    .detect(
      ctx({ importers: [importer('.', text)], lockfile: { path: '/repo/pnpm-lock.yaml', text: lockfile } }),
    )
    .filter((entry) => entry.code === 'floating-range');

  assert.equal(finding.remediation.command, `pnpm pkg set dependencies.left-pad=1.3.0 && pnpm install`);
});

/// S3's four sides and S4's three obligations, driven through the binary over fixtures built at
/// runtime. Side one starts from the desync fixture at `:301`: the same shape — a specifier the
/// lockfile records differently — with no registry name, because the runnable copies below re-resolve
/// the lockfile and a registry name would need a network the suite is not allowed to use (S5, 7.4).

/** The identity the suite's commits use: a global hook on the development machine refuses others. */
const IDENTITY = ['-c', 'user.email=82458865+MaxGB23@users.noreply.github.com', '-c', 'user.name=MaxGB23'];

const manifest = (specifier) => `{
  "name": "demo",
  "dependencies": {
    "left-pad": "${specifier}",
    "yaml": "2.9.0"
  }
}
`;
/** The :301 shape: the manifest floats, the lockfile records the `1.3.0` a resolution wrote. */
const LOCK_AGREEING = `lockfileVersion: '9.0'

importers:

  .:
    specifiers:
      left-pad: 1.3.0
      yaml: 2.9.0
`;

function capture() {
  return {
    text: '',
    write(chunk) {
      this.text += chunk;
      return true;
    },
    isTTY: false,
  };
}

/** One CLI run over a fixture, with the real probes the tool ships. */
async function cliOn(dir, argv) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(argv, { cwd: dir, env: process.env, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

function scanOn(dir, argv = []) {
  return cliOn(dir, ['scan', '--scope', 'repo', '--only', 'exact-versions', ...argv]);
}

async function reportOf(dir, argv = []) {
  const { code, stdout, stderr } = await scanOn(dir, [...argv, '--format', 'json']);
  assert.equal(stderr, '');
  return { code, report: JSON.parse(stdout) };
}

/** The counts and threshold the human report prints, read back out of its own lines. */
function humanSummary(text) {
  const counts = /^summary {2}(\d+) errors? · (\d+) warnings? · (\d+) info · (\d+) passing · (\d+) skipped$/m.exec(text);
  assert.ok(counts !== null, `the human report printed no summary line:\n${text}`);
  const verdict = /^verdict {2}(PASS|FAIL) \(threshold: (\w+)/m.exec(text);
  assert.ok(verdict !== null, `the human report printed no verdict line:\n${text}`);
  const [error, warn, info, pass, skip] = counts.slice(1).map(Number);
  return { error, warn, info, pass, skip, verdict: verdict[1], failOn: verdict[2] };
}

/** A committed repository: the tracked and ignored sets are repository facts this rule's run reads. */
function repository(t, files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-exact-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-qm', 'fixture']]) {
    execFileSync('git', [...IDENTITY, ...args], { cwd: dir, encoding: 'utf8' });
  }
  return dir;
}

/**
 * The only shape that re-resolves without a registry: a workspace link. `pnpm install` is genuinely
 * run below, so the fixture is a real workspace and its own `.npmrc` refuses the network.
 * `libVersion` is the workspace package's own version, which a versioned range has to satisfy for the
 * first install to be the shape a real repository would have.
 * @param {{ manifest: string, lockSpecifier: string, libVersion?: string }} shape
 */
function workspace(t, { manifest, lockSpecifier, libVersion = '1.0.0' }) {
  return repository(t, {
    'package.json': '{\n  "name": "fixture-root",\n  "private": true\n}\n',
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'packages/lib/package.json': `{\n  "name": "@fixture/lib",\n  "version": "${libVersion}"\n}\n`,
    'packages/app/package.json': `{"name":"@fixture/app","version":"1.0.0","dependencies":{"@fixture/lib":"${manifest}"}}\n`,
    '.npmrc': 'registry=http://127.0.0.1:9/\noffline=true\n',
    'pnpm-lock.yaml': `lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\n  packages/app:\n    dependencies:\n      '@fixture/lib':\n        specifier: '${lockSpecifier}'\n        version: link:../lib\n\n  packages/lib: {}\n`,
  });
}

/** The tokens a printed one-liner stands for: `a && b` is two commands, each without its `pnpm`. */
function argvOf(command) {
  // A printed command is shell text: a double-quoted argument may carry the escaped inner quotes the
  // bracketed property path needs — `"dependencies[\"@scope/lib\"]=1"` — so the token is unquoted and
  // unescaped before it reaches pnpm's argv, exactly as `cmd`, `bash` and `sh` hand it over (0042).
  return command.split(' && ').map((step) =>
    [...step.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)]
      .map(([, double, single, bare]) =>
        double !== undefined ? double.replaceAll('\\"', '"') : single !== undefined ? single : bare,
      )
      .slice(1),
  );
}

/** The resolver the tool owns answers which pnpm to run; without it the run cannot be measured. */
async function pnpmFor(t, dir) {
  const pnpm = await createCollector({ cwd: dir, env: process.env }).pnpm();
  if (pnpm.file === null) {
    t.skip(`pnpm did not answer (${pnpm.reason}), so the printed command cannot be run here`);
    return null;
  }
  // `npm_config_*` and `CI` are stripped on purpose: a CI runner exports `CI`, and pnpm reads it as
  // `--frozen-lockfile`, so the printed `pnpm install` refuses with ERR_PNPM_OUTDATED_LOCKFILE after the
  // step before it edited the manifest. The fixture is local and offline, so it is run as a developer
  // machine would run it, not as a CI job would.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key) && key.toUpperCase() !== 'CI'),
  );
  // A runner may also carry `frozen-lockfile=true` in a config file the fixture never sees, and the
  // printed `pnpm install` exists to update the lockfile after the step before it edited the manifest.
  // Pinning it here keeps the printed words verbatim while the fixture stops inheriting the runner.
  env.npm_config_frozen_lockfile = 'false';
  return (args) =>
    spawnSync(pnpm.file, [...(pnpm.prefixArgs ?? []), ...args], { cwd: dir, env, encoding: 'utf8' });
}

/// Side one: it fails, on a floating range and on a lockfile-desync, at the path it names.

test('side one: a floating range and a lockfile-desync fail at package.json, the path each names', async (t) => {
  const dir = repository(t, { 'package.json': manifest('^1.3.0'), 'pnpm-lock.yaml': LOCK_AGREEING });

  const { code, report } = await reportOf(dir);
  assert.equal(code, 0, 'a warning is below the default threshold, so the run exits 0');
  assert.deepEqual(report.summary, { error: 0, warn: 2, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings.map((finding) => finding.code), ['floating-range', 'lockfile-desync']);
  assert.deepEqual(report.findings.map((finding) => finding.path), ['package.json', 'package.json']);
  assert.deepEqual(report.findings.map((finding) => finding.line), [4, 4], 'the line of the dependency key');
  assert.equal((await scanOn(dir, ['--fail-on', 'warn'])).code, 1, '--fail-on warn makes the warning a gate');
});

/// Side two: it passes, and the pass is counted rather than merely absent.

test('side two: exact specifiers that agree with the lockfile pass, and the pass is counted', async (t) => {
  const dir = repository(t, { 'package.json': manifest('1.3.0'), 'pnpm-lock.yaml': LOCK_AGREEING });

  const { code, report } = await reportOf(dir);
  assert.equal(code, 0);
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' });
  assert.deepEqual(report.findings, [], 'a pass is counted and never listed');
  assert.match((await scanOn(dir)).stdout, /^ {5}all 1 rule pass$/m, 'the human print names the pass it counted');
});

/// Side three: it skips for want of a fact, with the code and the fact it names.

test('side three: an unparseable package.json skips with unparseable-package-json and names the fact', async (t) => {
  const dir = repository(t, { 'package.json': '{ "dependencies": {', 'pnpm-lock.yaml': LOCK_AGREEING });

  const { code, report } = await reportOf(dir);
  assert.equal(code, 0, 'a skip is not a failure');
  assert.deepEqual(report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 1, verdict: 'pass' });
  const [finding] = report.findings;
  assert.equal(finding.status, 'skip');
  assert.equal(finding.code, 'unparseable-package-json');
  assert.equal(finding.path, 'package.json');
  assert.match(finding.message, /^skipped: package\.json is not valid JSON \(/);
  assert.match(finding.message, /so its specifiers were not compared against pnpm-lock\.yaml$/);
  assert.equal(finding.evidence.problem, 'invalid-json', 'the skip names which problem it found');
});

/// Side four: off by policy, leaving neither a finding nor a count. Measured: no preset is the off switch.

test('side four: no preset turns the rule off, and --ignore, --only or config off leave no trace', async (t) => {
  const dir = repository(t, { 'package.json': manifest('^1.3.0'), 'pnpm-lock.yaml': LOCK_AGREEING });

  for (const [preset, severity] of [['baseline', 'warn'], ['strict', 'error'], ['starter', 'warn']]) {
    const { report } = await reportOf(dir, ['--preset', preset]);
    assert.equal(report.findings.length, 2, `${preset}: no preset turns this rule off`);
    assert.deepEqual(
      report.findings.map((finding) => finding.severity),
      [severity, severity],
      `${preset}: the preset decides the severity`,
    );
  }

  const ignored = await reportOf(dir, ['--ignore', 'exact-versions', '--only', 'exact-versions']);
  assert.deepEqual(ignored.report.findings, [], '--ignore leaves no finding, even beside --only');
  assert.deepEqual(ignored.report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });

  // `--only` of another rule is spelled here rather than through `scanOn`, which would add this rule back.
  const narrowed = JSON.parse(
    (await cliOn(dir, ['scan', '--scope', 'repo', '--only', 'lockfile-committed', '--format', 'json'])).stdout,
  );
  assert.equal(narrowed.findings.some((finding) => finding.rule === 'exact-versions'), false);
  assert.equal(narrowed.summary.warn, 0, '--only another rule leaves this rule no count either');
  assert.equal(narrowed.summary.skip, 0);

  writeFileSync(join(dir, 'funky-secure.config.json'), '{\n  "rules": {\n    "exact-versions": "off"\n  }\n}\n');
  const off = await reportOf(dir);
  assert.deepEqual(off.report.findings, []);
  assert.deepEqual(off.report.summary, { error: 0, warn: 0, info: 0, pass: 0, skip: 0, verdict: 'pass' });
  const human = await scanOn(dir);
  assert.match(human.stdout, /off by policy: Dependency ranges/);
});

/// S4, the two formats: the same flags answer the same status, location, count and verdict. Neither
/// format prints a `code`: the JSON document carries `code`, the human print carries the rule's label,
/// so the parity this asserts is the one both formats have.

test('obligation: both formats agree in every state the rule reaches, and neither prints a code twice', async (t) => {
  const states = [
    ['fail', repository(t, { 'package.json': manifest('^1.3.0'), 'pnpm-lock.yaml': LOCK_AGREEING })],
    ['pass', repository(t, { 'package.json': manifest('1.3.0'), 'pnpm-lock.yaml': LOCK_AGREEING })],
    ['skip', repository(t, { 'package.json': '{ "dependencies": {', 'pnpm-lock.yaml': LOCK_AGREEING })],
  ];

  for (const [state, dir] of states) {
    const json = await scanOn(dir, ['--format', 'json']);
    const human = await scanOn(dir);
    const report = JSON.parse(json.stdout);

    assert.equal(human.code, json.code, `${state}: the formats disagree about the exit code`);
    assert.equal(human.stderr, '', `${state}: the human run wrote to stderr`);
    const printed = humanSummary(human.stdout);
    assert.deepEqual(
      [printed.error, printed.warn, printed.info, printed.pass, printed.skip],
      [report.summary.error, report.summary.warn, report.summary.info, report.summary.pass, report.summary.skip],
      `${state}: the human counts differ from summary in the JSON document`,
    );
    assert.equal(printed.verdict, report.summary.verdict.toUpperCase(), `${state}: the verdicts differ`);
    assert.equal(printed.failOn, report.policy.failOn, `${state}: the thresholds differ`);

    const flat = human.stdout.replace(/\s+/g, ' ');
    for (const code of ['floating-range', 'lockfile-desync', 'unparseable-package-json']) {
      assert.equal(human.stdout.includes(code), false, `${state}: the human print carries a code (${code})`);
    }    const [finding] = report.findings;
    if (finding === undefined) {
      assert.equal(/Dependency ranges {2}·/.test(human.stdout), false, `${state}: the human print lists a finding`);
      continue;
    }
    assert.ok(flat.includes(finding.message.replace(/\s+/g, ' ')), `${state}: the message differs`);
    assert.ok(flat.includes(finding.path), `${state}: the human print omits the path the JSON names`);
    if (finding.remediation.command) {
      assert.ok(flat.includes(finding.remediation.command), `${state}: the command differs`);
    }
  }
});

/// S4, the remediation: the command a fail prints clears that fail on a disposable copy. The
/// printed one-liner is executed token for token, without a shell, so the quoting is the only part a
/// shell would have added.
///
/// 368: clearing the finding is not the assertion. Pinning an internal package to the path the
/// lockfile records as its resolved version replaces the `workspace:` protocol, so the package stops
/// being a workspace member and nothing said so. What is asserted is the specifier left behind.

test('obligation: applied to a workspace range the printed pin leaves the workspace protocol in place', async (t) => {
  // The two shapes measured on pnpm 12.3.4: a bare protocol range and a versioned one. Both are
  // floating, and both accept the same exact form.
  const shapes = [
    { manifest: 'workspace:^', lockSpecifier: 'workspace:^', libVersion: '1.0.0' },
    { manifest: 'workspace:^1.3.0', lockSpecifier: 'workspace:^1.3.0', libVersion: '1.4.0' },
  ];

  for (const shape of shapes) {
    const floating = workspace(t, shape);
    const pin = await pnpmFor(t, floating);
    if (pin === null) return;

    const before = await reportOf(floating);
    const [finding] = before.report.findings;
    assert.equal(finding.code, 'floating-range', `${shape.manifest}: the range was not reported`);
    assert.equal(
      finding.path,
      'packages/app/package.json',
      `${shape.manifest}: the finding names the manifest that declares the range`,
    );

    // The value the command writes is the defect: `link:../lib` is the path the lockfile records as
    // this dependency's resolved version, and writing it over `workspace:^` stops the package being a
    // workspace member. Clearing the finding is not what this asserts.
    assert.equal(
      finding.remediation.command,
      `pnpm -C packages/app pkg set "dependencies[\\"@fixture/lib\\"]=workspace:*" && pnpm -C packages/app install`,
      `${shape.manifest}: the pin names a value that is not the internal package's exact form`,
    );

    // The whole printed sequence is executed, and the one refusal it can meet is not hidden: a runner
    // with `frozen-lockfile` on refuses the install half *because* the manifest and the lockfile
    // disagree, which is the state the pin exists to fix. That refusal is a fact about the environment,
    // and it is reported as a skip with its reason — never as a pass, and never as a red suite. It is
    // also a finding of its own: the printed command cannot clear this finding under frozen-lockfile.
    for (const args of argvOf(finding.remediation.command)) {
      const ran = pin(args);
      if (ran.status !== 0 && /ERR_PNPM_OUTDATED_LOCKFILE/.test(ran.stderr ?? '')) {
        t.skip('this environment sets frozen-lockfile, so the install half of the printed sequence refuses by design');
        return;
      }
      assert.equal(ran.status, 0, `a printed command failed: ${args.join(' ')}\n${ran.stderr}`);
    }

    const written = JSON.parse(readFileSync(join(floating, 'packages/app/package.json'), 'utf8')).dependencies[
      '@fixture/lib'
    ];
    assert.equal(
      written,
      'workspace:*',
      `${shape.manifest}: the manifest is ${written}, so the dependency left the workspace it was declared in`,
    );
    assert.match(written, /^workspace:/, 'the resulting specifier carries the workspace protocol');
    assert.match(
      readFileSync(join(floating, 'pnpm-lock.yaml'), 'utf8'),
      /specifier: workspace:\*/,
      `${shape.manifest}: the lockfile records no workspace specifier after the pin`,
    );
    assert.equal(
      realpathSync(join(floating, 'packages/app/node_modules/@fixture/lib')),
      realpathSync(join(floating, 'packages/lib')),
      'the package is still linked into the workspace, not copied from a path',
    );

    const cleared = await reportOf(floating);
    assert.deepEqual(cleared.report.findings, [], `${shape.manifest}: the printed pin did not clear its own finding`);
    assert.deepEqual(
      cleared.report.summary,
      { error: 0, warn: 0, info: 0, pass: 1, skip: 0, verdict: 'pass' },
      'the cleared state is one counted pass and nothing else',
    );
  }
});

test('obligation: the printed desync command resolves the desync it names', async (t) => {
  const desynced = workspace(t, { manifest: 'workspace:*', lockSpecifier: 'workspace:^' });
  const refresh = await pnpmFor(t, desynced);
  if (refresh === null) return;

  const [desync] = (await reportOf(desynced)).report.findings;
  assert.equal(desync.code, 'lockfile-desync');
  assert.deepEqual(desync.remediation, { kind: 'manual', command: 'pnpm install --lockfile-only' });
  const resolved = refresh(argvOf(desync.remediation.command)[0]);
  assert.equal(resolved.status, 0, `the printed command failed:\n${resolved.stderr}`);
  const after = await reportOf(desynced);
  assert.deepEqual(after.report.findings, [], 'the printed command did not resolve the desync it named');
  assert.equal(after.report.summary.pass, 1);
});
/// 369: the no-lockfile skip names the fact it measured. The lockfile was not there, so the
/// specifier-versus-lockfile comparison did not run — and the run still walked every manifest it
/// found, so the sentence may claim nothing about importers and may not read as a whole-rule skip.

/** The one sentence both no-lockfile fixtures must print, verbatim. */
const NO_LOCKFILE_MESSAGE =
  'skipped: no pnpm-lock.yaml, so the specifier-versus-lockfile comparison did not run';

test('with neither package.json nor a lockfile, the one skip names the lockfile the comparison missed', async (t) => {
  const empty = repository(t, { 'README.md': 'x\n' });
  const { code, report } = await reportOf(empty);

  assert.deepEqual(report.findings.map((finding) => finding.code), ['no-lockfile']);
  assert.equal(code, 0, 'a skip with no error under the threshold is not a failure');
  assert.equal(report.findings[0].message, NO_LOCKFILE_MESSAGE);
  assert.doesNotMatch(report.findings[0].message, /importer/, 'the message claims nothing about an importer');
});

test('with a manifest and no lockfile, the same skip sits beside the floating ranges the run did establish', async (t) => {
  const floating = repository(t, { 'package.json': ROOT_FLOATING });
  const { report } = await reportOf(floating);
  const codes = report.findings.map((finding) => finding.code);
  const skip = report.findings.find((finding) => finding.code === 'no-lockfile');

  assert.equal(codes.filter((code) => code === 'floating-range').length, 5, 'the importer was read');
  assert.deepEqual(
    codes.filter((code) => code !== 'floating-range'),
    ['no-lockfile'],
    'the comparison is the only thing the missing lockfile skipped',
  );
  assert.equal(skip.message, NO_LOCKFILE_MESSAGE);
  assert.equal(report.summary.skip, 1, 'one skip, not one per importer');
});
/// S4, the page: it describes what the run does. One sentence did not, and it is corrected here.

test('obligation: the page names every command the run prints, and describes the no-importer skip', async (t) => {
  const page = await readFile(new URL('../../docs/rules/exact-versions.md', import.meta.url), 'utf8');

  const withLockfile = repository(t, { 'package.json': manifest('^1.3.0'), 'pnpm-lock.yaml': LOCK_AGREEING });
  const commands = new Set(
    (await reportOf(withLockfile)).report.findings.map((finding) => finding.remediation.command),
  );
  assert.deepEqual(
    [...commands],
    ['pnpm install --lockfile-only && funky-secure scan --only exact-versions', 'pnpm install --lockfile-only'],
  );
  for (const command of commands) {
    assert.ok(page.includes(command), `the page never names \`${command}\`, which the finding prints`);
    // The plan says this rule's findings carry `pnpm add` commands; measured, not one does.
    assert.equal(command.startsWith('pnpm add'), false);
  }
  assert.ok(page.includes('pnpm -C <importer dir> pkg set'), 'the page documents the pin the run prints');
  assert.match(
    page,
    /pkg set "\.?\w*Dependencies\[\\"<name>\\"\]/u,
    'the page uses the bracket property path, double-quoted with its inner quotes escaped',
  );
  assert.match(page, /pnpm add --save-exact <name>@<range>\` is a measured no-op/, 'the page keeps the measurement');

  // The corrected sentence: with no lockfile and no importer, the run reports `no-lockfile` alone.
  const noImporter = repository(t, { 'pnpm-lock.yaml': LOCK_AGREEING });
  const unreadable = (await reportOf(noImporter)).report.findings;
  assert.deepEqual(unreadable.map((finding) => finding.code), ['unreadable-package-json']);
  const bare = repository(t, { 'README.md': 'x\n' });
  const bareFindings = (await reportOf(bare)).report.findings;
  assert.deepEqual(
    bareFindings.map((finding) => finding.code),
    ['no-lockfile'],
    'with no lockfile either, the single skip names the lockfile and not the missing importer',
  );
  assert.equal(page.includes('and `no-lockfile` when there is no lockfile either'), false, 'the wrong sentence survived');
  assert.match(page, /the single skip is `no-lockfile`/);
});
