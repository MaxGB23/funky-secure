import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  machineFacts,
  majorOf,
  manifestProblem,
  repoFacts,
  workspacePackageEntries,
} from '../src/lib/targets.js';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'funky-secure-targets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, path, content) {
  const full = join(dir, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

function collectorOver({ version = '12.3.4', config = {}, tracked = [], ignored = [] } = {}) {
  return {
    async read(path) {
      try {
        return { ok: true, value: readFileSync(path, 'utf8') };
      } catch {
        return { ok: false };
      }
    },
    async git(args) {
      if (args[0] === 'check-ignore') {
        return ignored.length === 0
          ? { ok: true, code: 1, stdout: '' }
          : { ok: true, code: 0, stdout: ignored.map((path) => `${path}\0`).join('') };
      }
      return { ok: true, code: 0, stdout: tracked.map((path) => `${path}\0`).join('') };
    },
    async pnpmVersion() {
      return version === null
        ? { ok: false, reason: 'not-on-path', installations: [] }
        : { ok: true, version, major: majorOf(version), executable: 'C:\\pnpm\\pnpm.exe', installations: ['C:\\pnpm\\pnpm.exe'] };
    },
    async pnpmConfig() {
      return Object.keys(config).length === 0
        ? { ok: false, reason: 'failed' }
        : { ok: true, config };
    },
  };
}

test('parses the packages list by line, ignoring comments and quotes', () => {
  const text = [
    'packages:',
    "  - 'packages/*'",
    '  - apps/web # the web app',
    '',
    'minimumReleaseAge: 1440',
  ].join('\n');

  assert.deepEqual(workspacePackageEntries(text).entries, ['packages/*', 'apps/web']);
  assert.deepEqual(workspacePackageEntries('catalog:\n  react: 19.0.0\n').entries, []);
});

test('reads the major from a version and refuses to guess', () => {
  assert.equal(majorOf('12.3.4'), 12);
  assert.equal(majorOf('9.15.0'), 9);
  assert.equal(majorOf('not-a-version'), null);
  assert.equal(majorOf(undefined), null);
});

test('reports a machine without pnpm as unavailable instead of failing', async () => {
  const { facts, targets } = await machineFacts(collectorOver({ version: null }));

  assert.equal(facts.available, false);
  assert.equal(facts.version, null);
  assert.deepEqual(targets, [{ kind: 'machine', detail: 'pnpm unavailable on this machine' }]);
});

test('carries the probe that did not answer, so the two absences stay different facts (#354)', async () => {
  const over = (version) => ({
    async pnpmVersion() {
      return version;
    },
    async pnpmConfig() {
      return { ok: false, reason: 'failed' };
    },
  });

  const unresolvable = await machineFacts(over({ ok: false, reason: 'not-on-path', probe: 'where pnpm', installations: [] }));
  const failed = await machineFacts(over({ ok: false, reason: 'failed', probe: 'pnpm --version' }));
  const answered = await machineFacts(
    over({ ok: true, version: '12.3.4', major: 12, executable: 'C:\\pnpm\\pnpm.exe', installations: [] }),
  );

  assert.equal(unresolvable.facts.unansweredProbe, 'where pnpm');
  assert.equal(failed.facts.unansweredProbe, 'pnpm --version');
  assert.equal(answered.facts.unansweredProbe, null, 'a version that answered leaves no probe to name');
  assert.deepEqual(
    unresolvable.targets,
    failed.targets,
    'the machine target is unchanged: which probe ran out belongs to the finding, not to the target list',
  );
});

test('reports the version, the store and the version ambiguity as separate facts', async () => {  const agreeing = await machineFacts(
    collectorOver({ config: { storeDir: 'M:/.pnpm-store', userAgent: 'pnpm/12.3.4 npm/? node/? win32 x64' } }),
  );
  const disagreeing = await machineFacts(
    collectorOver({ config: { storeDir: 'M:/.pnpm-store', userAgent: 'pnpm/11.5.0 npm/? node/? win32 x64' } }),
  );

  assert.equal(agreeing.facts.versionAmbiguous, false);
  assert.equal(agreeing.facts.major, 12);
  assert.equal(agreeing.facts.storePath, 'M:/.pnpm-store');
  assert.equal(agreeing.targets.length, 1);
  assert.match(agreeing.targets[0].detail, /^pnpm 12\.3\.4 \(.*\) {2}· {2}store M:\/\.pnpm-store$/);

  assert.equal(disagreeing.facts.versionAmbiguous, true);
  assert.equal(disagreeing.targets.length, 2);
  assert.match(disagreeing.targets[1].detail, /^version ambiguity: pnpm --version answered 12\.3\.4, configuration reports pnpm\/11\.5\.0$/);
});

test('resolves the root package plus every single-level workspace importer', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
  write(dir, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n  - apps/**\n');
  write(dir, 'packages/api/package.json', JSON.stringify({ name: 'api' }));
  write(dir, 'packages/web/package.json', JSON.stringify({ name: 'web' }));

  const { facts, targets } = await repoFacts({
    collector: collectorOver({ tracked: ['package.json', 'pnpm-lock.yaml'] }),
    cwd: dir,
    root: dir,
  });

  assert.deepEqual(
    facts.importers.map((importer) => importer.dir),
    ['.', 'packages/api', 'packages/web'],
  );
  assert.deepEqual(facts.skippedGlobs, [
    {
      entry: 'apps/**',
      code: 'unsupported-glob',
      reason: 'a nested glob is not expanded, so its directories are not read',
    },
  ], 'a nested glob is reported, never silently ignored');
  assert.deepEqual(
    targets.map((target) => `${target.kind}:${target.path ?? ''}`),
    ['repo-root:.', 'importer:.', 'importer:packages/api/package.json', 'importer:packages/web/package.json'],
  );
  assert.equal(facts.inGit, true);
  assert.deepEqual([...facts.tracked], ['package.json', 'pnpm-lock.yaml']);
});

test('refuses a packages: entry that resolves outside the repository root (S3)', async (t) => {
  // A `packages:` entry of `..` was expanded as a path: the scan read the parent manifest and printed
  // `IMPORTER  ../package.json`, a file the repository does not contain. The entry is refused instead,
  // by the same containment decision the write guard already makes, and it is named where it was
  // skipped.
  const outer = scratch(t);
  const dir = join(outer, 'inner');

  write(outer, 'package.json', JSON.stringify({ name: 'outer', dependencies: { 'left-pad': '^1.3.0' } }));
  write(dir, 'package.json', JSON.stringify({ name: 'inner' }));
  write(dir, 'pnpm-workspace.yaml', 'packages:\n  - ..\n  - ../..\n  - packages/*\n');
  write(dir, 'packages/api/package.json', JSON.stringify({ name: 'api' }));

  const { facts, targets } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(
    facts.importers.map((importer) => importer.dir),
    ['.', 'packages/api'],
    'the parent manifest is never read, and a single-level glob beside it still expands',
  );
  assert.deepEqual(
    targets.map((target) => `${target.kind}:${target.path ?? ''}`),
    ['repo-root:.', 'importer:.', 'importer:packages/api/package.json'],
    'no importer target outside the root is resolved',
  );
  assert.deepEqual(facts.skippedGlobs, [
    {
      entry: '..',
      code: 'outside-root',
      reason: 'resolves outside the repository root, so the entry is not expanded',
    },
    {
      entry: '../..',
      code: 'outside-root',
      reason: 'resolves outside the repository root, so the entry is not expanded',
    },
  ]);
});

/**
 * The one skip a negation produces, whatever follows the bang (0036). Spelled here so the three
 * shape tests below cannot disagree about what a negation is recorded as.
 */
function notApplied(entry) {
  return {
    entry,
    code: 'workspace-entry-not-applied',
    reason: 'a negation is not applied, so it excludes nothing',
  };
}

test('names a nested-glob negation instead of letting the glob decide its fate (S20, 0036)', async (t) => {
  // `!**/test/**` reached the skip list only because it happened to carry two `*`: a negation whose
  // shape test landed somewhere else produced no record at all. The bang is classified first, so the
  // entry is named the same way whatever follows it, and the positive `**` that covers its directories
  // keeps its own documented silence.
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, 'pnpm-workspace.yaml', 'packages:\n  - "**"\n  - "!**/test/**"\n');
  write(dir, 'packages/api/package.json', JSON.stringify({ name: 'api' }));
  write(dir, 'packages/api/test/package.json', JSON.stringify({ name: 'fixtures' }));

  const { facts, targets } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(facts.skippedGlobs, [
    {
      entry: '**',
      code: 'unsupported-glob',
      reason: 'a nested glob is not expanded, so its directories are not read',
    },
    notApplied('!**/test/**'),
  ]);
  assert.deepEqual(
    targets.map((target) => `${target.kind}:${target.path ?? ''}`),
    ['repo-root:.', 'importer:.'],
    'a negation is never honoured, so no directory under it becomes an importer',
  );
});

test('names a one-glob negation the expansion branch used to swallow (S20, 0036)', async (t) => {
  // `!packages/*` took the expansion branch, `readdir('!packages')` threw, and the catch returned an
  // empty record set: the entry vanished with no skip to filter. Classifying the bang first means the
  // entry never reaches the branch that can only fail.
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, 'pnpm-workspace.yaml', 'packages:\n  - "**"\n  - "!packages/*"\n');
  write(dir, 'packages/api/package.json', JSON.stringify({ name: 'api' }));

  const { facts } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(facts.skippedGlobs, [
    {
      entry: '**',
      code: 'unsupported-glob',
      reason: 'a nested glob is not expanded, so its directories are not read',
    },
    notApplied('!packages/*'),
  ]);
  assert.deepEqual(facts.importers.map((importer) => importer.dir), ['.'], 'and it expands nothing');
});

test('names a bare negation that used to be read as a literal directory (S20, 0036)', async (t) => {
  // `!test` carries no `*`, so it was returned as `dirs: ['!test']`: the entry was not a pattern at all
  // and the scan asked for `!test/package.json`. The bang is classified before the no-`*` return, so a
  // bare negation is reported exactly like a glob one.
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, 'pnpm-workspace.yaml', 'packages:\n  - "**"\n  - "!test"\n');
  write(dir, 'test/package.json', JSON.stringify({ name: 'fixtures' }));
  write(dir, '!test/package.json', JSON.stringify({ name: 'invented' }));

  const { facts, targets } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(facts.skippedGlobs, [
    {
      entry: '**',
      code: 'unsupported-glob',
      reason: 'a nested glob is not expanded, so its directories are not read',
    },
    notApplied('!test'),
  ]);
  assert.deepEqual(
    facts.importers.map((importer) => importer.dir),
    ['.'],
    'the negation is not a directory, so no importer named `!test` is invented',
  );
  assert.deepEqual(
    targets.map((target) => `${target.kind}:${target.path ?? ''}`),
    ['repo-root:.', 'importer:.'],
    'and no target is resolved from a bang-prefixed path',
  );
});

