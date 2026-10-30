/**
 * `skill` (record 0004, 11.8): the shipped agent skill, printed on stdout byte for byte.
 *
 * The command is the distribution channel, so the file it prints is the contract: the tests compare
 * stdout with the file on disk and never with a rendering of it. The two stderr lines are a hint and
 * carry no second copy of the file, and nothing about the current directory may influence the answer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../src/cli.js';

const SHIPPED = join(import.meta.dirname, '..', 'skills', 'funky-secure', 'SKILL.md');
/** The version the shipped skill declares, read from the file the tests compare against. */
const SHIPPED_VERSION = /^version:\s*(\S+)/m.exec(readFileSync(SHIPPED, 'utf8'))[1];

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

test('skill names the install flag and both destinations on stderr', async (t) => {
  const { code, stderr } = await skill(['skill'], { cwd: scratch(t) });

  assert.equal(code, 0);
  const lines = stderrLines(stderr.text);
  assert.equal(lines.at(-1), '', 'stderr does not end with a newline after its last line');

  const destination = '.agents/skills/funky-secure/SKILL.md';
  assert.equal(lines.length - 1, 2, `stderr carried ${lines.length - 1} lines, not two:\n${stderr.text}`);
  assert.ok(lines[0].includes('funky-secure skill --install'), 'the first line does not name the flag that installs');
  assert.ok(lines[1].includes(destination), 'the second line does not name the project-local file');
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

/* -------------------------------------------------------------------------------------------------
 * `--install` (record 0005, 11.8): the one write outside the repository.
 *
 * Every test writes under a temporary home or a temporary "repository", never the real one, so the
 * destination is exercised for real without a test touching the machine.
 * ---------------------------------------------------------------------------------------------- */

/** A collector that answers "this directory is a worktree root", so project scope is reachable. */
function rootedCollector(root) {
  return {
    git: async () => ({ ok: true, code: 0, stdout: `${root}\n` }),
  };
}

/** A collector that answers "not a repository", the shape of a directory outside git. */
function unrootedCollector() {
  return { git: async () => ({ ok: true, code: 1, stdout: '', stderr: '' }) };
}

/**
 * Runs `skill` with an injected home, so the user-scope destination lands in the sandbox.
 *
 * @param {string[]} argv
 * @param {{ cwd: string, home: string, collector?: object, confirm?: () => boolean, stdin?: object }} options
 */
async function install(argv, { cwd, home, collector, confirm, stdin }) {
  const stdout = capture();
  const stderr = capture();
  const code = await run(argv, {
    cwd,
    env: {},
    home,
    stdout,
    stderr,
    collector: collector ?? unrootedCollector(),
    ...(confirm === undefined ? {} : { confirm }),
    ...(stdin === undefined ? {} : { stdin }),
  });
  return { code, stdout, stderr, text: stdout.text, err: stderr.text };
}

/** The installed file, or null when nothing was written. */
function installedAt(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

test('--install writes the project skill inside a repository, without a path argument', async (t) => {
  const root = scratch(t);
  const home = join(scratch(t), 'home');

  const { code, err, text } = await install(['skill', '--install'], { cwd: root, home, collector: rootedCollector(root) });

  assert.equal(code, 0, `--install failed:\n${err}`);
  assert.equal(text, '', 'the install path wrote the file to stdout');
  const written = installedAt(join(root, '.agents', 'skills', 'funky-secure', 'SKILL.md'));
  assert.notEqual(written, null, 'nothing was written to the project destination');
  assert.equal(Buffer.compare(written, readFileSync(SHIPPED)), 0, 'the written file is not the shipped file');
  assert.ok(err.startsWith('✓  Installed  ·  .agents/skills/funky-secure/SKILL.md'), 'the message does not say what it wrote');
  assert.match(err, /commit it/, 'the project install does not say the file travels with the repository');
  assert.equal(installedAt(join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md')), null, 'it also wrote the user file');
});

test('--install outside a repository writes the user skill under the home directory', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');

  const { code, err } = await install(['skill', '--install'], { cwd, home });

  assert.equal(code, 0, `--install failed:\n${err}`);
  const written = installedAt(join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md'));
  assert.notEqual(written, null, 'nothing was written to the user destination');
  assert.equal(Buffer.compare(written, readFileSync(SHIPPED)), 0, 'the written file is not the shipped file');
  assert.ok(err.startsWith('✓  Installed  ·  ~/.agents/skills/funky-secure/SKILL.md'), 'the message does not name the user destination');
  assert.equal(installedAt(join(cwd, '.agents', 'skills', 'funky-secure', 'SKILL.md')), null, 'it wrote into the working directory');
});

test('--install --user chooses the user destination inside a repository', async (t) => {
  const root = scratch(t);
  const home = join(scratch(t), 'home');

  const { code, err } = await install(['skill', '--install', '--user'], { cwd: root, home, collector: rootedCollector(root) });

  assert.equal(code, 0, `--install --user failed:\n${err}`);
  assert.notEqual(installedAt(join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md')), null, 'the user file is missing');
  assert.equal(installedAt(join(root, '.agents', 'skills', 'funky-secure', 'SKILL.md')), null, 'it also wrote the project file');
});

test('--install leaves an identical installation alone and says so', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');
  const first = await install(['skill', '--install'], { cwd, home });
  assert.equal(first.code, 0);

  const second = await install(['skill', '--install'], { cwd, home });

  assert.equal(second.code, 0);
  assert.match(second.err, /already carries this exact version/, 'the second install did not report the identical file');
  assert.doesNotMatch(second.err, /installed /, 'the second install claimed to write');
});

/** A skill file that declares a version and differs from the shipped one in its body. */
function variant(version, body = 'edited by the human') {
  return `---\nname: funky-secure\nversion: ${version}\ndescription: what this project needs to know.\n---\n\n# funky-secure\n\n${body}\n`;
}

test('--install refuses to replace an older installed copy when no terminal can ask', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');
  await install(['skill', '--install'], { cwd, home });
  const path = join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md');
  writeFileSync(path, variant('0.3.0'));

  const { code, err } = await install(['skill', '--install'], { cwd, home, stdin: { isTTY: false } });

  assert.equal(code, 3, 'a differing file with no terminal was not reported as a refusal');
  assert.match(err, /^funky-secure: /, 'the first line does not carry the action');
  assert.match(err, /--force/, 'the action does not name --force');
  assert.match(err, /--keep/, 'the action does not name --keep');
  assert.match(err, /0\.3\.0/, 'the diagnosis does not name the installed version');
  assert.equal(readFileSync(path, 'utf8'), variant('0.3.0'), 'the installed file was replaced anyway');
});

test('--install names the same version with different bytes as local changes', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');
  await install(['skill', '--install'], { cwd, home });
  const path = join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md');
  writeFileSync(path, variant(SHIPPED_VERSION));

  const { code, err } = await install(['skill', '--install'], { cwd, home, stdin: { isTTY: false } });

  assert.equal(code, 3);
  assert.match(err, new RegExp(`local changes on version ${SHIPPED_VERSION.replaceAll('.', '\\.')}`), 'an edited file is not described as local changes');
  assert.equal(readFileSync(path, 'utf8'), variant(SHIPPED_VERSION), 'the edited file was replaced');
});

test('--install refuses to downgrade a newer installed copy, even with a terminal', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');
  await install(['skill', '--install'], { cwd, home });
  const path = join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md');
  writeFileSync(path, variant('9.0.0'));

  const { code, err } = await install(['skill', '--install'], { cwd, home, confirm: () => true });

  assert.equal(code, 3, 'a downgrade was performed without --force, or the refusal lost its code');
  assert.match(err, /9\.0\.0/, 'the diagnosis does not name the newer version');
  assert.match(err, /--force to downgrade/, 'the action does not name the downgrade');
  assert.equal(readFileSync(path, 'utf8'), variant('9.0.0'), 'the newer file was replaced');
});

test('--install --force downgrades on purpose, and --keep preserves the newer copy', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');
  await install(['skill', '--install'], { cwd, home });
  const path = join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md');
  writeFileSync(path, variant('9.0.0'));

  const kept = await install(['skill', '--install', '--keep'], { cwd, home, stdin: { isTTY: false } });
  assert.equal(kept.code, 0, `--keep failed:\n${kept.err}`);
  assert.match(kept.err, /newer than the version this binary ships/, 'the keep message does not say the copy is newer');
  assert.equal(readFileSync(path, 'utf8'), variant('9.0.0'), '--keep replaced the newer file');

  const forced = await install(['skill', '--install', '--force'], { cwd, home, stdin: { isTTY: false } });
  assert.equal(forced.code, 0, `--force failed:\n${forced.err}`);
  assert.equal(Buffer.compare(readFileSync(path), readFileSync(SHIPPED)), 0, '--force did not downgrade');
});

test('--install --force replaces a local edit without asking', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');
  await install(['skill', '--install'], { cwd, home });
  const path = join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md');
  writeFileSync(path, variant(SHIPPED_VERSION));

  const { code, err } = await install(['skill', '--install', '--force'], { cwd, home, stdin: { isTTY: false } });

  assert.equal(code, 0, `--force failed:\n${err}`);
  assert.equal(Buffer.compare(readFileSync(path), readFileSync(SHIPPED)), 0, 'the file was not replaced by the shipped version');
});

test('--install --keep leaves a local edit as it is', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');
  await install(['skill', '--install'], { cwd, home });
  const path = join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md');
  writeFileSync(path, variant(SHIPPED_VERSION));

  const { code, err } = await install(['skill', '--install', '--keep'], { cwd, home, stdin: { isTTY: false } });

  assert.equal(code, 0);
  assert.ok(err.startsWith('ℹ  Kept  ·  ~/.agents/skills/funky-secure/SKILL.md'), 'the message does not say it kept the file');
  assert.equal(readFileSync(path, 'utf8'), variant(SHIPPED_VERSION), 'the installed file changed');
});

