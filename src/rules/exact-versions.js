/**
 * R5 — `exact-versions` (RFC 8.2, 4.6, 4.9).
 *
 * Two questions in one rule: is a dependency specifier exact, and does `pnpm-lock.yaml` record the
 * same specifier? The first is answered from `package.json`, the second from the bounded lockfile
 * reader (`src/lib/lockfile.js`) — never from a guessed resolution, because the tool resolves no
 * version and talks to no registry (RFC 4.9).
 *
 * Decisions the RFC leaves open, resolved here and documented in `docs/rules/exact-versions.md`:
 * - `workspace:*` is a pinned internal link (exact); `workspace:^` and `workspace:~` are ranges.
 * - `link:` is a live local link, the same internal class; `file:` pins a path that moves with the
 *   working tree, so it counts as floating along with git/tarball/URL specifiers.
 * - `1` and `1.2` are ranges in npm semantics, so they are floating.
 * - A specifier whose shape this rule does not recognize is not reported; a guessed finding is worse
 *   than a missed one, and the doc page says so.
 * - A floating range is pinned with `pnpm pkg set` and the version the lockfile records (S4):
 *   `pnpm add --save-exact <name>@<range>` is a measured no-op on pnpm 12.3.4, because pnpm keeps the
 *   specifier the package already has.
 * - Except for an internal package, whose resolved version is a path: a `workspace:` range is pinned to
 *   `workspace:*`, never to the `link:../lib` the lockfile records for it, because writing the path
 *   over the protocol takes the package out of the workspace while the finding clears — the
 *   remediation destroying something the author wrote (368, `docs/spec/rules.md` R5). Measured on
 *   pnpm 12.3.4: `workspace:*` is written as given, the lockfile records `specifier: workspace:*`,
 *   and the package keeps its symlink into the workspace.
 */

import { LOCKFILE_ONLY_STEP } from '../lib/foreign-pin.js';
import { parseLockfile, recordedVersion, overrideTouches } from '../lib/lockfile.js';
import { repoSkipMessage } from '../lib/scope.js';
import { isFloating } from '../lib/specifiers.js';
import { manifestProblem } from '../lib/targets.js';

const DOC = 'docs/rules/exact-versions.md';
const WORKSPACE_YAML = 'pnpm-workspace.yaml';
const LOCKFILE = 'pnpm-lock.yaml';
const DEPENDENCY_TYPES = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
/** A specifier that asks for a workspace member rather than a registry version; only its floating
 * forms reach the remediation, because `workspace:*` and `workspace:<version>` are exact. */
const WORKSPACE_PROTOCOL = /^workspace:/i;
const URL_USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/i;
const CATALOG_SPECIFIER = /^catalog:(.*)$/;
/**
 * The only characters a printed `-C <dir>` may interpolate: every one of them is passed through untouched
 * by `cmd` and `bash`, with or without quoting. Anything else takes the prose route instead of a quoted
 * form, because double quotes stop `cmd` splitting the argument and do not stop `%NAME%` on `cmd` or
 * `$pkg`, `${pkg}` and a backtick on `bash` and `sh` — a quoted directory can send pnpm to one the
 * manifest never named (`R1-SHELL-INJECTION-DIR`, `R4-DIR-QUOTING`, 0042).
 */
const PROVABLY_SAFE_DIRECTORY = /^[A-Za-z0-9._/-]+$/;

/**
 * npm's grammar for a dependency name, and the only shape a printed command may interpolate:
 * `[A-Za-z0-9._~-]`, optionally behind one `@scope/`. This is where the pin fails closed
 * (`R1-SHELL-INJECTION-PIN`). The escaped, double-quoted spelling stops `cmd` splitting the argument and
 * it does NOT stop `bash`, `sh` or `zsh` expanding `$(…)`, `${…}` or a backtick inside those double
 * quotes — the single-quoted spelling it replaced did, and a manifest can carry any string a JSON key
 * can. A name outside this grammar is not escaped, quoted or filtered into shape: it takes no command
 * at all, and the finding names the edit instead.
 *
 * Uppercase is inside it (`R3-UPPERCASE-REGRESSION`): npm refuses new uppercase names but publishes
 * plenty of old ones — `JSONStream` is one — and no shell reads a letter's case, in either spelling.
 */
const SAFE_DEPENDENCY = /^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/;