test('records a malformed package.json instead of throwing', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', '{ nope');

  const { facts } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.equal(facts.files.packageJson.json, null);
  assert.match(facts.files.packageJson.error, /JSON/);
});

test('classifies a package.json it could not interpret, so a rule can name the fact (S4)', async (t) => {
  // The parse error was stored here and read by nobody, so a truncated manifest or one that opens with
  // a byte-order mark made the scan pass. The classification lives here, once, and both rules that read
  // a manifest consume it: a byte-order mark is not "invalid JSON" and says so in its own words.
  const dir = scratch(t);
  const read = async () => (await repoFacts({ collector: collectorOver(), cwd: dir, root: dir })).facts.files.packageJson;

  write(dir, 'package.json', '\uFEFF{ "name": "bom" }\n');
  assert.deepEqual(manifestProblem(await read()), {
    code: 'byte-order-mark',
    detail: 'starts with a byte-order mark (U+FEFF), which JSON does not allow',
  });

  write(dir, 'package.json', '{ "name": "truncated"');
  const truncated = manifestProblem(await read());
  assert.equal(truncated.code, 'invalid-json');
  assert.match(truncated.detail, /is not valid JSON \(/);

  write(dir, 'package.json', '[]');
  assert.deepEqual(manifestProblem(await read()), {
    code: 'not-an-object',
    detail: 'does not contain a JSON object',
  });

  write(dir, 'package.json', JSON.stringify({ name: 'readable' }));
  assert.equal(manifestProblem(await read()), null, 'a manifest that parsed is not a problem');
  assert.equal(manifestProblem(null), null, 'an absent manifest is absent, not unreadable');
});

test('works outside git, checking only what exists', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'lonely' }));

  const { facts, targets } = await repoFacts({ collector: collectorOver({ tracked: null }), cwd: dir, root: null });

  assert.equal(facts.inGit, false);
  assert.equal(facts.tracked, null);
  assert.equal(facts.root, dir);
  assert.deepEqual(facts.present.sort(), ['package.json']);
  assert.deepEqual(targets.map((target) => target.kind), ['repo-root', 'importer']);
});

