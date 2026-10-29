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

import { parseLockfile } from '../lib/lockfile.js';

const DOC = 'docs/rules/exact-versions.md';
const DEPENDENCY_TYPES = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const URL_USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/i;
const EXACT_LITERAL = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PARTIAL_LITERAL = /^\d+(?:\.\d+)*$/;
const TAG_LITERAL = /^[a-z][a-z0-9._-]*$/i;

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
 * A wildcard version token such as `x`, `1.x` or `1.2.X`.
 * @param {string} value
 * @returns {boolean}
 */
function isWildcard(value) {
  const segments = value.split('.');
  return (
    segments.some((segment) => /^[xX]$/.test(segment)) &&
    segments.every((segment) => /^[xX]$/.test(segment) || /^\d+$/.test(segment))
  );
}

/**
 * @param {unknown} specifier
 * @returns {boolean}
 */
function isFloating(specifier) {
  if (typeof specifier !== 'string') return false;
  const value = specifier.trim();
  if (value === '') return false;

  const scheme = value.match(SCHEME)?.[1]?.toLowerCase() ?? null;
  if (scheme !== null) {
    if (scheme === 'npm') {
      const rest = value.slice('npm:'.length);
      const at = rest.lastIndexOf('@');
      if (at <= 0) return true;
      return isFloating(rest.slice(at + 1));
    }
    // workspace:* is a pinned internal link, workspace:^ and workspace:~ are ranges, and
    // workspace:<literal version> is a pin like any other literal version.
    if (scheme === 'workspace') {
      const rest = value.slice('workspace:'.length);
      if (rest === '*') return false;
      return isFloating(rest);
    }
    // link: is a live local link (the workspace:*-like internal case); git+, github:, http(s):,
    // git:, ssh: and file: pin no registry version at all.
    return scheme !== 'link';
  }

  if (value === 'latest') return true;
  if (/^[\^~<>]/.test(value)) return true;
  if (value.startsWith('*')) return true;
  if (isWildcard(value)) return true;
  if (/\s|\|\|/.test(value)) return true;
  if (EXACT_LITERAL.test(value)) return false;
  if (/^v\d/.test(value) && EXACT_LITERAL.test(value.slice(1))) return false;
  if (PARTIAL_LITERAL.test(value)) return true;
  if (TAG_LITERAL.test(value)) return true;
  return false;
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
 * The specifier the lockfile records for a dependency of one importer: the `specifiers` map first,
 * then the dependency blocks. `null` means the dependency is not recorded at all.
 * @param {object | undefined} lock
 * @param {string} name
 * @returns {string | null}
 */
function lockfileSpecifier(lock, name) {
  if (!lock) return null;
  const direct = lock.specifiers?.[name];
  if (typeof direct === 'string') return direct;
  for (const type of DEPENDENCY_TYPES) {
    const record = lock[type]?.[name];
    if (record && typeof record.specifier === 'string') return record.specifier;
  }
  return null;
}

/**
 * The version pnpm resolved for one dependency of one importer, as `pnpm-lock.yaml` records it. The
 * inline dependency form carries no version, so this is `null` there: the rule never guesses one.
 * @param {object | undefined} lock
 * @param {string} name
 * @param {string} type the section the entry lives in
 * @returns {string | null}
 */
function recordedVersion(lock, name, type) {
  const record = lock?.[type]?.[name];
  if (!record || typeof record.version !== 'string' || record.version === '') return null;
  return record.version;
}

/**
 * The remediation of a floating range (S4). `pnpm add --save-exact <name>@<range>` is a measured
 * no-op on pnpm 12.3.4 — pnpm keeps the range the package already declares — so the command that
 * works is `pnpm pkg set` with the resolved version the lockfile records, followed by `pnpm install`.
 *
 * With no recorded version the tool invents nothing (RFC 4.9): the remediation is the resolve step
 * plus the scan, which then prints the exact pin for that repository.
 *
 * @param {{ type: string, dependency: string, version: string | null }} options
 * @returns {{ kind: string, command: string }}
 */
function floatingRemediation({ type, dependency, version }) {
  if (typeof version !== 'string' || version === '') {
    return {
      kind: 'manual',
      command: 'pnpm install --lockfile-only && funky-secure scan --only exact-versions',
    };
  }
  return { kind: 'manual', command: `pnpm pkg set '${type}.${dependency}=${version}' && pnpm install` };
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
    'Walk dependencies, devDependencies, optionalDependencies and peerDependencies of every importer. A specifier is floating when it starts with ^ ~ > < *, equals latest, contains an x/X version token, is a partial version, or is a git/tarball/URL specifier; exact means a literal version, npm:<pkg>@<version> or workspace:*. Each floating specifier is one finding with its file:line. Every specifier is then compared with the lockfile importer record; a disagreement or a missing record is one lockfile-desync finding. An unsupported lockfile shape yields a skip, never a guessed comparison.',
  evidence:
    '{ specifier, dependency, type } for a floating range, { specifier, resolved } for a desync (resolved is null when the lockfile has no record).',
  remediation:
    "Manual: pnpm pkg set '<section>.<name>=<version>' && pnpm install pins the version pnpm-lock.yaml records, because pnpm add --save-exact <name>@<range> is a measured no-op on pnpm 12.3.4 and keeps the range. With no recorded version the remediation resolves first: pnpm install --lockfile-only && funky-secure scan --only exact-versions. A desync is refreshed with pnpm install --lockfile-only. No auto fix, because rewriting a range without re-resolving is how a lockfile desync is created.",
  limits:
    'The rule resolves nothing: the command names the current specifier and pnpm writes the exact version. A specifier shape this rule does not recognize is not reported. An unsupported lockfile shape (lockfileVersion other than 9.0, catalogs, overrides, patchedDependencies) skips the comparison rather than guessing it. peerDependencies are compared like any other section, so a lockfile that does not record them reports a desync.',
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
          message: `skipped: ${read.detail}`,
          evidence: { reason: read.reason },
        };
      }
    }

    for (const importer of importers) {
      if (importer.json === null || typeof importer.json !== 'object') continue;
      inspected += 1;
      const path = importerPath(importer);

      for (const entry of collectSpecifiers(importer)) {
        if (typeof entry.specifier !== 'string') continue;
        const line = dependencyLine(importer.text, entry.type, entry.dependency);
        comparisons.push({ importer, path, line, entry });

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
            }),
          });
        }
      }
    }

    if (parsed !== null) {
      for (const { importer, path, line, entry } of comparisons) {
        const lock = parsed.importers[importer.dir];
        const recorded = lockfileSpecifier(lock, entry.dependency);
        if (recorded !== null && recorded === entry.specifier.trim()) continue;

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

    if (skip !== null) findings.push(skip);
    else if (inspected === 0) {
      // Nothing was read, so nothing was compared: "every specifier is exact" would be a claim this
      // rule never checked (RFC 7.3: a missing fact is a skip, never a pass).
      findings.push({
        status: 'skip',
        code: 'unreadable-package-json',
        message: `skipped: no importer package.json could be parsed, so no specifier was compared against pnpm-lock.yaml`,
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