/**
 * The grammar for the version a printed command carries, and the third value it interpolates (S2c,
 * `R4-PIN-SHELL-VERSION`). A recorded resolution is a string `pnpm-lock.yaml` can carry, and the
 * quote-free dotted path leaves it in the open: `dependencies.x=$(id)` expands on `bash` and `sh` before
 * pnpm ever sees it. The old single-quoted spelling suppressed that by accident of quoting, which is why
 * no grammar was needed; these spellings have no such accident.
 *
 * The class is the record's `[A-Za-z0-9._~:/@+-]` plus `*`, and the addition is not a concession: the two
 * shapes this rule itself prints need it and no shell executes or splits a `*` **inside the bracketed
 * form**, whose double quotes every shell reads literally. It is never safe on the quote-free dotted path,
 * so a version carrying one takes the bracketed spelling instead — `takesDottedPath` is where that is
 * decided (`R1-SHELL-GLOB-VERSION`). An internal package is pinned to `workspace:*` — the exact form S4
 * and 368 make this rule print — and a tarball URL reaches the command redacted as `https://***@host`,
 * which the class would otherwise refuse, dropping a command the rule is required to keep. An escape, a
 * quote or a filter is still never used: outside the class the caller prints no command at all.
 */
const SAFE_VERSION = /^[A-Za-z0-9._~:/@+*-]+$/;

/**
 * A specifier is echoed in messages and evidence, and the version the lockfile records is echoed in
 * the remediation, and a URL specifier can carry credentials in its userinfo
 * (`https://user:token@host/repo.tgz`). Every user but a bare `git` is replaced, so a scan never
 * prints a secret; the shape stays legible (RFC 4.9: never a guessed value).
 * @param {unknown} specifier
 * @returns {unknown}
 */
function redactedSpecifier(specifier) {
  if (typeof specifier !== 'string') return specifier;
  return specifier.replace(URL_USERINFO, (match, scheme, userinfo) =>
    userinfo.toLowerCase() === 'git' ? match : `${scheme}***@`,
  );
}

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Counts the braces of one JSON line, ignoring braces inside strings.
 * @param {string} line
 * @returns {number}
 */
function braceDelta(line) {
  let delta = 0;
  let quote = false;
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      if (quote) escaped = true;
      continue;
    }
    if (character === '"') {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (character === '{') delta += 1;
    else if (character === '}') delta -= 1;
  }
  return delta;
}

/**
 * The 1-based line of one dependency key inside its section of the parsed file text. Returns null
 * rather than a guessed line when the key cannot be attributed.
 * @param {string} text
 * @param {string} section
 * @param {string} name
 * @returns {number | null}
 */
function dependencyLine(text, section, name) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r\n|\n|\r/);
  const sectionStart = new RegExp(`^\\s*"${escapeRegExp(section)}"\\s*:\\s*\\{`);
  const key = new RegExp(`^\\s*"${escapeRegExp(name)}"\\s*:`);

  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (sectionStart.test(lines[index])) {
      start = index;
      break;
    }
  }
  if (start === -1) return null;

  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === start && depth === 0) {
      // A one-line or minified object: the key is on the section line itself.
      if (braceDelta(line) <= 0) return key.test(line) ? index + 1 : null;
    } else if (depth === 1) {
      if (key.test(line)) return index + 1;
      if (/^\s*\}/.test(line)) return null;
    }
    depth += braceDelta(line);
    if (index > start && depth <= 0) return null;
  }
  return null;
}

/** @param {{ dir: string }} importer */
function importerPath(importer) {
  return importer.dir === '.' ? 'package.json' : `${importer.dir}/package.json`;
}

/**
 * @param {object} importer
 * @returns {Array<{ type: string, dependency: string, specifier: unknown }>}
 */
function collectSpecifiers(importer) {
  const entries = [];
  const json = importer.json;
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return entries;

  for (const type of DEPENDENCY_TYPES) {
    const map = json[type];
    if (map === null || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const [dependency, specifier] of Object.entries(map)) {
      entries.push({ type, dependency, specifier });
    }
  }
  return entries;
}

/**
 * The specifier the lockfile records for a dependency of one importer, of the same kind. `null` means
 * the lockfile records no specifier of that kind for that name.
 *
 * The kind is not optional. `importers.<dir>.specifiers` is kind-agnostic and comes first, but the
 * dependency blocks are not: pnpm 9 records no `peerDependencies` in an importer block at all, and it
 * records one entry per name, so the `devDependencies` record of a peer is a different declaration
 * and comparing a peer spec against it invented 7 of 8 desyncs on a real repository (field round 4).
 *
 * @param {object | undefined} lock
 * @param {string} name
 * @param {string} type the section the manifest entry lives in
 * @returns {string | null}
 */
function lockfileSpecifier(lock, name, type) {
  if (!lock) return null;
  const direct = lock.specifiers?.[name];
  if (typeof direct === 'string') return direct;
  const record = lock[type]?.[name];
  if (record && typeof record.specifier === 'string') return record.specifier;
  return null;
}