test('resolves the ignore behavior of the declared candidates once, for R7 to read', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));

  const { facts } = await repoFacts({
    collector: collectorOver({ ignored: ['.env', '.npmrc'] }),
    cwd: dir,
    root: dir,
  });

  assert.equal(facts.ignoreCandidates.length, 6);
  assert.deepEqual([...facts.ignored].sort(), ['.env', '.npmrc']);
});

test('lists workflows and bot configs as ci targets', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, '.github/workflows/ci.yml', 'name: ci\n');
  write(dir, '.github/workflows/notes.txt', 'ignored\n');
  write(dir, '.github/dependabot.yml', 'version: 2\n');

  const { facts, targets } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(facts.workflows.map((file) => file.path), ['.github/workflows/ci.yml']);
  assert.deepEqual(facts.botFiles, ['.github/dependabot.yml']);
  assert.deepEqual(facts.actionFiles, [], 'a workflow-only repository has no action metadata');
  assert.deepEqual(
    targets.filter((target) => target.kind === 'ci'),
    [{ kind: 'ci', path: '.github/workflows' }],
    'a workflow-only repository resolves one ci target, unchanged',
  );
});

/**
 * The measured set of 8.2 R9 (0039): the spellings Renovate's File Matching page names, which that
 * page expresses as the glob `renovate.json{,c,5}`, plus Dependabot's two. A spelling missing here is
 * a repository that scans clean while the tool is configured, and the rule emits one finding for the
 * set, so the list is what the finding can ever be built from.
 */
