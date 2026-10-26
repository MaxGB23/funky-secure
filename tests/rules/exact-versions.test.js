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
      { kind: 'manual', command: "pnpm pkg set 'dependencies.left-pad=1.3.0' && pnpm install" },
      {
        kind: 'manual',
        command: "pnpm pkg set 'devDependencies.@scope/tool=2.0.1' && pnpm install",
      },
    ],
  );
  assert.deepEqual(
    floats.map((finding) => finding.remediation.command.includes('--save-exact')),
    [false, false],
    'the measured no-op command is never printed',
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
    ['skip:unreadable-package-json'],
    'nothing was compared, so nothing may be claimed',
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
    `pnpm pkg set 'dependencies.private-tarball=https://***@example.com/repo.tgz' && pnpm install`,
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
  assert.equal(findings[0].code, 'unreadable-package-json');
  assert.equal(findings[0].probeUnavailable, true);
});