/**
 * Whether the lockfile records the dependency at all, under any kind. A name recorded elsewhere is a
 * different declaration of the same package — pnpm writes one entry per importer — so it is not a
 * missing record, and reporting one would be a desync that cannot exist.
 * @param {object | undefined} lock
 * @param {string} name
 * @returns {boolean}
 */
function lockfileRecordsName(lock, name) {
  if (!lock) return false;
  if (typeof lock.specifiers?.[name] === 'string') return true;
  return DEPENDENCY_TYPES.some((type) => lock[type]?.[name] !== undefined);
}

/**
 * The catalogue a `catalog:` or `catalog:<name>` specifier reads its range from. `catalog:` alone is
 * the `default` catalogue, which is the key pnpm records (`catalog:` is the shorthand for it).
 * @param {string} specifier
 * @returns {{ name: string } | null}
 */
function catalogReference(specifier) {
  const match = CATALOG_SPECIFIER.exec(specifier.trim());
  if (match === null) return null;
  const name = match[1].trim();
  return { name: name === '' ? 'default' : name };
}

/**
 * Whether a dependency name takes the quote-free dotted property path, which is the one spelling `cmd`
 * reads with no quoting at all. Three clauses, each a measurement on a published name (0042): a scoped
 * name is refused with ERR_PNPM_PKG_INVALID_PROPERTY_PATH, a name carrying a dot is read as two path
 * segments and corrupts the manifest while exiting `0`, and a digit-leading name is refused because the
 * segment after a dot is parsed as an array index.
 *
 * A fourth clause is the version (`R1-SHELL-GLOB-VERSION`): the dotted path is unquoted, so `bash` and
 * `sh` glob the whole word, and a file named `dependencies.left-pad=workspace:1.2.3` would replace
 * `dependencies.left-pad=workspace:*`. A version carrying a star takes the bracketed form instead.
 *
 * @param {string} dependency
 * @param {string} version
 * @returns {boolean}
 */
function takesDottedPath(dependency, version) {
  return (
    !dependency.includes('@') &&
    !dependency.includes('.') &&
    !/^[0-9]/.test(dependency) &&
    !version.includes('*')
  );
}

/**
 * The `-C <dir> ` prefix that makes a pnpm command act on the manifest that owns a finding.
 *
 * Measured on create-t3-app (80 of 96 findings): `pnpm pkg set` printed for a finding at
 * `cli/package.json` runs at the repository root and writes into the ROOT manifest. The root importer
 * keeps the bare form, because that is the directory the reader already is in.
 *
 * The directory is interpolated bare, and only when every character in it is one `cmd` and `bash` pass
 * through untouched: `pinCommand` asks `provablySafeDirectory` before it builds anything, and prints no
 * command for a directory outside that class. Quoting is not the alternative it looks like. Measured:
 * bare `-C packages/a&b` splits the line on `cmd` and the install never runs, bare `-C packages/a^b`
 * silently resolves to `packages/ab` with exit 0, and `-C "packages/a&b"`, `"packages/a;b"` and
 * `"packages/a^b"` all arrive exact — but `-C "packages/$pkg"` arrives as whatever `pkg` happens to
 * hold, because double quotes do not stop expansion on `bash` and `sh`, and `%NAME%` still expands
 * inside them on `cmd` (`R1-SHELL-INJECTION-DIR`, `R4-DIR-QUOTING`).
 *
 * @param {string | undefined} dir the importer directory, relative to the repository root
 * @returns {string}
 */
function pnpmAt(dir) {
  if (typeof dir !== 'string' || dir === '' || dir === '.') return '';
  return `-C ${dir} `;
}

/**
 * Whether a directory may be interpolated into a printed command at all. The root importer needs no
 * prefix, so it needs no grammar.
 * @param {string | undefined} dir
 * @returns {boolean}
 */
function provablySafeDirectory(dir) {
  return typeof dir !== 'string' || dir === '' || dir === '.' || PROVABLY_SAFE_DIRECTORY.test(dir);
}

