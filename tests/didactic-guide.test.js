/**
 * The learn-path contract (`odd/tasks/didactic-guide.md`, S6).
 *
 * `docs/learn/` is written for a reader who has never opened a terminal, and the pages are prose no
 * test can call correct. These checks are the mechanical half, and they say so: a page can pass all
 * of them and still teach nothing. What they do catch is the failure that actually happens — a
 * command ships, no page is written for it, and the path silently stops being a path.
 *
 * Everything here is deterministic, reads files and writes none, and never spawns a process.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMANDS } from '../src/cli.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGES = join(ROOT, 'docs', 'learn', 'commands');

/// S2's six headings, in the order every command page must carry them. A gate that checks "the six
/// headings" against a description rather than a list is a gate nobody can write (judge C3).
const HEADINGS = Object.freeze([
  '## What it answers',
  '## What it does',
  '## When you use it',
  '## When it is superfluous',
  '## What you will see',
  '## What you do next',
]);

/// The two globals the CLI answers before it resolves a command. A page may teach them, so the
/// invented-command check must not flag them (judge JD-A-012).
const GLOBAL_FLAGS = Object.freeze(['--help', '--version']);

/**
 * @param {string} name
 * @returns {string} the page's text
 */
function page(name) {
  return readFileSync(join(PAGES, `${name}.md`), 'utf8');
}

test('every command the CLI dispatches has exactly one page in docs/learn/commands', () => {
  const written = existsSync(PAGES)
    ? readdirSync(PAGES).filter((entry) => entry.endsWith('.md')).map((entry) => entry.slice(0, -3))
    : [];

  for (const command of COMMANDS) {
    assert.ok(
      written.includes(command.name),
      `docs/learn/commands/${command.name}.md does not exist: the ${command.name} command has no page in the learn path`,
    );
  }

  const dispatched = new Set(COMMANDS.map((command) => command.name));
  for (const name of written) {
    assert.ok(
      dispatched.has(name),
      `docs/learn/commands/${name}.md names no command the CLI dispatches, so the path documents something that does not exist`,
    );
  }

  assert.equal(
    written.length,
    dispatched.size,
    `docs/learn/commands holds ${written.length} pages for ${dispatched.size} commands, so one command has two pages or one page names none`,
  );
});

test('every command page carries the six headings, in order', () => {
  for (const command of COMMANDS) {
    const text = page(command.name);
    let cursor = -1;

    for (const heading of HEADINGS) {
      const at = text.indexOf(heading);
      assert.ok(at !== -1, `docs/learn/commands/${command.name}.md has no "${heading}" section`);
      assert.ok(
        at > cursor,
        `docs/learn/commands/${command.name}.md puts "${heading}" out of order: the six questions are read in one fixed order`,
      );
      cursor = at;
    }
  }
});

test('every heading of a command page is followed by a paragraph, not a placeholder', () => {
  for (const command of COMMANDS) {
    const lines = page(command.name).split('\n');

    for (const heading of HEADINGS) {
      const at = lines.indexOf(heading);
      assert.ok(at !== -1, `docs/learn/commands/${command.name}.md has no "${heading}" section`);

      const body = [];
      for (const line of lines.slice(at + 1)) {
        if (line.startsWith('## ')) break;
        body.push(line);
      }

      const text = body.join('\n').trim();
      assert.ok(
        text.length >= 40,
        `docs/learn/commands/${command.name}.md leaves "${heading}" with ${text.length} characters: a heading with no paragraph passes every other check`,
      );
    }
  }
});

test('no command page names a command the CLI does not dispatch', () => {
  const allowed = new Set([...COMMANDS.map((command) => command.name), ...GLOBAL_FLAGS]);

  for (const command of COMMANDS) {
    // Only the instructions count. A page also pastes what the tool printed, and a refusal sentence
    // can contain the package name followed by an ordinary word - `skill` refuses with "install the
    // newer funky-secure to keep that version". Reading a capture as an instruction would forbid
    // showing a real refusal, which is the one thing these pages are for.
    const text = page(command.name).replace(/```[\s\S]*?```/g, '');
    const mentions = text.matchAll(/`funky-secure\s+((?:--)?[a-z][a-z-]*)/g);

    for (const [, token] of mentions) {
      assert.ok(
        allowed.has(token),
        `docs/learn/commands/${command.name}.md tells the reader to run "funky-secure ${token}", which the CLI does not dispatch`,
      );
    }
  }
});

test('every command page says what it adds that the existing docs do not', () => {
  for (const command of COMMANDS) {
    const text = page(command.name);
    const line = text.split('\n').find((entry) => entry.startsWith('**Adds:** '));

    assert.ok(
      line !== undefined,
      `docs/learn/commands/${command.name}.md has no "**Adds:**" line: the path exists because these pages add something cli.md, guide.md and rules/ do not`,
    );
    assert.ok(
      line.trim().length > '**Adds:** '.length + 20,
      `docs/learn/commands/${command.name}.md has an "**Adds:**" line too short to name anything`,
    );
  }
});
