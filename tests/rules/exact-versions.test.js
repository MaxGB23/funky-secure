import test from 'node:test';
import assert from 'node:assert/strict';

import rule from '../../src/rules/exact-versions.js';

/**
 * A plain context: package.json texts and a lockfile text are the only inputs, so no filesystem and
 * no probe are involved. Line numbers asserted below are the lines of these literals.
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
      { kind: 'manual', command: `pnpm pkg set 'dependencies["left-pad"]=1.3.0' && pnpm install` },
      {
        kind: 'manual',
        command: `pnpm pkg set 'devDependencies["@scope/tool"]=2.0.1' && pnpm install`,
      },
    ],
  );
  assert.deepEqual(
    floats.map((finding) => finding.remediation.command.includes('--save-exact')),
    [false, false],
    'the measured no-op command is never printed',
  );
});

test('the pnpm pkg path is bracketed, because a dot path cannot carry a scoped name', () => {
  // Measured on pnpm 12.3.4: `pnpm pkg set 'devDependencies.@types/node=20.19.43'` exits non-zero with
  // ERR_PNPM_PKG_INVALID_PROPERTY_PATH ("Unexpected token \"@\" in property path"), while
  // `pnpm pkg set 'devDependencies["@types/node"]=20.19.43'` writes the exact version. Most of a modern
  // dependency set is scoped, so the dot form was failing on the common case. The bracket form is used
  // for unscoped names too: one form, one thing to remember.
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
    `pnpm pkg set 'devDependencies["@types/node"]=20.19.43' && pnpm install`,
  );
  assert.equal(
    finding.remediation.command.includes('devDependencies.@'),
    false,
    'the dot form never reaches a scoped name',
  );
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
  // A nested glob, including a `!` negation such as shadcn-ui/ui's `!**/test/**`, is a documented
  // limitation of the single-level expansion and not an entry the scan refused: saying its directories
  // were not read would be false for a negation.
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
    `pnpm pkg set 'dependencies["private-tarball"]=https://***@example.com/repo.tgz' && pnpm install`,
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
    `pnpm pkg set 'dependencies["react"]=18.3.1' && pnpm install`,
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
    `pnpm -C packages/api pkg set 'dependencies["left-pad"]=1.3.0' && pnpm -C packages/api install`,
  );
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

  assert.equal(finding.remediation.command, `pnpm pkg set 'dependencies["left-pad"]=1.3.0' && pnpm install`);
});