/**
 * The pin the catalogue prints for a floating range (S4, field round 4). `pnpm add --save-exact
 * <name>@<range>` is a measured no-op on pnpm 12.3.4 — pnpm keeps the range the package already
 * declares — so the command that works is `pnpm pkg set` with the resolved version the lockfile
 * records, followed by `pnpm install`, both pointed at the importer that owns the manifest.
 *
 * It prints only when every value in it is provably safe, and that is the whole point: a dependency
 * name and an importer directory are strings a manifest or a workspace file carries, so a spelling that
 * needs escaping to carry one is a spelling that runs what the string says (`R1-SHELL-INJECTION-PIN`,
 * `R1-SHELL-INJECTION-DIR`, `R4-DIR-QUOTING`).
 *
 * The name must match npm's own grammar — `SAFE_DEPENDENCY` — the version `SAFE_VERSION`, and the
 * directory `PROVABLY_SAFE_DIRECTORY`. Outside any one of them this returns `null`, deliberately not a
 * quoted or escaped variant, and the caller prints the route where the reader edits the manifest by
 * hand. The single-quoted spelling this replaced suppressed `$(…)`, `${…}` and backticks by accident,
 * not by design; quotes are not a boundary a shell has to respect, and the next spelling would lose it
 * again.
 *
 * Two spellings remain for the names that pass, because no one spelling is read by every shell (0042,
 * measured across `cmd`, `bash`, `sh`, `pwsh` 7 and Windows PowerShell 5.1, every cell executed). A name
 * that is unscoped, carries no dot and does not start with a digit takes the quote-free dotted path —
 * `pnpm pkg set dependencies.left-pad=1.3.0` — which is the one spelling `cmd` reads with no quoting at
 * all; a version carrying a `*` takes the bracketed one instead, because the dotted path is unquoted and
 * `bash` and `sh` glob it (`R1-SHELL-GLOB-VERSION`). Every other name takes the bracketed path, the whole
 * argument double-quoted with its inner quotes escaped: `pnpm pkg set "dependencies[\"@types/node\"]=20.11.5"`.
 * Both are read identically by
 * `cmd`, `bash` and `sh` for a name inside the grammar; the two shells that lose one are named in
 * `limits` rather than worked around here.
 *
 * Each clause of that predicate is a measurement on a published name, not a style preference:
 * `devDependencies.@types/node=1` is refused with ERR_PNPM_PKG_INVALID_PROPERTY_PATH, because `@` is not
 * a token a dot path can carry and scoped names are most of a modern dependency set;
 * `dependencies.lodash.merge=…` is read as three path segments and writes a nested `lodash` object
 * beside the untouched entry while exiting 0, a corruption the exit code calls success; and
 * `dependencies.7zip-bin=…` is refused with `Numeric suffix "z" is not supported`, because the segment
 * after a dot is parsed as an array index.
 *
 * Exported because the text is a claim somebody follows: `scripts/probe-remediation.js` runs this exact
 * command in a scratch directory and asserts the manifest carries the value afterwards (S7). A copy
 * beside it would drift from the finding, and the measurement would then be about a command nobody
 * prints.
 *
 * @param {{ type: string, dependency: string, version: string, dir?: string }} options
 * @returns {string | null} the line to paste, or `null` when a value in it is not provably safe
 */
export function pinCommand({ type, dependency, version, dir }) {
  if (typeof dependency !== 'string' || !SAFE_DEPENDENCY.test(dependency)) return null;
  if (typeof version !== 'string' || !SAFE_VERSION.test(version)) return null;
  if (!provablySafeDirectory(dir)) return null;
  const at = pnpmAt(dir);
  const path = takesDottedPath(dependency, version)
    ? `${type}.${dependency}=${version}`
    : `"${type}[\\"${dependency}\\"]=${version}"`;
  return `pnpm ${at}pkg set ${path} && pnpm ${at}install`;
}

/**
 * The route where no command may be printed, for a value outside the grammar a shell can be told to
 * treat as data. It is the shape a declared `frozenLockfile` already produces — `manual`, with the edit
 * in the file the reader owns — and never a new one: the finding keeps naming the range, its kind and
 * its file, and what changes is only that it stops claiming a line somebody can paste.
 *
 * @param {{ type: string, dependency: string, version: string, dir?: string }} options
 * @returns {string}
 */
function unsafeRoute({ type, dependency, version, dir }) {
  const manifest = dir === undefined || dir === '.' ? 'package.json' : `${dir}/package.json`;
  // Both values are rendered as JSON strings: the route exists because one of them carries a character a
  // shell would act on, and a raw `$(…)` or a newline in the prose is still text a reader has to read.
  return `edit ${manifest} by hand: set the ${type} entry ${JSON.stringify(dependency)} to ${JSON.stringify(String(version))} — this rule prints no command for a name, directory or version a shell would expand or split`;
}

/**
 * The remediation of a pin: the command when `pinCommand` can prove every value safe, and the hand edit
 * when it cannot.
 * @param {{ type: string, dependency: string, version: string, dir?: string }} options
 * @returns {{ kind: string, command: string }}
 */
function pinnedRoute(options) {
  return { kind: 'manual', command: pinCommand(options) ?? unsafeRoute(options) };
}

/**
 * Whether this repository declares that it freezes its own lockfile. A line scan, top level only, and
 * the camelCase spelling pnpm actually honours: `.npmrc`'s `frozen-lockfile` and the kebab
 * `frozen-lockfile:` in `pnpm-workspace.yaml` are both ignored by pnpm 12.3.4 (measured), so reading
 * either would make a repository that updates its lockfile fine lose the route that works.
 * `false` when the file was not read, because an unread file is never an absence.
 *
 * @param {unknown} text the `pnpm-workspace.yaml` body, or null when it was not read
 * @returns {boolean}
 */