test('--install asks before replacing, and the answer decides', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');
  await install(['skill', '--install'], { cwd, home });
  const path = join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md');
  writeFileSync(path, variant('0.3.0'));

  const kept = await install(['skill', '--install'], { cwd, home, confirm: () => false });
  assert.equal(kept.code, 0);
  assert.equal(readFileSync(path, 'utf8'), variant('0.3.0'), 'a keep answer replaced the file anyway');
  assert.match(kept.err, /^ℹ {2}Kept/m, 'a keep answer did not say the file was kept');

  const replaced = await install(['skill', '--install'], { cwd, home, confirm: () => true });
  assert.equal(replaced.code, 0);
  assert.equal(Buffer.compare(readFileSync(path), readFileSync(SHIPPED)), 0, 'an overwrite answer did not replace the file');
});

test('--install treats a copy with no version line as untraceable, and asks', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');
  await install(['skill', '--install'], { cwd, home });
  const path = join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md');
  writeFileSync(path, 'no frontmatter at all\n');

  const { code, err } = await install(['skill', '--install'], { cwd, home, stdin: { isTTY: false } });

  assert.equal(code, 3);
  assert.match(err, /carries no version line/, 'an unversioned copy is not described as untraceable');
  assert.equal(readFileSync(path, 'utf8'), 'no frontmatter at all\n', 'the unversioned file was replaced');
});

