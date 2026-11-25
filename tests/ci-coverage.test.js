import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CI = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const RELEASE = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** The Active LTS at the time this policy was written; bumped deliberately, like an action pin. */
const ACTIVE_LTS = '24';

/** The two platforms the product branches on. `test-macos` adds a darwin∧arm64 leg that branches nothing. */
const PLATFORMS = ['ubuntu-24.04', 'windows-2025'];

/** The binary extensions marked in `.gitattributes`. */
const BINARY_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'woff', 'woff2', 'pdf', 'zip'];

test('every text file is checked out with LF on every platform', () => {
  const attributes = readFileSync(join(ROOT, '.gitattributes'), 'utf8');

  assert.match(
    attributes,
    /^\* text=auto eol=lf$/m,
    'without this line a CRLF checkout fails the golden gate for a reason that is not the code',
  );
});

test('the binary extensions the package may ship are marked binary', () => {
  const attributes = readFileSync(join(ROOT, '.gitattributes'), 'utf8');

  for (const extension of BINARY_EXTENSIONS) {
    assert.ok(
      attributes.includes(`*.${extension} binary`),
      `.${extension} is not marked binary, so git would normalise it as text`,
    );
  }
});

test('the suite runs on the two platforms the code branches on, by exact image label', () => {
  for (const label of PLATFORMS) {
    assert.ok(CI.includes(label), `CI never runs on ${label}, so its code path is not gated`);
  }

  assert.doesNotMatch(
    CI,
    /runs-on:\s*\S*-latest/,
    'a floating runner label lets the vendor migrate the image under us',
  );
});

test('the suite runs at the Node floor the package declares and at the Active LTS', () => {
  const floor = />=(\d+)/.exec(PACKAGE.engines.node)?.[1];
  assert.ok(floor, 'package.json declares no engines.node floor');

  const declared = /node:\s*\[([^\]]+)\]/.exec(CI);
  assert.ok(declared, 'CI declares no node matrix');
  const versions = declared[1].split(',').map((version) => version.trim());

  assert.ok(versions.includes(floor), `CI never runs the declared floor ${floor}: ${versions.join(', ')}`);
  assert.ok(
    versions.includes(ACTIVE_LTS),
    `CI never runs the Active LTS ${ACTIVE_LTS}: ${versions.join(', ')}`,
  );
  assert.ok(
    !versions.includes('20'),
    'an end-of-life line is not a promise this package can keep, so it is not in the matrix',
  );
});

test('every workflow fetches the newest patch of its runtime line', () => {
  for (const [name, text] of [
    ['ci.yml', CI],
    ['release.yml', RELEASE],
  ]) {
    assert.match(
      text,
      /^\s+check-latest: true$/m,
      `${name} does not set check-latest, so setup-node may use the patch cached in the image`,
    );
  }
});

test('every action is pinned by full commit sha and says which release it is', () => {
  for (const [name, text] of [
    ['ci.yml', CI],
    ['release.yml', RELEASE],
  ]) {
    const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
    assert.ok(uses.length > 0, `${name} uses no action`);

    for (const value of uses) {
      assert.match(value, /^[^@\s]+@[0-9a-f]{40}$/, `${name}: ${value} is not pinned to a commit sha`);
      assert.ok(
        text.includes(`${value} # v`),
        `${name}: ${value} carries no trailing release comment, so the pin cannot be reviewed`,
      );
    }
  }
});