function declaresFrozenLockfile(text) {
  return typeof text === 'string' && /^frozenLockfile:[ \t]*true[ \t]*$/m.test(text);
}

/**
 * The route where the repository declares its own freeze: the edit, in the file the reader owns, and the
 * lockfile in the same change. It names no install, because none succeeds there, and it changes nothing
 * else the author wrote — the obligation every remediation carries (L6).
 *
 * @param {{ type: string, dependency: string, version: string | null, specifier?: unknown, dir?: string }} options
 * @returns {string}
 */
function frozenRoute({ type, dependency, version, specifier, dir }) {
  const target =
    typeof specifier === 'string' && WORKSPACE_PROTOCOL.test(specifier.trim())
      ? 'workspace:*'
      : typeof version === 'string' && version !== ''
        ? version
        : '<the version pnpm-lock.yaml records>';
  const manifest = dir === undefined || dir === '.' ? 'package.json' : `${dir}/package.json`;
  return `edit ${manifest} by hand: set '${type}["${dependency}"]=${target}' and move pnpm-lock.yaml in the same change — this repository declares frozenLockfile: true in pnpm-workspace.yaml, so the install refuses to move the lockfile itself (ERR_PNPM_OUTDATED_LOCKFILE)`;
}

/**
 * The remediation of a floating range (S4, field round 4).
 *
 * An internal package is the one case where the lockfile's resolved version must not be written: for a
 * `workspace:` range it is a `link:../lib` path, and a path in place of the protocol takes the package
 * out of the workspace while the finding clears (368). The exact form for an internal package is the
 * one Detection names, `workspace:*`, and it needs no lockfile record at all — so this branch comes
 * before the resolve step, which exists only for a version this rule cannot know.
 *
 * With no recorded version the tool invents nothing (RFC 4.9): the remediation is the resolve step
 * plus the scan, which then prints the exact pin for that repository. That step writes the lockfile
 * rather than a manifest, so it stays workspace-wide — and it is `LOCKFILE_ONLY_STEP`, imported, so the
 * probe that follows it measures the command this finding prints.
 *
 * @param {{ type: string, dependency: string, version: string | null, specifier?: unknown, dir?: string, frozen?: boolean }} options
 * @returns {{ kind: string, command: string }}
 */
function floatingRemediation({ type, dependency, version, specifier, dir, frozen = false }) {
  // A declared freeze is the one configuration where no printed command clears the finding, so the
  // finding says what to edit instead of naming a route that refuses: `pnpm install` and
  // `pnpm install --lockfile-only` both exit 1 with ERR_PNPM_OUTDATED_LOCKFILE there, and the only
  // flag that would record the pin is the one R10 (`ci-no-safety-overrides`) reports. Measured on
  // pnpm 12.3.4 (373).
  if (frozen) return { kind: 'manual', command: frozenRoute({ type, dependency, version, specifier, dir }) };
  if (typeof specifier === 'string' && WORKSPACE_PROTOCOL.test(specifier.trim())) {
    return pinnedRoute({ type, dependency, version: 'workspace:*', dir });
  }
  if (typeof version !== 'string' || version === '') {
    return {
      kind: 'manual',
      command: `${LOCKFILE_ONLY_STEP} && funky-secure scan --only exact-versions`,
    };
  }
  return pinnedRoute({ type, dependency, version, dir });
}

/**
 * The finding for a catalogue range.
 *
 * The range lives in `pnpm-workspace.yaml`'s catalogue map, not in the `package.json` line that refers
 * to it, and that line cannot be made exact: rewriting it would detach the dependency from the
 * catalogue. So the finding names the file that holds the range and the catalogue entry to change,
 * and never a `pnpm pkg set` this repository cannot follow.
 *
 * @param {{ entry: object, path: string, reference: { name: string }, catalogue: { specifier: string, version: string } }} options
 * @returns {object}
 */
function catalogFinding({ entry, path, reference, catalogue }) {
  const shown = redactedSpecifier(catalogue.specifier);
  const recorded = redactedSpecifier(catalogue.version);
  const where =
    reference.name === 'default'
      ? `catalog["${entry.dependency}"]`
      : `catalogs["${reference.name}"]["${entry.dependency}"]`;
  return {
    status: 'fail',
    code: 'floating-range',
    path: WORKSPACE_YAML,
    message: `${entry.dependency} is ${redactedSpecifier(entry.specifier)} in ${path}, and the ${reference.name} catalogue in ${WORKSPACE_YAML} holds the range ${shown}, not an exact version`,
    evidence: {
      specifier: shown,
      dependency: entry.dependency,
      type: entry.type,
      catalog: reference.name,
    },
    remediation: {
      kind: 'manual',
      command:
        typeof recorded === 'string' && recorded !== ''
          ? `edit ${WORKSPACE_YAML} and set ${where} to ${recorded}`
          : `edit ${WORKSPACE_YAML} and set ${where} to an exact version`,
    },
  };
}