test('--install reports the version it wrote', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');

  const { code, err } = await install(['skill', '--install'], { cwd, home });

  assert.equal(code, 0);
  const version = /^version:\s*(\S+)/m.exec(readFileSync(SHIPPED, 'utf8'))[1];
  assert.ok(err.includes(` (${version})`), 'the message does not name the version it wrote');
});

test('--install refuses a symbolic link destination instead of writing through it', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');
  const outside = join(scratch(t), 'outside.md');
  writeFileSync(outside, 'not ours\n');
  mkdirSync(join(home, '.agents', 'skills', 'funky-secure'), { recursive: true });
  try {
    symlinkSync(outside, join(home, '.agents', 'skills', 'funky-secure', 'SKILL.md'));
  } catch (error) {
    // Windows needs Developer Mode or an elevated shell to create a link, and a test may not ask for
    // either. Skipping is honest; pretending the branch passed is not.
    if (error.code === 'EPERM') return t.skip('this Windows session cannot create a symbolic link');
    throw error;
  }

  const { code, err } = await install(['skill', '--install'], { cwd, home });

  assert.equal(code, 3, 'a symlinked destination was written through, or the refusal lost its code');
  assert.match(err, /symbolic link/, 'the diagnosis does not name the link');
  assert.equal(readFileSync(outside, 'utf8'), 'not ours\n', 'the link target was overwritten');
});