const BOT_SPELLINGS = [
  'renovate.json',
  'renovate.jsonc',
  'renovate.json5',
  '.github/renovate.json',
  '.github/renovate.jsonc',
  '.github/renovate.json5',
  '.gitlab/renovate.json',
  '.gitlab/renovate.jsonc',
  '.gitlab/renovate.json5',
  '.renovaterc',
  '.renovaterc.json',
  '.renovaterc.jsonc',
  '.renovaterc.json5',
  '.github/dependabot.yml',
  '.github/dependabot.yaml',
];

test('resolves every bot configuration spelling into its own botFiles entry (8.2 R9, 0039)', async (t) => {
  for (const spelling of BOT_SPELLINGS) {
    const dir = scratch(t);
    write(dir, 'package.json', JSON.stringify({ name: 'root' }));
    write(dir, spelling, '{}\n');

    const { facts } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

    assert.deepEqual(facts.botFiles, [spelling], `${spelling} is a file Renovate or Dependabot reads`);
  }
});

test('reads the renovate key of the root manifest, and names it package.json#renovate (8.2 R9, 0039)', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root', renovate: { extends: ['config:recommended'] } }));

  const { facts } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(
    facts.botFiles,
    ['package.json#renovate'],
    'the key is the configuration and the manifest alone is not, so the entry names the key',
  );
});

test('keeps the two original entries ahead of every appended spelling (0039)', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, '.github/dependabot.yml', 'version: 2\n');
  write(dir, '.github/renovate.json', '{}\n');
  write(dir, 'renovate.json', '{}\n');

  const { facts } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(
    facts.botFiles,
    ['.github/dependabot.yml', '.github/renovate.json', 'renovate.json'],
    'the two paths the rule has always read keep their positions; a spelling is only ever appended',
  );
});