export default {
  id: 'exact-versions',
  title: 'Dependency specifiers are exact',
  label: 'Dependency ranges',
  scope: ['repo'],
  targets: ['importer'],
  friction: 2,
  severity: { baseline: 'warn', strict: 'error' },
  question: 'Are dependency specifiers exact, and does the lockfile agree?',
  detection:
    'Walk dependencies, devDependencies, optionalDependencies and peerDependencies of every importer. A specifier is floating when it starts with ^ ~ > < *, equals latest, contains an x/X version token, is a partial version, or is a git/tarball/URL specifier; exact means a literal version, npm:<pkg>@<version> or workspace:*. A catalog: or catalog:<name> specifier reads its range from the catalogue map pnpm-lock.yaml records: it is floating only when that entry holds a range, and the finding names pnpm-workspace.yaml, the file that holds it. Each floating specifier is one finding with its file:line. Every specifier is then compared with the lockfile record of the same dependency kind; a disagreement is one lockfile-desync finding, a record of another kind is not compared, and a specifier an override rewrote is never reported. An unsupported lockfile shape yields a skip that names pnpm-lock.yaml, never a guessed comparison, and an importer whose package.json cannot be interpreted is its own skip naming that file and what is wrong with it. A pnpm-workspace.yaml entry refused for resolving outside the repository root is a skip naming the file and the entry, so an importer never disappears without a word.',
  evidence:
    '{ specifier, dependency, type } for a floating range (plus catalog for a catalogue range; resolved is null when the lockfile has no record), { specifier, resolved } for a desync.',
  remediation: `Manual: one command per finding, in one of two spellings chosen by the name and the version, both read identically by cmd, bash and sh. A name that is unscoped, carries no dot and does not start with a digit takes the quote-free dotted path — pnpm -C <importer dir> pkg set <section>.<name>=<version> && pnpm -C <importer dir> install — unless the version carries a *, which bash and sh would glob on that unquoted path; every other name, and every version carrying a star, takes the bracketed one, the whole argument double-quoted with its inner quotes escaped — pnpm -C <importer dir> pkg set "<section>[\\"<name>\\"]=<version>" && pnpm -C <importer dir> install — because cmd passes single quotes to pnpm literally, a dot path cannot carry a scoped name, it corrupts a name that carries a dot, and it is refused for a name that starts with a digit (0042). A dependency name outside npm's grammar — a $, a backtick, a quote, a backslash or a space — an importer directory whose characters are not all passed through untouched by cmd and bash, and a version pnpm-lock.yaml records that carries any character outside A-Za-z0-9._~:/@+- (plus the * of the workspace:* pin this rule prints) print no command at all: the route is the edit in the manifest instead, because escaping quotes stops cmd splitting the argument and does not stop bash expanding $(…), \${…} or a backtick inside them, and a manifest or a lockfile can carry any string (0042). Both pin the version pnpm-lock.yaml records in the manifest that declares it (the root importer keeps the bare form), because pnpm add --save-exact <name>@<range> is a measured no-op on pnpm 12.3.4 and keeps the range. A workspace: range is pinned to workspace:* instead, because the version the lockfile records for an internal package is a link: path and writing it takes the package out of the workspace. In a repository whose pnpm-workspace.yaml declares frozenLockfile: true the route is a hand edit instead — the manifest set and the lockfile moved in one change — because pnpm install and pnpm install --lockfile-only both refuse there with ERR_PNPM_OUTDATED_LOCKFILE, and the flag that would record it is the override R10 reports (373). A catalogue range is edited in pnpm-workspace.yaml, because the package.json line that refers to the catalogue cannot be made exact. With no recorded version the remediation resolves first: pnpm install --lockfile-only && funky-secure scan --only exact-versions. A desync is refreshed with pnpm install --lockfile-only. No auto fix, because rewriting a range without re-resolving is how a lockfile desync is created.`,
  limits:
    'The rule resolves nothing: the command names the current specifier and pnpm writes the exact version. A specifier shape this rule does not recognize is not reported. An unsupported lockfile shape (lockfileVersion other than 6.0 or 9.0, patchedDependencies, a catalogue entry that is not a {specifier, version} map) skips the comparison rather than guessing it. peerDependencies are compared only when the lockfile records that kind: an importer block records no peer dependency, so a peer specifier is not compared against another section record. The pin is written for cmd, bash and sh, and the two shells that lose a form are named rather than hidden: pwsh 7 splits the escaped bracketed argument into two, which pnpm answers with ERR_PNPM_PKG_SET_INVALID_ARG and a write of nothing, and Windows PowerShell 5.1 rejects && before it reads any quoting, so no spelling of this command runs there (0042). A -C directory is printed only when every character in it is one both shells pass through untouched, because double quotes stop cmd splitting a directory like packages/a b and do not stop %NAME% on cmd or a backtick and $pkg on bash and sh, so a directory outside that class takes the prose route with the manifest to edit, exactly as a dependency name outside npm\'s grammar and a recorded version outside its own class do, and none of them is a route a reader is left to guess (0042).',
  docs: DOC,

  /**
   * @param {object} ctx resolved context
   * @returns {Array<object>} findings
   */
  detect(ctx) {
    if (!ctx.repo) {
      return [
        {
          status: 'skip',
          code: 'no-repo',
          scope: 'repo',
          target: 'importer',
          message: repoSkipMessage(ctx),
          probeUnavailable: true,
        },
      ];
    }

    const findings = [];
    const comparisons = [];
    const importers = Array.isArray(ctx.repo.importers) ? ctx.repo.importers : [];
    let inspected = 0;
    let unreadable = 0;

    // The lockfile is read once, before the specifiers are walked, because the remediation of a
    // floating range names the version it records (S4). No lockfile and an unsupported shape are
    // still skips of the comparison only (RFC 7.3).
    const lockfileText = ctx.repo.files?.lockfile?.text;
    // Read once: the freeze belongs to the repository, not to an importer.
    const frozen = declaresFrozenLockfile(ctx.repo.files?.workspaceYaml?.text);
    let parsed = null;
    let skip = null;

    if (typeof lockfileText !== 'string') {
      skip = {
        status: 'skip',
        code: 'no-lockfile',
        // The fact measured is the absent lockfile, so the sentence names the comparison that lockfile
        // would have enabled — never an importer (a manifest without a lockfile still yields its
        // floating ranges) and never the whole rule, which ran (369).
        message: 'skipped: no pnpm-lock.yaml, so the specifier-versus-lockfile comparison did not run',
      };
    } else {
      const read = parseLockfile(lockfileText);
      if (read.supported) {
        parsed = read;
      } else {
        skip = {
          status: 'skip',
          code: 'unsupported-lockfile-shape',
          // The detail ends in a line number (`expected "key: value" at line 3`), and a line number
          // with no file is not something a reader can open (S6).
          path: LOCKFILE,
          message: `skipped: ${read.detail}`,
          evidence: { reason: read.reason },
        };
      }
    }

    for (const importer of importers) {
      const path = importerPath(importer);

      // A manifest that exists and cannot be interpreted is not a manifest that was compared (S4):
      // the rule says which file it could not read and what is wrong with it, instead of dropping the
      // importer in silence. A byte-order mark is not "invalid JSON" and is said in its own words.
      const problem = manifestProblem(importer);
      if (problem !== null) {
        unreadable += 1;
        findings.push({
          status: 'skip',
          code: 'unparseable-package-json',
          path,
          message: `skipped: ${path} ${problem.detail}, so its specifiers were not compared against ${LOCKFILE}`,
          evidence: { problem: problem.code },
          remediation: { kind: 'none' },
          probeUnavailable: true,
        });
        continue;
      }

      inspected += 1;

      for (const entry of collectSpecifiers(importer)) {
        if (typeof entry.specifier !== 'string') continue;
        const line = dependencyLine(importer.text, entry.type, entry.dependency);
        comparisons.push({ importer, path, line, entry });

        const reference = catalogReference(entry.specifier);
        if (reference !== null) {
          // The range is the catalogue's, and the catalogue lives in pnpm-workspace.yaml. With no
          // catalogue record nothing is attributable: the file that holds the range is unknown, so
          // the rule reports nothing rather than a package.json line that cannot be made exact.
          const catalogue = parsed?.catalogs?.[reference.name]?.[entry.dependency];
          if (parsed === null || catalogue === undefined) continue;
          if (!isFloating(catalogue.specifier)) continue;
          findings.push(catalogFinding({ entry, path, reference, catalogue }));
          continue;
        }

        if (isFloating(entry.specifier)) {
          const shown = redactedSpecifier(entry.specifier);
          const version =
            parsed === null
              ? null
              : recordedVersion(parsed.importers[importer.dir], entry.dependency, entry.type);
          findings.push({
            status: 'fail',
            code: 'floating-range',
            path,
            line: line ?? undefined,
            message: `${entry.dependency}@${shown} is a floating range`,
            evidence: {
              specifier: shown,
              dependency: entry.dependency,
              type: entry.type,
            },
            remediation: floatingRemediation({
              type: entry.type,
              dependency: entry.dependency,
              // A recorded resolution can be a URL too, so it is redacted like the specifier.
              version: redactedSpecifier(version),
              // The raw specifier, not the redacted echo: this only decides whether the specifier is a
              // `workspace:` range, and that prefix is never a secret.
              specifier: entry.specifier,
              dir: importer.dir,
              frozen,
            }),
          });
        }
      }
    }

    if (parsed !== null) {
      const overrides = parsed.overrides ?? [];
      for (const { importer, path, line, entry } of comparisons) {
        // An override rewrote this specifier on purpose: the lockfile disagrees with the manifest by
        // construction, and reporting it would be reporting the override, not a desync.
        if (overrideTouches(overrides, entry.dependency)) continue;

        const lock = parsed.importers[importer.dir];
        const recorded = lockfileSpecifier(lock, entry.dependency, entry.type);
        if (recorded !== null && recorded === entry.specifier.trim()) continue;

        if (recorded === null) {
          // An importer block records no peer dependency at all, and a name it records under another
          // section is a different declaration of the same package: neither is a disagreement this
          // rule can attribute, and both used to be reported as one (field round 4).
          if (entry.type === 'peerDependencies') continue;
          if (lockfileRecordsName(lock, entry.dependency)) continue;
        }

        const shown = redactedSpecifier(entry.specifier);
        const shownResolved = redactedSpecifier(recorded);
        findings.push({
          status: 'fail',
          code: 'lockfile-desync',
          path,
          line: line ?? undefined,
          message:
            recorded === null
              ? `${entry.dependency}@${shown} is not recorded in pnpm-lock.yaml`
              : `${entry.dependency} is ${shown} in package.json but ${shownResolved} in pnpm-lock.yaml`,
          evidence: { specifier: shown, resolved: shownResolved },
          // Imported, never spelled here: the probe of the remediation's effect runs the same string
          // this finding prints (S7), and two copies would drift.
          remediation: { kind: 'manual', command: LOCKFILE_ONLY_STEP },
        });
      }
    }

    // An entry `pnpm-workspace.yaml` declares and this scan refused is a file the reader will not
    // find in the report otherwise (S8): the importer it would have produced disappears, and an
    // importer that disappears without a word is the same defect in a quieter form. The shape is the
    // catalogue finding's — the file that holds the entry, then the entry — so there is one reporting
    // path for what the workspace declares.
    //
    // Only the refusal is reported as a refusal. A nested glob is a documented limitation of the
    // single-level expansion, not a refused importer, so it stays silent: no positive pattern covered
    // the directories it would have matched. A `!` negation is the opposite case — a positive entry
    // does cover its directories and the scan reads them anyway — so it is named, in its own words,
    // and never as a refusal (0036).
    const skippedGlobs = Array.isArray(ctx.repo.skippedGlobs) ? ctx.repo.skippedGlobs : [];
    for (const skipped of skippedGlobs) {
      if (skipped.code === 'workspace-entry-not-applied') {
        findings.push({
          status: 'skip',
          code: 'workspace-entry-not-applied',
          path: WORKSPACE_YAML,
          message: `skipped: the packages entry "${skipped.entry}" in ${WORKSPACE_YAML}: ${skipped.reason}`,
          evidence: { entry: skipped.entry, reason: skipped.code },
          remediation: { kind: 'none' },
        });
        continue;
      }
      if (skipped.code !== 'outside-root') continue;
      findings.push({
        status: 'skip',
        code: `workspace-entry-${skipped.code}`,
        path: WORKSPACE_YAML,
        message: `skipped: the packages entry "${skipped.entry}" in ${WORKSPACE_YAML} was refused: ${skipped.reason}`,
        evidence: { entry: skipped.entry, reason: skipped.code },
        remediation: { kind: 'none' },
      });
    }

    if (skip !== null) findings.push(skip);
    else if (inspected === 0 && unreadable === 0) {
      // Nothing was read, so nothing was compared: "every specifier is exact" would be a claim this
      // rule never checked (RFC 7.3: a missing fact is a skip, never a pass).
      findings.push({
        status: 'skip',
        code: 'unreadable-package-json',
        message: `skipped: the repository collects no importer package.json, so no specifier was compared against pnpm-lock.yaml`,
        evidence: { importers: importers.length },
        remediation: { kind: 'none' },
        probeUnavailable: true,
      });
    } else if (findings.length === 0) {
      findings.push({
        status: 'pass',
        message: 'every dependency specifier is exact and agrees with pnpm-lock.yaml',
      });
    }

    return findings;
  },
};
