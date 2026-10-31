import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { catalog } from '../src/rules/index.js';
import { parseWorkflow } from '../src/lib/workflows.js';
import { checkPackList, checkRuleDocs, checkTag } from '../scripts/release-guard.js';

const ROOT = join(import.meta.dirname, '..');
const RELEASE = join(ROOT, '.github', 'workflows', 'release.yml');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/**
 * The packed set section 14 of the contract names, in that order (S1). The root README is written
 * `./README.md` because npm reads an unanchored `README.md` in `files` as a basename glob and packs
 * `docs/README.md` and `docs/images/README.md` with it (measured with npm 11.15.0); the development
 * record stays in the repository, so the anchor is what keeps the packed set the stated one.
 */
const PACKED_SET = [
  'bin/',
  'src/',
  'skills/',
  'docs/cli.md',
  'docs/guide.md',
  'docs/concept.md',
  'docs/rules/',
  'docs/images/diagram.jpg',
  './README.md',
  'LICENSE',
];

/** Every `docs/rules/<id>.md` the catalog promises a reader (S1, S5). */
const RULE_PAGES = catalog.filter((rule) => typeof rule.docs === 'string').map((rule) => rule.docs);

/** The indented block under a top-level key, comments at column 0 included. */
function topLevelBlock(text, key) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return null;
  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !/^[\s#]/.test(line)) break;
    block.push(line);
  }
  return block.join('\n');
}

/** The release workflow's steps in order, read by the product own reader. */
function releaseSteps() {
  const parsed = parseWorkflow(readFileSync(RELEASE, 'utf8'));
  assert.equal(parsed.ok, true, 'the release workflow must be readable by the product own reader');
  return parsed.jobs.flatMap((job) => job.steps ?? []);
}

/** Everything the release workflow would execute, in order. */
function releaseCommands(steps) {
  return steps.map((step) => step.run ?? '').join('\n');
}

test('the release workflow exists', () => {
  assert.doesNotThrow(() => readFileSync(RELEASE, 'utf8'), 'no release workflow: nothing may publish');
});

test('publication is reachable only from a version tag, never from a pull request', () => {
  const text = readFileSync(RELEASE, 'utf8');
  const on = topLevelBlock(text, 'on');

  assert.match(on, /^\s+push:/m, 'the release runs on a push');
  assert.match(on, /^\s+tags:\s*\[?'?v\*'?\]?\s*$/m, 'the push must be a v* tag');
  assert.doesNotMatch(on, /pull_request/, 'a pull request must never reach the publish job');
  assert.doesNotMatch(on, /branches:/, 'a branch push must never reach the publish job');
});

test('the publish job alone may mint an OIDC token, and no npm token exists', () => {
  const text = readFileSync(RELEASE, 'utf8');

  assert.equal((text.match(/id-token:\s*write/g) ?? []).length, 1, 'id-token: write belongs here once');
  for (const token of ['NPM_TOKEN', 'NODE_AUTH_TOKEN', '_authToken', 'npm_token']) {
    assert.doesNotMatch(text, new RegExp(token), `the release must not reference ${token}`);
  }
});

test('every action in the release workflow is pinned to a commit sha', () => {
  const parsed = parseWorkflow(readFileSync(RELEASE, 'utf8'));
  assert.equal(parsed.ok, true, 'the release workflow must be readable by the product own reader');

  const uses = parsed.jobs.flatMap((job) => (job.steps ?? []).map((step) => step.uses).filter(Boolean));
  assert.ok(uses.length > 0, 'the release workflow runs at least one action');
  for (const value of uses) {
    assert.match(value, /^[^@\s]+@[0-9a-f]{40}$/, `${value} is not pinned to a commit sha`);
  }
});

test('the release stages the version, and cannot publish it directly', () => {
  const commands = releaseCommands(releaseSteps());

  assert.match(commands, /npm stage publish/, 'the release must stage the tarball, not publish it');
  assert.doesNotMatch(commands, /npm\s+publish\b/, '`npm publish` must be unreachable from the workflow');
  assert.match(commands, /node scripts\/release-guard\.js --tag/, 'the workflow must pass the tag to the guard');
  assert.ok(
    commands.indexOf('release-guard.js --tag') < commands.indexOf('npm stage publish'),
    'the tag check must run before the stage',
  );
});

test('the stage id reaches the step summary, because approval happens after the job (S4)', () => {
  const stage = releaseSteps().find((step) => (step.run ?? '').includes('npm stage publish'));
  assert.ok(stage, 'no step runs `npm stage publish`');

  assert.match(stage.run, /--json/, 'the stage id is machine-readable only in the --json output');
  assert.match(stage.run, /stageId/, 'the summary must carry the id npm reports');
  assert.match(stage.run, /GITHUB_STEP_SUMMARY/, 'approval happens after the job: the id must outlive it in the summary');
  assert.doesNotMatch(stage.run, /--provenance/, 'provenance is the registry decision now, not a flag this job passes');
});