test('answers no manifest configuration for a manifest it could not read (S4, 0039)', async (t) => {
  const cases = [
    ['a byte-order mark', '\uFEFF{"name":"root","renovate":{}}'],
    ['a truncated file', '{"name":"root","renovate":{'],
    ['an array', '[]'],
    ['no renovate key', '{"name":"root"}'],
  ];

  for (const [name, text] of cases) {
    const dir = scratch(t);
    write(dir, 'package.json', text);

    const { facts } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

    assert.deepEqual(facts.botFiles, [], `${name} is presence=false, and reading it must not throw`);
  }
});

test('never reads a workspace importer for a repository-root configuration (0039)', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
  write(dir, 'packages/a/package.json', JSON.stringify({ name: 'a', renovate: {} }));

  const { facts } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(
    facts.botFiles,
    [],
    "a member's key is not a repository-root finding, so the importer is not read for it",
  );
});

test('answers no bot configuration for a repository that carries none (8.2 R9, 0039)', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, 'README.md', '# root\n');

  const { facts } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(facts.botFiles, []);
});

test('collects composite action metadata at any depth as a ci target', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, '.github/actions/setup/action.yml', 'name: setup\nruns:\n  using: composite\n  steps:\n    - run: echo\n');
  write(dir, '.github/actions/nested/deep/lint/action.yaml', 'name: lint\n');
  write(dir, '.github/actions/setup/notes.txt', 'ignored\n');
  write(dir, '.github/actions/setup/action.yml.bak', 'ignored\n');

  const { facts, targets } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(facts.actionFiles.map((file) => file.path), [
    '.github/actions/nested/deep/lint/action.yaml',
    '.github/actions/setup/action.yml',
  ]);
  assert.match(facts.actionFiles[1].text, /^name: setup$/m);
  assert.deepEqual(
    targets.filter((target) => target.kind === 'ci'),
    [{ kind: 'ci', path: '.github/actions' }],
  );
});

test('resolves both ci roots when a repository has workflows and actions', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, '.github/workflows/ci.yml', 'name: ci\n');
  write(dir, '.github/actions/setup/action.yml', 'name: setup\n');

  const { facts, targets } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(facts.workflows.map((file) => file.path), ['.github/workflows/ci.yml']);
  assert.deepEqual(facts.actionFiles.map((file) => file.path), ['.github/actions/setup/action.yml']);
  assert.deepEqual(
    targets.filter((target) => target.kind === 'ci'),
    [
      { kind: 'ci', path: '.github/workflows' },
      { kind: 'ci', path: '.github/actions' },
    ],
  );
});

test('resolves whether a root .npmrc is tracked without a token', async (t) => {
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, '.npmrc', 'registry=https://registry.npmjs.org/\n');

  const tokenless = await repoFacts({
    collector: collectorOver({ tracked: ['.npmrc'] }),
    cwd: dir,
    root: dir,
  });

  assert.deepEqual(tokenless.facts.npmrc, { tracked: true, hasToken: false, tokenlessTracked: true });

  write(dir, '.npmrc', '//registry.npmjs.org/:_authToken=secret\n');
  const withToken = await repoFacts({
    collector: collectorOver({ tracked: ['.npmrc'] }),
    cwd: dir,
    root: dir,
  });

  assert.deepEqual(withToken.facts.npmrc, { tracked: true, hasToken: true, tokenlessTracked: false });
});


test('reports a negation that also leaves the root, and reads nothing for it (S20, 0036)', async (t) => {
  // The overlap the claim audit of #300 flagged: the bang is classified before the containment check,
  // so `!..` is `not-applied` rather than `outside-root`. Saying so is the point — the entry excludes
  // nothing — and the message must stay true, which is why it talks about the exclusion and not about
  // whether the directories were read. Nothing outside the root is read either way.
  const dir = scratch(t);
  write(dir, 'package.json', JSON.stringify({ name: 'root' }));
  write(dir, 'pnpm-workspace.yaml', 'packages:\n  - "**"\n  - "!.."\n');

  const { facts, targets } = await repoFacts({ collector: collectorOver(), cwd: dir, root: dir });

  assert.deepEqual(
    facts.skippedGlobs.find((skip) => skip.code === 'workspace-entry-not-applied'),
    notApplied('!..'),
  );
  assert.equal(targets.some((target) => String(target.path ?? '').includes('..')), false);
});
