import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FLAGS, renderHelp } from '../src/cli.js';
import { catalog } from '../src/rules/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RULES_DIR = join(ROOT, 'docs', 'rules');

function rulePages() {
  if (!existsSync(RULES_DIR)) return [];
  return readdirSync(RULES_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort();
}

test('every catalog rule has a docs/rules/<id>.md page', () => {
  for (const rule of catalog) {
    const page = join(RULES_DIR, `${rule.id}.md`);
    assert.ok(existsSync(page), `${rule.id} has no ${page}`);
  }
});

test('every docs/rules page declares a rule id the catalog contains', () => {
  const known = new Set(catalog.map((rule) => rule.id));

  for (const name of rulePages()) {
    const text = readFileSync(join(RULES_DIR, name), 'utf8');
    const declared = text.match(/^Rule id:\s*`([^`]+)`/m);
    assert.ok(declared, `${name} has no "Rule id: \`<id>\`" line`);
    assert.ok(known.has(declared[1]), `${name} declares unknown rule id "${declared[1]}"`);
  }
});

test('help output contains every catalog rule id and every parsed flag', () => {
  const help = renderHelp({ catalog });

  for (const rule of catalog) {
    assert.ok(help.includes(rule.id), `help lacks rule ${rule.id}`);
  }
  for (const flag of FLAGS) {
    assert.ok(help.includes(flag.name), `help lacks flag ${flag.name}`);
  }
});

test('every flag parsed by the CLI appears in docs/cli.md', () => {
  const text = readFileSync(join(ROOT, 'docs', 'cli.md'), 'utf8');

  for (const flag of FLAGS) {
    assert.ok(text.includes(flag.name), `docs/cli.md lacks ${flag.name}`);
  }
});

test('docs/architecture.md mentions only src paths that exist', () => {
  const text = readFileSync(join(ROOT, 'docs', 'architecture.md'), 'utf8');
  const mentioned = [...text.matchAll(/src\/[A-Za-z0-9_./-]+\.js/g)].map((match) => match[0]);

  assert.ok(mentioned.length > 0, 'architecture.md lists no src modules');
  for (const path of mentioned) {
    assert.ok(existsSync(join(ROOT, path)), `architecture.md mentions missing ${path}`);
  }
});
