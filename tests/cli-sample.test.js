import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/funky-secure.js', import.meta.url));
// The identity the suite's other commits use: this machine carries a global hook that refuses any
// other author, and a test that fails on the developer's git config is a test nobody keeps running.
const IDENTITY = [
  '-c',
  'user.email=82458865+MaxGB23@users.noreply.github.com',
  '-c',
  'user.name=MaxGB23',
];

/** Every fenced block in a page, with its fences stripped. @param {string} text */
function fencedBlocks(text) {
  const blocks = [];
  let open = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      if (open === null) open = [];
      else {
        blocks.push(open.join('\n'));
        open = null;
      }
      continue;
    }
    if (open !== null) open.push(line);
  }
  return blocks;
}

/** The numbered step lines of a rendered plan, trimmed. @param {string} text */
function stepLines(text) {
  return text
    .split('\n')
    .filter((line) => /^\s+\d+\s+\S/.test(line))
    .map((line) => line.trimEnd());
}

/**
 * The counts a plan prints belong to the repository it was printed from, not to the contract, and the
 * fixture this test can build is not the repository the page was written from: measured 2026-11-11, a
 * `create-next-app`-shaped fixture gives the same eleven steps but two writes where the page says four.
 * So the numbers are masked and everything else has to match — the commands, the order and the labels.
 * A test that compared the numbers would have to lie about which repository it is looking at.
 *
 * @param {string} line
 */
function withoutCounts(line) {
  return line.replace(/\d+/g, 'N');
}

/**
 * A project a generator left behind: three ranges, a foreign lockfile with recorded versions, the
 * ignore file the generator writes, and work in the tree that no commit records.
 *
 * @param {import('node:test').TestContext} t
 */
function generatedProject(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-sample-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const dependencies = { next: '^15.5.4', react: '^19.2.0', 'react-dom': '^19.2.0' };
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'app', private: true, dependencies }, null, 2)}\n`,
  );
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app', 'page.jsx'), 'export default function Page() {\n  return null;\n}\n');
  writeFileSync(
    join(dir, '.gitignore'),
    [
      '# dependencies',
      '/node_modules',
      '# next.js',
      '/.next/',
      '/out/',
      '/build',
      '# misc',
      '.DS_Store',
      '*.pem',
      '# env files',
      '.env*',
      '# typescript',
      '*.tsbuildinfo',
      'next-env.d.ts',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'package-lock.json'),
    `${JSON.stringify(
      { name: 'app', lockfileVersion: 3, requires: true, packages: { '': { name: 'app', dependencies } } },
      null,
      2,
    )}\n`,
  );

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', [...IDENTITY, 'commit', '-qm', 'generated'], { cwd: dir });
  // A byte on a path the plan writes is the difference between a plan that starts with the baseline
  // commit and one that does not, and it changes no fact the plan reads.
  appendFileSync(join(dir, 'package.json'), '\n');
  return dir;
}

test('the start sample in docs/cli.md is the plan the binary prints, not a transcription of one', async (t) => {
  const dir = generatedProject(t);
  const printed = execFileSync(process.execPath, [BIN, 'start'], { cwd: dir, encoding: 'utf8' });

  const samples = fencedBlocks(readFileSync(new URL('../docs/cli.md', import.meta.url), 'utf8'))
    .filter((block) => block.includes('funky-secure start  ·  guidance, nothing is written'))
    .filter((block) => block.includes('pnpm import'))
    .filter((block) => block.includes('package-lock.json'));

  assert.equal(samples.length, 1, 'docs/cli.md must carry exactly one migration sample to compare');
  const inThePage = stepLines(samples[0]).map(withoutCounts);
  const fromTheBinary = stepLines(printed).map(withoutCounts);
  // Both sides empty would be a green test that compared nothing, which is the failure mode this
  // test exists to prevent in other people's work.
  assert.ok(inThePage.length >= 6 && fromTheBinary.length >= 6, 'both sides have to carry a plan');
  assert.deepEqual(
    inThePage,
    fromTheBinary,
    'the page and the binary have to say the same thing in the same order',
  );
});
