/**
 * R1 — `package-manager-pin` (RFC 8.2).
 *
 * Pure: every fact comes from the resolved context. The rule answers one question with one finding
 * and never touches the filesystem, the machine or the clock.
 */

import { manifestProblem } from '../lib/targets.js';
import { repoSkipMessage } from '../lib/scope.js';
import { findingsOf, planPackageManagerWrites, withholdsPinFor } from '../lib/writers.js';

const DOC = 'docs/rules/package-manager-pin.md';
const PATH = 'package.json';

/**
 * The `devEngines.packageManager` the manifest declares — the field npm enforces (0030) — as the two
 * keys it is measured by. Anything that is not an object declares no guard this rule can compare.
 *
 * @param {object} ctx resolved context
 * @returns {object|null} the guard, or `null` when the manifest declares none
 */
function declaredGuard(ctx) {
  const json = ctx.repo?.files?.packageJson?.json ?? null;
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  const engine = json.devEngines?.packageManager;
  if (engine === null || typeof engine !== 'object' || Array.isArray(engine)) return null;
  return engine;
}

/**
 * Whether the guard declares the pair the pin declares, compared by name **and** by version — the same
 * comparison W3b applies to the field it writes (`isGuardFor`, 11.2/0030).
 *
 * Only those two keys are compared: `onFail` is a key `pnpm init` writes, the tool never touches it,
 * and it makes no declaration equal or different. A guard that declares no `version` is not equal to a
 * pin that declares one, and a guard that names another manager is not equal to a pnpm pin.
 *
 * @param {object|null} guard the declared guard
 * @param {string} declared the `packageManager` string
 * @returns {boolean}
 */
function guardMatchesPin(guard, declared) {
  if (guard === null || typeof guard.name !== 'string') return false;
  if (typeof guard.version !== 'string') return false;
  return `${guard.name}@${guard.version}` === declared;
}

/**
 * The guard as the message names it: the pair when it declares both keys, the name when it declares no
 * version, because the sentence must not invent a version the manifest does not carry.
 *
 * @param {object} guard the declared guard
 * @returns {string}
 */
function guardLabel(guard) {
  if (typeof guard.name !== 'string') return 'a guard this rule cannot compare';
  return typeof guard.version === 'string' ? `${guard.name}@${guard.version}` : guard.name;
}

/**
 * Whether the declaration names another manager, which is answered before the guard is read (#104): a
 * guard does not make an npm repository a pnpm one, and the skip this rule used to print for that
 * state said the project "manages its own pnpm" — false on its face.
 *
 * @param {string} declared the `packageManager` string
 * @returns {boolean}
 */
function namesAnotherManager(declared) {
  return !declared.startsWith('pnpm@') && !namesPnpmWithoutVersion(declared);
}

/**
 * Whether the project also declares `devEngines.packageManager`, the field npm enforces (0030). Its
 * three states are decided by the pin branch below, and the field is measured by name and version
 * only: `onFail` is a key `pnpm init` writes, the tool never touches it, and it makes no declaration
 * equal or different.
 *
 * @param {object} ctx resolved context
 * @returns {boolean}
 */
