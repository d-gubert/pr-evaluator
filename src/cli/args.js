// @ts-check
// Command-line parsing. Knows no other module.

/**
 * @typedef {object} Args
 * @property {string | undefined} session  path, session ID, or ID prefix
 * @property {string | undefined} output   value of -o
 * @property {boolean} stdout
 * @property {string | undefined} format   format id
 * @property {boolean} list
 * @property {number} limit
 * @property {boolean} help
 * @property {boolean} version
 */

export const DEFAULT_LIMIT = 20;

export class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** @type {Record<string, string>} */
const LONG = {
  '--output': 'output',
  '--stdout': 'stdout',
  '--format': 'format',
  '--list': 'list',
  '--limit': 'limit',
  '--help': 'help',
  '--version': 'version',
};
/** @type {Record<string, string>} */
const SHORT = { '-o': 'output', '-f': 'format', '-l': 'list', '-n': 'limit', '-h': 'help', '-v': 'version' };
const TAKES_VALUE = new Set(['output', 'format', 'limit']);
const FLAG_NAME = { output: '--output', format: '--format', limit: '--limit' };

/**
 * @param {string[]} argv  the arguments after the script name
 * @returns {Args}
 * @throws {UsageError}
 */
export function parseArgs(argv) {
  /** @type {Args} */
  const args = { session: undefined, output: undefined, stdout: false, format: undefined, list: false, limit: DEFAULT_LIMIT, help: false, version: false };
  let optionsEnded = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (optionsEnded || arg === '-' || !arg.startsWith('-')) {
      if (args.session !== undefined) throw new UsageError(`unexpected argument "${arg}"`);
      args.session = arg;
      continue;
    }
    if (arg === '--') {
      optionsEnded = true;
      continue;
    }

    let flag = arg;
    /** @type {string | undefined} */
    let inline;
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    if (eq > 0) {
      flag = arg.slice(0, eq);
      inline = arg.slice(eq + 1);
    }
    const name = LONG[flag] ?? SHORT[flag];
    if (!name) throw new UsageError(`unknown option "${flag}"`);

    if (!TAKES_VALUE.has(name)) {
      if (inline !== undefined) throw new UsageError(`option ${flag} takes no value`);
      // @ts-ignore name is one of the boolean keys here
      args[name] = true;
      continue;
    }

    let value = inline;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && next !== '-')) throw new UsageError(`option ${flag} needs a value`);
      value = next;
      i++;
    }
    if (name === 'limit') {
      if (!/^[1-9]\d*$/.test(value)) throw new UsageError(`invalid number for ${flag}: "${value}"`);
      args.limit = Number(value);
    } else if (name === 'output' || name === 'format') {
      args[name] = value;
    }
  }

  if (args.output !== undefined && args.stdout) throw new UsageError('-o/--output and --stdout cannot be used together');
  if (args.list && (args.session !== undefined || args.output !== undefined || args.stdout)) {
    throw new UsageError('--list cannot be used with a session, -o/--output, or --stdout');
  }
  return args;
}

/** @param {string[]} formatIds @returns {string} */
export function helpText(formatIds) {
  return `usage: session-trace [options] [session]

  session            path to a session log, or a session ID (or a unique ID prefix)
  -o, --output FILE  write the page to FILE
      --stdout       write the page to stdout
  -f, --format ID    log format; default: detect (${formatIds.join(', ')})
  -l, --list         list the sessions and exit
  -n, --limit N      number of sessions in the list (default ${DEFAULT_LIMIT})
  -h, --help         show this help
  -v, --version      show the version
`;
}
