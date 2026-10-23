/**
 * The command line: one argv parser, four commands, one exit-code contract (RFC 10.4, 11, 13).
 *
 * Nothing here reads the repository or runs a probe. `--help` renders the static contract from
 * `COMMANDS`, `FLAGS` and the catalog, so two machines always see the same text (13.3).
 */

import { UsageError } from './lib/errors.js';
import { TOOL } from './lib/tool.js';
import { run as explain } from './commands/explain.js';
import { run as init } from './commands/init.js';
import { run as migrate } from './commands/migrate.js';
import { run as scan } from './commands/scan.js';
import { catalog as defaultCatalog } from './rules/index.js';

/** Commands in help order (RFC 11, 13.1). */
export const COMMANDS = Object.freeze([
  { name: 'scan', summary: 'Read-only audit: report findings and the verdict. Exits 0, 1 or 2.' },
  { name: 'init', summary: 'Print the write plan; --apply performs it.' },
  { name: 'migrate', summary: 'Print the five-step plan for leaving npm or yarn; --apply is F3.' },
  { name: 'explain', summary: 'Explain one rule in depth, or list the catalog with --list.' },
]);

/**
 * The closed flag list (RFC 11). `commands` is the applicability contract: a flag outside its list
 * is a usage error, never a silently ignored argument.
 */
export const FLAGS = Object.freeze([
  { name: '--help', key: 'help', commands: ['scan', 'init', 'migrate', 'explain'], boolean: true },
  { name: '--scope', key: 'scope', commands: ['scan'], values: ['auto', 'repo', 'machine', 'all'] },
  { name: '--preset', key: 'preset', commands: ['scan', 'init'], values: ['baseline', 'strict'] },
  {
    name: '--format',
    key: 'format',
    commands: ['scan', 'init', 'explain'],
    values: ['human', 'json'],
  },
  {
    name: '--fail-on',
    key: 'failOn',
    commands: ['scan'],
    values: ['error', 'warn', 'info', 'none'],
  },
  { name: '--only', key: 'only', commands: ['scan'], list: true, values: null },
  { name: '--ignore', key: 'ignore', commands: ['scan'], list: true, values: null },
  { name: '--strict-probes', key: 'strictProbes', commands: ['scan'], boolean: true },
  { name: '--with-timestamp', key: 'withTimestamp', commands: ['scan'], boolean: true },
  { name: '--apply', key: 'apply', commands: ['init', 'migrate'], boolean: true },
  { name: '--allow-dirty', key: 'allowDirty', commands: ['init', 'migrate'], boolean: true },
  { name: '--from', key: 'from', commands: ['migrate'], values: ['npm', 'yarn', 'auto'] },
  { name: '--list', key: 'list', commands: ['explain'], boolean: true },
]);

const DEFAULT_VALUES = Object.freeze({
  scope: 'auto',
  format: 'human',
  failOn: 'error',
  from: 'auto',
});

const COMMAND_NAMES = COMMANDS.map((command) => command.name);
const FLAG_BY_NAME = new Map(FLAGS.map((flag) => [flag.name, flag]));

const HANDLERS = { scan, init, migrate, explain };

function defaultsFor(command) {
  const options = {};
  for (const [key, value] of Object.entries(DEFAULT_VALUES)) {
    const flag = FLAGS.find((candidate) => candidate.key === key);
    if (flag !== undefined && flag.commands.includes(command)) options[key] = value;
  }
  return options;
}

function acceptedValues(flag) {
  return flag.values === null || flag.values === undefined ? '' : ` (one of ${flag.values.join(', ')})`;
}

/**
 * Parses argv into a command, its options and its positionals. Every rejection is a `UsageError`;
 * the run loop maps it to exit 2.
 *
 * @param {string[]} argv
 * @returns {{ command: string | null, options: Record<string, unknown>, positionals: string[] }}
 */