function declaredPin(ctx) {
  const json = ctx.repo?.files?.packageJson?.json ?? null;
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  const value = json.packageManager;
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Whether the declaration names a versioned pnpm, which is the only shape where the repository is the
 * authority: pnpm re-executes itself to honour `packageManager`, so the version answering from the
 * project's own directory is the declared one (S9, 0024).
 * @param {string} declared
 * @returns {boolean}
 */
function isVersionedPnpm(declared) {
  return /^pnpm@\d+\.\d+\.\d+/.test(declared);
}

/**
 * The version a versioned declaration names, without the metadata it may carry after it: `pnpm` writes
 * its pins as `pnpm@12.3.4+sha512.…`, the version and the hash of the tarball, and `corepack use` writes
 * the same shape. The hash is a property of the declaration, so it is not a difference on the machine —
 * comparing the whole string made a pin this project's own remediation writes report
 * `pin-differs-from-machine` with a sentence claiming the machine answered another version, which it
 * did not.
 *
 * A pre-release is kept: `12.3.4-beta.1` is not `12.3.4`, and a machine answering the release does not
 * confirm a pin on the pre-release.
 *
 * @param {string} declared the `packageManager` string
 * @returns {string|null} the version it names, or `null` for a shape this rule cannot compare
 */
function declaredVersion(declared) {
  if (!isVersionedPnpm(declared)) return null;
  return declared.slice('pnpm@'.length).split('+')[0];
}

/**
 * Whether the declaration names pnpm and gives no version to verify (`"pnpm"`, `"pnpm@"`).
 *
 * This is not `pin-missing`: the field is present, and `writePackageManagerPin` refuses to replace a
 * declaration it finds, so the auto fix that `pin-missing` prints could never run here. It is not
 * `not-pnpm` either — a value that names pnpm is not evidence that the repository is on another
 * manager, and saying so printed "package.json declares pnpm, so this repository is not on pnpm"
 * (S5). There is simply no pin to compare, which is a skip, and `--require-verified` is the gate that
 * turns an unverified pin into a failing run.
 *
 * @param {string} declared
 * @returns {boolean}
 */
function namesPnpmWithoutVersion(declared) {
  return /^pnpm@?\s*$/.test(declared);
}

function readablePackageJson(ctx) {
  const file = ctx.repo?.files?.packageJson ?? null;
  if (file === null) return false;
  return file.json !== null && typeof file.json === 'object' && !Array.isArray(file.json);
}

export default {
  id: 'package-manager-pin',
  title: 'package.json declares the pnpm that answers',
  label: 'Package manager',
  scope: ['repo'],
  targets: ['repo-root'],
  friction: 0,
  severity: { baseline: 'error', strict: 'error' },
  question:
    'Does package.json declare the package manager, and does the declaration match the pnpm actually answering?',
  detection:
    'Reads packageManager from the root package.json. A versioned pnpm declaration is the authority: it passes, and the pnpm answering on the machine rides along as evidence rather than as a verdict, because pnpm re-executes itself to honour the declaration inside the project. An absent declaration fails with pin-missing; a declaration that names another manager is a skip (not-pnpm), since the pnpm question does not apply to it; a declaration that names pnpm and no version fails with its own code (pin-unversioned), because naming the manager and no version is the state pin-missing describes — there is no pin — while the declaration itself is kept and never rewritten, so the fix is manual; a pnpm declaration this rule cannot compare with the answering binary keeps pin-conflict. A devEngines.packageManager is read before the answering pnpm and compared with the pin by name and by version: one that names another manager or another version is a skip (self-managed-pin) whatever pnpm answers, including when the answering pnpm happens to equal the pin. Equal in both keys, with the answering pnpm matching it, is the pair the tool writes itself: the declarations agree and the machine agrees, so the pin is verified and not skipped. Equal in both keys and answered by another pnpm is the skip that stands, because the probe runs outside the project and its version describes the machine. A pin that names another manager is a skip (not-pnpm) before the guard is read, because a guard does not make that repository a pnpm one. An unavailable pnpm version is a skip (no-pnpm), never a wrong pin; a missing package.json is a skip (no-package-json), and a scope that excluded the repository is a skip (no-repo) with the exclusion named, because there the manifest was never looked for; a package.json that exists but cannot be interpreted is a failure (unparseable-package-json) that names the file and what is wrong with it, whatever the scope.',
  evidence: '{ declared, observed, executable }',
  remediation:
    'auto — funky-secure init --apply writes packageManager when it is missing, and only then; a pin that is already declared is never rewritten, whatever the machine runs.',
  limits:
    'Reads the two declarations of one file: packageManager and devEngines.packageManager. It deliberately does not read corepack state, does not resolve a version against a registry, does not inspect the lockfile and does not repair a conflicting pin. The field is a guard, not a wall: npm install --force downgrades the check to a warning, a machine-level pmOnFail or --pm-on-fail overrides it on the pnpm side, and only npm 11.13.0 and no yarn or bun were measured (0030).',
  docs: DOC,

  detect(ctx) {
    const observed = ctx.machine?.version ?? null;
    const executable = ctx.machine?.executable ?? null;
    // The probe that did not answer, from the machine facts and printed verbatim (#354): two states
    // leave the version unavailable — the resolution running out, and `pnpm --version` failing after it
    // answered — and naming the wrong one described a command nobody ran.
    const unansweredProbe = ctx.machine?.unansweredProbe ?? null;
    const declared = declaredPin(ctx);
    const evidence = { declared, observed, executable };

    // A manifest that exists and cannot be interpreted is not an absent manifest, and no machine fact
    // makes it readable (S4). The check comes before the machine ones because the observed defect was
    // `scan --scope repo`, where every machine check short-circuits to a skip and the run passed.
    const file = ctx.repo?.files?.packageJson ?? null;
    const problem = manifestProblem(file);
    if (problem !== null) {
      return [
        {
          status: 'fail',
          code: 'unparseable-package-json',
          path: PATH,
          message: `package.json ${problem.detail}, so the packageManager pin cannot be read`,
          evidence: { ...evidence, problem: problem.code },
          // Nothing is written to a file this rule could not read: `plan()` refuses it for the same
          // reason, so a remediation here would describe a write that cannot happen.
          remediation: { kind: 'none' },
        },
      ];
    }

    if (ctx.machine === null) {
      return [
        {
          status: 'skip',
          code: 'no-pnpm',
          path: PATH,
          // `--scope repo` excludes the machine by contract (RFC 7.2), so the skip names what was
          // not verified and the command that verifies it (S6).
          message:
            'skipped: the machine is out of scope, so the declared packageManager pin was not compared with the pnpm that answers; run funky-secure scan --scope all to verify it',
          evidence,
          remediation: { kind: 'none' },
        },
      ];
    }

    if (observed === null) {
      return [
        {
          status: 'skip',
          code: 'no-pnpm',
          path: PATH,
          message: `skipped: the probe "${unansweredProbe}" did not answer, so the pin cannot be verified`,
          evidence,
          remediation: { kind: 'none' },
          probeUnavailable: true,
        },
      ];
    }

    if (file === null) {
      // `file` is null for two different facts, and they send a reader in opposite directions: the
      // scope excluded the repository before anything was resolved, or the root resolved and carries
      // no manifest. Claiming the second when the first is true asserts an absence nobody measured
      // (#342), so both the sentence and the code follow the cause: `no-repo` means no repository
      // facts in this scope, and `no-package-json` is the rule's own measured absence (10.1, #398).
      const noRepositoryFacts = ctx.repo === null || ctx.repo === undefined;
      return [
        {
          status: 'skip',
          code: noRepositoryFacts ? 'no-repo' : 'no-package-json',
          path: PATH,
          message: noRepositoryFacts
            ? repoSkipMessage(ctx, 'the pin cannot be read')
            : 'skipped: the repository root has no package.json to read the pin from',
          evidence,
          remediation: { kind: 'none' },
        },
      ];
    }

    if (declared === null) {
      return [
        {
          status: 'fail',
          code: 'pin-missing',
          path: PATH,
          message: `package.json declares no packageManager; declare "packageManager": "pnpm@${observed}"`,
          evidence,
          // The `auto` is a promise the plan keeps (R1, #447). Where the writer refuses to write the pin
          // beside a guard it will not match, the finding names the edit instead of a command that
          // answers two conflicts and writes nothing.
          remediation: withholdsPinFor({ json: ctx.repo?.files?.packageJson?.json ?? null, version: observed })
            ? {
                kind: 'manual',
                command: `edit package.json by hand: set "packageManager": "pnpm@${observed}" and make devEngines.packageManager agree with it — the plan refuses to write the pin beside a guard it will not match`,
              }
            : { kind: 'auto', command: 'funky-secure init --apply' },
        },
      ];
    }

    if (namesAnotherManager(declared)) {
      return [
        {
          status: 'skip',
          code: 'not-pnpm',
          path: PATH,
          message: `skipped: package.json declares ${declared}, so the pnpm pin question does not apply to this manifest`,
          evidence,
          remediation: { kind: 'none' },
        },
      ];
    }

    // The guard is compared with the pin before the pin is compared with the answering pnpm (#104,
    // 0030), and it is compared by name and by version — the pair W3b writes — so a guard that differs
    // is the declared-and-different state whatever pnpm answers, including when the answering pnpm
    // happens to equal the pin: the pin is not the whole of what the project declares. A project that
    // declares its own pin re-executes with it, so the probe, which runs outside the repository (0019),
    // describes the machine and not the project (0020). No branch names
    // `corepack use pnpm@<machine version>`: rewriting a working project's pin to whatever the auditing
    // machine runs is the downgrade 0020 removed.
    const guard = declaredGuard(ctx);
    if (guard !== null && !guardMatchesPin(guard, declared)) {
      return [
        {
          status: 'skip',
          code: 'self-managed-pin',
          path: PATH,
          message: `package.json declares ${declared} and devEngines.packageManager declares ${guardLabel(guard)}, which is not the same pin, so the pnpm answering (pnpm@${observed}) does not describe this project; run pnpm --version inside the project to confirm the pin`,
          evidence,
          remediation: { kind: 'none' },
        },
      ];
    }

    if (declared !== `pnpm@${observed}`) {
      // Whether the declaration names the version this machine answered, ignoring the metadata the
      // declaration carries (`+sha512.…`): that is a fact about the pin, not about the machine.
      const version = declaredVersion(declared);
      const agreesWithMachine = version !== null && version === observed;

      if (guard !== null && !agreesWithMachine) {
        // The declarations agree and the machine does not: the skip stands for the reason above, since
        // the answering pnpm is still the machine's and not the project's (0020, 0030).
        return [
          {
            status: 'skip',
            code: 'self-managed-pin',
            path: PATH,
            message: `package.json declares ${declared} and devEngines.packageManager declares ${guardLabel(guard)}, which the pnpm answering (pnpm@${observed}) does not confirm; run pnpm --version inside the project to confirm the pin`,
            evidence,
            remediation: { kind: 'none' },
          },
        ];
      }

      if (agreesWithMachine) {
        // The declaration names the version that answered and differs from the machine's own answer
        // only in metadata it carries: the `+sha512.…` hash pnpm writes into a pin, which `corepack use`
        // also leaves there. There is no difference on the machine to report, so this is the ordinary
        // verified pass, and the sentence names the declaration it read instead of a difference that
        // is not one (S3, 0024).
        return [
          {
            status: 'pass',
            path: PATH,
            message: `package.json pins ${declared}, whose version ${observed} is the pnpm that answered; the rest of the declaration is the pin's own metadata, not a difference on this machine`,
            evidence,
            remediation: { kind: 'none' },
          },
        ];
      }

      if (isVersionedPnpm(declared)) {
        // A repository that declares a versioned pnpm is the authority for that question: pnpm
        // re-executes itself to honour `packageManager`, so from inside the project the answering
        // version is the declared one. The probe runs outside the repository (0019), which is why it
        // sees the PATH binary, and comparing the two says something about THIS MACHINE. Reporting it
        // as a violation made a correctly pinned repository fail and printed a remediation that would
        // rewrite a deliberate pin to whatever the auditor happens to run — measured on three real
        // repositories (shadcn-ui/ui pnpm@10.33.4, create-t3-app pnpm@10.8.0, primevue pnpm@9.6.0).
        // It is information, and it carries no remediation (0024, S9): the machine's own PATH version
        // rides along as evidence, because hiding it would leave a reader wondering why they differ.
        return [
          {
            status: 'pass',
            code: 'pin-differs-from-machine',
            path: PATH,
            message: `package.json declares ${declared}, which pnpm answers inside this project; the pnpm on this machine's PATH is pnpm@${observed}, and that difference describes the machine, not the repository`,
            evidence,
            remediation: { kind: 'none' },
          },
        ];
      }

      // A declaration that names pnpm and no version: the field is present and pins nothing, so there
      // is no pin to verify. It is its own case, and never the "not on pnpm" one (S5).
      if (namesPnpmWithoutVersion(declared)) {
        // A declaration that names the manager and no version is the state `pin-missing` describes:
        // there is no pin. It is a failure, not a skip — "there is no pin to verify" is the defect, not a
        // reason the question does not apply. The fix cannot be automatic, because `init --apply` never
        // rewrites a declaration it finds, so the remediation is manual and names the value to write.
        return [
          {
            status: 'fail',
            code: 'pin-unversioned',
            path: PATH,
            message: `package.json declares packageManager "${declared}", which names pnpm and no version, so no pin can be verified; declaring "packageManager": "pnpm@${observed}" makes it verifiable`,
            evidence,
            // A manual remediation is a command a human can run, not a description of an edit:
            // `pnpm pkg set` is the same verb the other manual routes name, and it keeps the JSON valid.
            remediation: {
              kind: 'manual',
              command: `pnpm pkg set packageManager="pnpm@${observed}"`,
            },
          },
        ];
      }

      // A declaration that is not a versioned pnpm: a shape this rule cannot compare. The pnpm question
      // does not apply to it, and the rules that need a pnpm repository already report the consequence
      // (lockfile-committed, foreign-lockfile).
      return [
        {
          status: 'fail',
          code: 'pin-conflict',
          path: PATH,
          message: `package.json declares ${declared}, which is not a version this rule can compare with the pnpm answering (pnpm@${observed})`,
          evidence,
          remediation: { kind: 'manual', command: `corepack use pnpm@${observed}` },
        },
      ];
    }

    return [
      {
        status: 'pass',
        path: PATH,
        message: `package.json pins pnpm@${observed}, the pnpm that answered`,
        evidence,
        remediation: { kind: 'none' },
      },
    ];
  },

  /**
   * RFC 8.2 fix `auto`: the guard the manifest does not declare (W3b), and the missing pin (W3) when the
   * rule failed. The finding comes from the same report the run renders, so the plan cannot describe a
   * different repository than the scan. The guard carries the version the pin establishes — the one W3
   * writes, or the one the manifest already declares — and a plan whose pin is a conflict plans none.
   *
   * @param {object} ctx resolved context
   * @param {{ report?: object }} [options]
   * @returns {Array<object>} plan items
   */
  plan(ctx, { report } = {}) {
    if (!ctx.repo || !ctx.machine) return [];
    const version = ctx.machine.version ?? null;
    if (version === null) return [];

    const declared = declaredPin(ctx);
    const failing =
      report === undefined
        ? readablePackageJson(ctx) && declared !== `pnpm@${version}`
        : findingsOf(report, this.id).some(
            (finding) =>
              finding.status === 'fail' &&
              (finding.code === 'pin-missing' || finding.code === 'pin-conflict'),
          );

    return planPackageManagerWrites(ctx, { version, pinFailing: failing });
  },
};