test('the job installs the npm that has a stage command, before it stages (S3)', () => {
  const steps = releaseSteps();
  const install = steps.findIndex((step) => /npm\s+install\s+--global\s+npm@/.test(step.run ?? ''));
  assert.notEqual(
    install,
    -1,
    'Node 24 bundles npm 11.13.0, which has no `stage` command: the job must install npm explicitly',
  );

  const [, major, minor] = steps[install].run.match(/npm@\^?(\d+)\.(\d+)\.\d+/);
  assert.ok(
    Number(major) > 11 || (Number(major) === 11 && Number(minor) >= 15),
    `npm ${major}.${minor} predates the stage command, which arrived in 11.15.0`,
  );

  const stage = steps.findIndex((step) => (step.run ?? '').includes('npm stage publish'));
  assert.ok(stage > install, 'the upgrade must run before the stage, not after it');
});

test('prepublishOnly runs the suite, the self-scan and the packed-file check', () => {
  const script = PACKAGE.scripts.prepublishOnly;

  assert.equal(typeof script, 'string', 'package.json declares no prepublishOnly gate');
  for (const required of ['node --test', 'scan --scope repo --fail-on warn', 'scripts/release-guard.js']) {
    assert.ok(script.includes(required), `prepublishOnly does not run ${required}`);
  }
});

test('a tag is accepted only when it names the package version', () => {
  assert.deepEqual(checkTag('v0.2.0', '0.2.0'), { ok: true, problems: [] });
  assert.match(checkTag('v0.2.1', '0.2.0').problems[0], /v0\.2\.1 does not name version 0\.2\.0/);
  assert.match(checkTag('0.2.0', '0.2.0').problems[0], /not vX\.Y\.Z/);
  assert.equal(checkTag('v0.2.0-rc.1', '0.2.0-rc.1').ok, true, 'a prerelease tag names a prerelease version');
});

test('the packed file list is the files contract, and nothing else', () => {
  const allowed = PACKAGE.files;

  assert.deepEqual(
    checkPackList(
      [
        'package.json',
        'LICENSE',
        'README.md',
        'bin/funky-secure.js',
        'src/cli.js',
        'skills/funky-secure/SKILL.md',
        'docs/cli.md',
        'docs/rules/exact-versions.md',
        'docs/images/diagram.jpg',
      ],
      allowed,
    ),
    { ok: true, problems: [] },
  );

  for (const unwanted of [
    'tests/cli.test.js',
    'odd/tasks/funky-secure-v0.2.md',
    '.env',
    'node_modules/x/index.js',
    'pnpm-lock.yaml',
    'docs/spec/layout.md',
    'docs/architecture.md',
    'docs/decisions.md',
  ]) {
    const { ok, problems } = checkPackList(['package.json', unwanted], allowed);
    assert.equal(ok, false, `${unwanted} must not ship`);
    assert.match(problems[0], /must not ship/);
  }
});

test('a packed set missing a page the catalog declares fails, naming the rule and the page (S5)', () => {
  const packed = ['package.json', 'bin/funky-secure.js', 'src/cli.js', 'docs/cli.md'];
  const { ok, problems } = checkRuleDocs(packed);

  assert.equal(ok, false, 'a package that names a document it does not contain must not ship');
  assert.equal(problems.length, RULE_PAGES.length, 'every page the catalog declares is checked');

  const page = RULE_PAGES[0];
  const named = problems.find((problem) => problem.includes(page));
  assert.ok(named, `no problem names the missing page ${page}`);
  assert.match(named, new RegExp(catalog[0].id), 'the problem must name the rule that lost its page');

  const dropped = checkRuleDocs([...packed, ...RULE_PAGES].filter((entry) => entry !== page));
  assert.equal(dropped.ok, false);
  assert.equal(dropped.problems.length, 1, 'only the page that was dropped is reported');
});

test('the files contract covers every rule page the catalog declares (S1, S5)', () => {
  assert.deepEqual(PACKAGE.files, PACKED_SET, 'the packed set is section 14 of the contract, in order');

  for (const page of RULE_PAGES) {
    assert.deepEqual(
      checkPackList(['package.json', page], PACKAGE.files),
      { ok: true, problems: [] },
      `${page} is declared by a rule and left out of package.json files`,
    );
  }

  assert.deepEqual(checkRuleDocs(['package.json', ...RULE_PAGES]), { ok: true, problems: [] });
});

test('the packed set is the stated one, so the development record stays in the repository (S1)', () => {
  assert.deepEqual(checkPackList(['package.json', 'README.md', 'LICENSE'], PACKAGE.files), {
    ok: true,
    problems: [],
  });

  for (const page of ['docs/README.md', 'docs/images/README.md', 'docs/spec/layout.md']) {
    const { ok, problems } = checkPackList(['package.json', page], PACKAGE.files);
    assert.equal(ok, false, `${page} must not ship`);
    assert.match(problems[0], /must not ship/);
  }
});
