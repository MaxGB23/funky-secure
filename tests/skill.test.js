/**
 * `skill` (record 0004, 11.8): the shipped agent skill, printed on stdout byte for byte.
 *
 * The command is the distribution channel, so the file it prints is the contract: the tests compare
 * stdout with the file on disk and never with a rendering of it. The two stderr lines are a hint and
 * carry no second copy of the file, and nothing about the current directory may influence the answer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../src/cli.js';

const SHIPPED = join(import.meta.dirname, '..', 'skills', 'funky-secure', 'SKILL.md');

/** @param {import('node:test').TestContext} t */
function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'funky-secure-skill-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A sink that keeps the exact bytes it was handed, so a comparison is byte for byte. */
function capture() {
  const chunks = [];
  return {
    bytes() {
      return Buffer.concat(chunks);
    },
    get text() {
      return Buffer.concat(chunks).toString('utf8');
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    isTTY: false,
  };
}

/**
 * A collector that fails the test the moment it is touched: `skill` answers from its own module and
 * reads nothing about the repository, so no probe may run and no file may be read for evidence.
 */
function refusingCollector() {
  return new Proxy(
    {},
    {
      get(_target, key) {
        throw new Error(`the skill command reached the collector (${String(key)})`);
      },
    },
  );
}

/**
 * @param {string[]} argv
 * @param {{ cwd: string, skillPath?: string }} options
 */
async function skill(argv, { cwd, skillPath }) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(argv, {
    cwd,
    env: {},
    stdout,
    stderr,
    collector: refusingCollector(),
    ...(skillPath === undefined ? {} : { skillPath }),
  });
  return { code, stdout, stderr, bytes: stdout.bytes(), text: stdout.text };
}

/** The two hint lines, split; `\n`-terminated, so a stray blank line would show up here. */
function stderrLines(stderr) {
  return stderr.split('\n');
}

test('skill prints the shipped file on stdout, byte for byte', async (t) => {
  const { code, bytes } = await skill(['skill'], { cwd: scratch(t) });

  assert.equal(code, 0, 'skill did not exit 0');
  assert.ok(bytes.length > 0, 'stdout is empty');
  assert.equal(Buffer.compare(bytes, readFileSync(SHIPPED)), 0, 'stdout is not the shipped file');
});

test('skill names the project-local and the user-level destination on stderr', async (t) => {
  const { code, stderr } = await skill(['skill'], { cwd: scratch(t) });

  assert.equal(code, 0);
  const lines = stderrLines(stderr.text);
  assert.equal(lines.at(-1), '', 'stderr does not end with a newline after its last line');

  const destination = '.agents/skills/funky-secure/SKILL.md';
  assert.equal(lines.length - 1, 2, `stderr carried ${lines.length - 1} lines, not two:\n${stderr.text}`);
  assert.match(lines[0], /\.agents\/skills\/funky-secure\//, 'the first line names no destination');
  assert.match(lines[1], /\.agents\/skills\/funky-secure\//, 'the second line names no destination');
  assert.ok(lines[0].includes(destination), 'the first line does not name the project-local file');
  assert.ok(lines[1].includes(`~/${destination}`), 'the second line does not name the user-level file');
});

test('skill works outside any repository, and reads no repository fact', async (t) => {
  const cwd = scratch(t);

  const { code, bytes } = await skill(['skill'], { cwd });

  assert.equal(code, 0);
  assert.equal(Buffer.compare(bytes, readFileSync(SHIPPED)), 0);
});

test('skill accepts --help like every other command', async (t) => {
  const { code, text, stderr } = await skill(['skill', '--help'], { cwd: scratch(t) });

  assert.equal(code, 0);
  assert.equal(stderr.text, '');
  assert.match(text, /^usage: funky-secure <command> \[options\]$/m);
  assert.match(text, /^ {2}skill {2}/m, 'the help text does not list the skill command');
  assert.notEqual(text, readFileSync(SHIPPED, 'utf8'), '--help printed the skill file');
});

test('skill rejects a flag it does not accept, with the two-line exit-2 message', async (t) => {
  const { code, stderr, text } = await skill(['skill', '--scope', 'repo'], { cwd: scratch(t) });

  assert.equal(code, 2);
  assert.equal(text, '', 'a usage error wrote to stdout');
  const lines = stderrLines(stderr.text);
  assert.match(lines[0], /^funky-secure: /, 'the first line does not carry the action');
  assert.match(lines[1], /^reason: /, 'the second line does not carry the diagnosis');
  assert.match(lines[1], /--scope/, 'the diagnosis does not name the flag at fault');
  assert.equal(lines.length - 1, 2, 'a usage error is exactly two lines');
});

test('skill rejects a trailing argument', async (t) => {
  const { code, text } = await skill(['skill', 'extra'], { cwd: scratch(t) });

  assert.equal(code, 2);
  assert.equal(text, '', 'a usage error wrote to stdout');
});

test('skill exits 2 with the two-line message when the shipped file cannot be read', async (t) => {
  const missing = join(scratch(t), 'SKILL.md');

  const { code, stderr, text } = await skill(['skill'], { cwd: scratch(t), skillPath: missing });

  assert.equal(code, 2);
  assert.equal(text, '', 'a failure printed something on stdout, which a redirect would save');
  const lines = stderrLines(stderr.text);
  assert.match(lines[0], /^funky-secure: /, 'the first line does not carry the action');
  assert.match(lines[1], /^reason: /, 'the second line does not carry the diagnosis');
  assert.equal(lines.length - 1, 2, 'a failure is exactly two lines');
});

test('skill is deterministic: two runs print the same bytes', async (t) => {
  const cwd = scratch(t);

  const first = await skill(['skill'], { cwd });
  const second = await skill(['skill'], { cwd });

  assert.equal(Buffer.compare(first.bytes, second.bytes), 0, 'two runs differ on stdout');
  assert.equal(first.text.length > 0, true, 'stdout is empty');
  assert.equal(first.text, second.text, 'two runs differ on stderr');
});