test('the policy reads the labels the pull request has now, not the ones the event carried', () => {
  // The payload is a snapshot taken before the label is queryable: on #233 the `opened` run read
  // PR_LABELS empty and failed with "no type:* label" while the `labeled` run of the same commit read it
  // filled. A draft used to hide that, because this job skips a draft; a pull request that is ready from
  // birth has no such guard, so the job has to resolve the labels itself.
  assert.doesNotMatch(
    CI,
    /PR_LABELS:\s*\$\{\{\s*join\(github\.event\.pull_request\.labels/,
    'PR_LABELS still comes from the event payload, which can be empty on a labelled pull request',
  );

  assert.match(
    CI,
    /gh pr view [^\n]*--json labels/,
    'nothing in ci.yml reads the labels the pull request has now',
  );

  assert.match(
    CI,
    /PR_LABELS:\s*\$\{\{\s*steps\.[\w-]+\.outputs\./,
    'PR_LABELS is not fed from the step that resolves it',
  );

  // The same rule this repository applies to every `gh` child in `open-pr.js`: a child with no ceiling
  // does not fail, it hangs, and the job would sit there until the runner gives up hours later.
  assert.match(
    CI,
    /timeout \d+ gh pr view/,
    'the live label read has no ceiling, so a hung gh holds the job open',
  );
});

/**
 * One job's block: from its header to the next job header, so an assertion about a job cannot be
 * satisfied by a line that belongs to another one.
 * @param {string} name
 * @returns {string}
 */
function jobBlock(name) {
  const lines = CI.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `ci.yml declares no ${name} job`);

  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z0-9-]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

test('the runtime claims are measured on a runner, by a job that declares the permission it proves', () => {
  const job = jobBlock('runtime-claims');

  assert.match(job, /^ {4}runs-on: ubuntu-24\.04$/m, 'the runtime claims need the runner they claim');
  assert.match(
    job,
    /^ {4}permissions:\n {6}contents: read$/m,
    'the job does not declare contents: read itself, so the claim it measures is not the one a reviewer reads',
  );
});

test('only the step that needs the token is guarded, and the job says which context it measured', () => {
  const job = jobBlock('runtime-claims');

  // A job-level guard skipped every claim on a fork, including the two that touch no token: a fork pull
  // request that broke `files` went unmeasured, and the skip was indistinguishable from a disabled job.
  assert.doesNotMatch(job, /^ {4}if:/m, 'a job-level guard skips the claims that never needed the token');
  assert.match(job, /^ {4}timeout-minutes: \d+$/m, 'the job has no ceiling, so a stalled network holds it open');

  const guard = "if: github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository";
  const step = job.slice(job.indexOf('the 403 for a contents'), job.indexOf('scripts/probe-permissions.js'));
  assert.ok(step.includes(guard), 'the 403 step is not guarded, so a fork pull request would measure the platform');

  const print = job.slice(job.indexOf('which context this job measured'), job.indexOf('the 403 for a contents'));
  assert.ok(
    print.includes('not measured: a pull request from a fork'),
    'nothing prints why a fork run measures less, so the skip is silent',
  );
});

test('every runtime claim is a step a deleted line fails', () => {
  const job = jobBlock('runtime-claims');

  assert.match(job, /^ +run: node scripts\/probe-permissions\.js$/m, 'the 403 probe is not a step');
  assert.match(
    job,
    /^ +GH_TOKEN: \$\{\{ github\.token \}\}$/m,
    'the probe step is handed no token, so it would measure a missing credential instead of the permission',
  );

  // The other two rows `docs/validation.md` carried as not verified, pinned the same way: a claim with
  // no step is a claim nobody measures, and a step nothing asserts is one line away from disappearing.
  assert.match(
    job,
    /^ +run: node scripts\/pack-smoke\.js$/m,
    'the packed artifact is never installed and run in CI, so `files` can fail where no test can see it',
  );
  assert.match(
    job,
    /^ +run: node scripts\/probe-remediation\.js$/m,
    'the remediation commands are never run in CI, so their effect is still only their shape',
  );

  // The remediation probe runs pnpm itself, and the job declares no other reason to have it: an
  // answering pnpm is what the claim is measured with, never the one the runner image happens to carry.
  assert.match(
    job,
    /uses: pnpm\/action-setup@[0-9a-f]{40} # v\d/,
    'the remediation probe would measure whatever pnpm the image carries, or none at all',
  );
});

test('the remediation probe also runs where cmd is the shell, not only where sh is', () => {
  // Every printed command is quoted for `cmd`, `bash` and `sh` (0042). On the Ubuntu job above the
  // probe executes them with the one shell family that always read the old spelling, so a green there
  // said nothing about the reader whose paste failed: the field round that started this reported exactly
  // that failure from `cmd`. The Windows leg is the job that can fail for it.
  const job = jobBlock('runtime-claims-windows');

  assert.match(
    job,
    /^ {4}runs-on: windows-2025$/m,
    'the leg that measures `cmd` does not run on the platform whose shell failed',
  );
  assert.match(
    job,
    /^ +run: node scripts\/probe-remediation\.js$/m,
    'the Windows leg runs no probe, so the printed commands are still only executed by `sh`',
  );
  assert.match(
    job,
    /uses: pnpm\/action-setup@[0-9a-f]{40} # v\d/,
    'the Windows leg would measure whatever pnpm the image carries, or none at all',
  );
  assert.match(
    job,
    /^ {10}version: 12\.3\.4$/m,
    'the Windows leg does not ask for the pnpm version this repository pins',
  );
  assert.match(job, /^ {4}timeout-minutes: \d+$/m, 'the job has no ceiling, so a hung probe holds it open');
});
