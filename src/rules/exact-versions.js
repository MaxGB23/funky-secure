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
 */

import { parseLockfile, recordedVersion, overrideTouches } from '../lib/lockfile.js';
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
const URL_USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/i;
const CATALOG_SPECIFIER = /^catalog:(.*)$/;

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
 * The `-C <dir> ` prefix that makes a pnpm command act on the manifest that owns a finding.
 *
 * Measured on create-t3-app (80 of 96 findings): `pnpm pkg set` printed for a finding at
 * `cli/package.json` runs at the repository root and writes into the ROOT manifest. The root importer
 * keeps the bare form, because that is the directory the reader already is in.
 *
 * @param {string | undefined} dir the importer directory, relative to the repository root
 * @returns {string}
 */
function pnpmAt(dir) {
  if (typeof dir !== 'string' || dir === '' || dir === '.') return '';
  const shown = /[\s'"]/.test(dir) ? `'${dir.replaceAll("'", "'\\''")}'` : dir;
  return `-C ${shown} `;
}

/**
 * The remediation of a floating range (S4, field round 4). `pnpm add --save-exact <name>@<range>` is a
 * measured no-op on pnpm 12.3.4 — pnpm keeps the range the package already declares — so the command
 * that works is `pnpm pkg set` with the resolved version the lockfile records, followed by
 * `pnpm install`, both pointed at the importer that owns the manifest.
 *
 * The property path is bracketed, not dotted: `pnpm pkg set 'devDependencies.@types/node=1'` fails on
 * pnpm 12.3.4 with ERR_PNPM_PKG_INVALID_PROPERTY_PATH, because `@` is not a token a dot path can carry,
 * and scoped names are most of a modern dependency set. The bracket form works unchanged for an
 * unscoped name, so there is one form and one thing to remember.
 *
 * With no recorded version the tool invents nothing (RFC 4.9): the remediation is the resolve step
 * plus the scan, which then prints the exact pin for that repository. That step writes the lockfile
 * rather than a manifest, so it stays workspace-wide.
 *
 * @param {{ type: string, dependency: string, version: string | null, dir?: string }} options
 * @returns {{ kind: string, command: string }}
 */
function floatingRemediation({ type, dependency, version, dir }) {
  if (typeof version !== 'string' || version === '') {
    return {
      kind: 'manual',
      command: 'pnpm install --lockfile-only && funky-secure scan --only exact-versions',
    };
  }
  const at = pnpmAt(dir);
  return {
    kind: 'manual',
    command: `pnpm ${at}pkg set '${type}["${dependency}"]=${version}' && pnpm ${at}install`,
  };
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
  remediation:
    "Manual: pnpm -C <importer dir> pkg set '<section>[\"<name>\"]=<version>' && pnpm -C <importer dir> install pins the version pnpm-lock.yaml records in the manifest that declares it (the root importer keeps the bare form), because pnpm add --save-exact <name>@<range> is a measured no-op on pnpm 12.3.4 and keeps the range. A catalogue range is edited in pnpm-workspace.yaml, because the package.json line that refers to the catalogue cannot be made exact. With no recorded version the remediation resolves first: pnpm install --lockfile-only && funky-secure scan --only exact-versions. A desync is refreshed with pnpm install --lockfile-only. No auto fix, because rewriting a range without re-resolving is how a lockfile desync is created.",
  limits:
    'The rule resolves nothing: the command names the current specifier and pnpm writes the exact version. A specifier shape this rule does not recognize is not reported. An unsupported lockfile shape (lockfileVersion other than 6.0 or 9.0, patchedDependencies, a catalogue entry that is not a {specifier, version} map) skips the comparison rather than guessing it. peerDependencies are compared only when the lockfile records that kind: an importer block records no peer dependency, so a peer specifier is not compared against another section record.',
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
          message: 'skipped: no repository was resolved',
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
    let parsed = null;
    let skip = null;

    if (typeof lockfileText !== 'string') {
      skip = {
        status: 'skip',
        code: 'no-lockfile',
        message: 'skipped: no pnpm-lock.yaml to compare specifiers against',
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
              dir: importer.dir,
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
          remediation: { kind: 'manual', command: 'pnpm install --lockfile-only' },
        });
      }
    }

    // An entry `pnpm-workspace.yaml` declares and this scan refused is a file the reader will not
    // find in the report otherwise (S8): the importer it would have produced disappears, and an
    // importer that disappears without a word is the same defect in a quieter form. The shape is the
    // catalogue finding's — the file that holds the entry, then the entry — so there is one reporting
    // path for what the workspace declares.
    //
    // Only the refusal is reported. A nested glob is a documented limitation of the single-level
    // expansion, not a refused importer: `!**/test/**` is a negation, so saying its directories are
    // not read would be false, and a real repository (shadcn-ui/ui) carries four of them.
    const skippedGlobs = Array.isArray(ctx.repo.skippedGlobs) ? ctx.repo.skippedGlobs : [];
    for (const skipped of skippedGlobs) {
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