export function parseArgs(argv) {
  let command = null;
  const positionals = [];
  const options = {};
  const used = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== 'string') {
      throw new UsageError(`arguments must be strings (got ${typeof token})`);
    }

    if (!token.startsWith('--')) {
      if (command === null) command = token;
      else positionals.push(token);
      continue;
    }

    const equals = token.indexOf('=');
    const name = equals === -1 ? token : token.slice(0, equals);
    const inline = equals === -1 ? null : token.slice(equals + 1);
    const flag = FLAG_BY_NAME.get(name);
    if (flag === undefined) {
      throw new UsageError(`unknown flag "${name}"`);
    }
    used.push(flag);

    if (flag.boolean === true) {
      if (inline !== null) {
        throw new UsageError(`${flag.name} takes no value (got "${inline}")`);
      }
      options[flag.key] = true;
      continue;
    }

    let value = inline;
    if (value === null) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new UsageError(`${flag.name} needs a value${acceptedValues(flag)}`);
      }
      value = next;
      index += 1;
    }

    if (flag.values !== null && flag.values !== undefined && !flag.values.includes(value)) {
      throw new UsageError(`${flag.name} must be one of ${flag.values.join(', ')} (got "${value}")`);
    }

    if (flag.list === true) {
      const ids = value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '');
      if (ids.length === 0) {
        throw new UsageError(`${flag.name} needs at least one rule id`);
      }
      options[flag.key] = [...(options[flag.key] ?? []), ...ids];
    } else {
      options[flag.key] = value;
    }
  }

  if (command !== null && !COMMAND_NAMES.includes(command)) {
    throw new UsageError(`unknown command "${command}" (expected ${COMMAND_NAMES.join(', ')})`);
  }

  for (const flag of used) {
    if (command === null) break;
    if (!flag.commands.includes(command)) {
      throw new UsageError(
        `${flag.name} is not accepted by ${command} (accepted by ${flag.commands.join(', ')})`,
      );
    }
  }

  if (command !== null && command !== 'explain' && positionals.length > 0) {
    throw new UsageError(
      `unexpected argument "${positionals[0]}" (${command} takes no positional arguments)`,
    );
  }

  return {
    command,
    options: command === null ? options : { ...defaultsFor(command), ...options },
    positionals,
  };
}

function ruleSeverity(rule) {
  return {
    baseline: rule.severity?.baseline ?? 'warn',
    strict: rule.severity?.strict ?? 'warn',
  };
}

/**
 * The static help text (RFC 13.1, 13.3): product, usage, commands, flags and the catalog. It reads
 * no file and runs no probe.
 * @param {{ catalog?: Array<object> }} [options]
 * @returns {string}
 */
export function renderHelp({ catalog = defaultCatalog } = {}) {
  const lines = [
    `${TOOL.name} ${TOOL.version} — supply-chain auditor and initializer for pnpm repositories`,
    '',
    'usage: funky-secure <command> [options]',
    '       funky-secure --help',
    '',
    'commands',
  ];

  const commandWidth = Math.max(...COMMANDS.map((command) => command.name.length));
  for (const command of COMMANDS) {
    lines.push(`  ${command.name.padEnd(commandWidth)}  ${command.summary}`);
  }

  const labels = FLAGS.map((flag) => {
    if (flag.boolean === true) return flag.name;
    if (flag.list === true) return `${flag.name} <ids>`;
    return `${flag.name} <${flag.values.join('|')}>`;
  });
  const labelWidth = Math.max(...labels.map((label) => label.length));
  const appliesWidth = Math.max(
    ...FLAGS.map((flag) =>
      (flag.commands.length === COMMANDS.length ? 'all commands' : flag.commands.join(', ')).length,
    ),
  );

  lines.push('', 'flags');
  FLAGS.forEach((flag, index) => {
    const applies = flag.commands.length === COMMANDS.length ? 'all commands' : flag.commands.join(', ');
    const fallback = Object.hasOwn(DEFAULT_VALUES, flag.key) ? `   default: ${DEFAULT_VALUES[flag.key]}` : '';
    lines.push(`  ${labels[index].padEnd(labelWidth)}  ${applies.padEnd(appliesWidth)}${fallback}`.trimEnd());
  });

  lines.push('', 'rules');
  if (catalog.length === 0) {
    lines.push('  (none registered yet)');
  } else {
    const idWidth = Math.max(...catalog.map((rule) => rule.id.length));
    const severityWidth = Math.max(
      ...catalog.map((rule) => {
        const { baseline, strict } = ruleSeverity(rule);
        return `${baseline}/${strict}`.length;
      }),
    );
    for (const rule of catalog) {
      const { baseline, strict } = ruleSeverity(rule);
      lines.push(
        `  ${rule.id.padEnd(idWidth)}  ${`${baseline}/${strict}`.padEnd(severityWidth)}  ${rule.title ?? ''}`,
      );
    }
  }

  lines.push(
    '',
    'exit codes: 0 nothing at or above --fail-on · 1 a policy violation · 2 the tool could not answer',
    '',
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Runs one command (RFC 10.4): `UsageError` and `ConfigError` become exit 2 with one
 * `funky-secure:` line on stderr, any other error fails closed the same way, and no stack trace is
 * ever written to stdout.
 *
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: object, stdout?: object, stderr?: object, collector?: object, catalog?: Array<object> }} [io]
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const catalog = io.catalog ?? defaultCatalog;

  try {
    const { command, options, positionals } = parseArgs(argv);
    if (command === null || options.help === true) {
      stdout.write(renderHelp({ catalog }));
      return 0;
    }

    return await HANDLERS[command]({
      ...options,
      cwd,
      env,
      stdout,
      stderr,
      catalog,
      positionals,
      collector: io.collector,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`funky-secure: ${message}\n`);
    return 2;
  }
}