test('--install leaves no temporary file behind', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');

  await install(['skill', '--install'], { cwd, home });

  const entries = readdirSync(join(home, '.agents', 'skills', 'funky-secure'));
  assert.deepEqual(entries, ['SKILL.md'], `the write left more than the skill behind: ${entries.join(', ')}`);
});

test('the install flags are usage errors without --install, and force with keep contradicts itself', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');

  for (const argv of [
    ['skill', '--user'],
    ['skill', '--force'],
    ['skill', '--keep'],
    ['skill', '--install', '--force', '--keep'],
  ]) {
    const { code, err, text } = await install(argv, { cwd, home });
    assert.equal(code, 2, `${argv.join(' ')} did not fail`);
    assert.equal(text, '', `${argv.join(' ')} wrote to stdout`);
    assert.match(err, /^funky-secure: /, `${argv.join(' ')} printed no action line`);
  }
});

test('--install still rejects a path argument', async (t) => {
  const cwd = scratch(t);
  const home = join(scratch(t), 'home');

  const { code, text, err } = await install(['skill', '--install', 'somewhere.md'], { cwd, home });

  assert.equal(code, 2, 'a path argument was accepted');
  assert.equal(text, '', 'a usage error wrote to stdout');
  assert.match(err, /somewhere\.md/, 'the diagnosis does not name the argument');
});

test('the answer parser accepts the menu, the words and the empty default, and rejects the rest', async () => {
  const { parseAnswer } = await import('../src/commands/skill.js');

  for (const keep of ['', ' ', '1', 'k', 'K', 'keep', 'KEEP']) {
    assert.equal(parseAnswer(keep), false, `"${keep}" should keep the file`);
  }
  for (const replace of ['2', 'o', 'O', 'overwrite', 'Overwrite', 'replace', 'y', 'yes']) {
    assert.equal(parseAnswer(replace), true, `"${replace}" should replace the file`);
  }
  for (const unknown of ['3', 'maybe', 'n', 'no', 'x']) {
    assert.equal(parseAnswer(unknown), null, `"${unknown}" is not an answer the menu offers`);
  }
});

test('the question shows what each answer does, with keep as the visible default', async () => {
  const { questionLines } = await import('../src/commands/skill.js');

  const lines = questionLines({
    state: 'edited',
    display: '.agents/skills/funky-secure/SKILL.md',
    installedVersion: SHIPPED_VERSION,
    shippedVersion: SHIPPED_VERSION,
  });

  assert.match(
    lines[0],
    new RegExp(`carries local changes on version ${SHIPPED_VERSION.replaceAll('.', '\\.')}`),
    'the first line does not say what happened',
  );
  assert.match(lines[1], /discards whatever is there now/, 'the second line does not say what replacing costs');
  assert.ok(lines.includes('  1  keep it as it is, and change nothing\n'), 'the keep option is not offered in words');
  assert.ok(lines.includes(`  2  replace it with version ${SHIPPED_VERSION}\n`), 'the replace option does not name the version it installs');
  assert.ok(lines.includes('\n'), 'the question has no blank line between facts and menu');
  assert.equal(lines.filter((line) => line.startsWith('funky-secure skill: ')).length, 2, 'the menu carries the command prefix');
});
