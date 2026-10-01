// @ts-check
// The CLI: argv + io → exit code. The only module that joins sources, formats, view and render.

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { formats, getFormat, parseSession, UnknownFormatError } from '../formats/index.js';
import { sources, AmbiguousSessionError } from '../sources/index.js';
import { toView } from '../view/steps.js';
import { renderHtml } from '../render/html.js';
import { parseArgs, helpText, UsageError } from './args.js';
import { formatSessionList } from './list.js';
import { pickSession } from './pick.js';

/** @typedef {import('../sources/index.js').SessionInfo} SessionInfo */
/** @typedef {import('./args.js').Args} Args */

/**
 * @typedef {object} IO
 * @property {Record<string, string | undefined>} env
 * @property {string} home
 * @property {string} cwd
 * @property {NodeJS.ReadableStream} stdin
 * @property {{write(s: string): unknown}} stdout
 * @property {{write(s: string): unknown}} stderr
 * @property {boolean} interactive  stdin and stderr are a terminal
 * @property {number} [columns]     terminal width, when known
 */

const NAME = 'session-trace';
const EXIT_INTERRUPTED = 130;

/**
 * @param {string[]} argv  the arguments after the script name
 * @param {IO} io
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      io.stdout.write(helpText(formats.map((f) => f.id)));
      return 0;
    }
    if (args.version) {
      io.stdout.write(version() + '\n');
      return 0;
    }
    if (args.format !== undefined && !getFormat(args.format)) {
      throw new UsageError(`unknown format "${args.format}" (known: ${formats.map((f) => f.id).join(', ')})`);
    }
    return await execute(args, io);
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr.write(`${NAME}: ${e.message}\nTry "${NAME} --help".\n`);
      return 2;
    }
    io.stderr.write(`${NAME}: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

function version() {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  return String(pkg.version);
}

/** @param {string} path */
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} arg
 * @param {IO} io
 * @returns {Promise<string | null>} absolute path of the session file
 */
async function findSession(arg, io) {
  const direct = resolve(io.cwd, arg);
  if (isFile(direct)) return direct;
  for (const source of sources) {
    const hit = await source.resolve(source.root(io.env, io.home), arg);
    if (hit) return hit;
  }
  return null;
}

/** All sessions of all sources, newest first. @param {IO} io @param {number} limit */
async function listSessions(io, limit) {
  const all = [];
  for (const source of sources) all.push(...(await source.list(source.root(io.env, io.home), { limit })));
  return all.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()).slice(0, limit);
}

/** @param {IO} io */
const projectsDirs = (io) => sources.map((s) => join(s.root(io.env, io.home), 'projects')).join(', ');

/**
 * @param {Args} args
 * @param {IO} io
 * @returns {Promise<number>}
 */
async function execute(args, io) {
  let file;
  if (args.session !== undefined) {
    file = await findSession(args.session, io);
    if (!file) {
      io.stderr.write(`${NAME}: no session file or ID "${args.session}"\n`);
      return 1;
    }
  } else {
    const sessions = await listSessions(io, args.limit);
    if (!sessions.length) {
      io.stderr.write(`${NAME}: no sessions in ${projectsDirs(io)}\n`);
      return 1;
    }
    const table = formatSessionList(sessions, { columns: io.columns });
    if (args.list) {
      io.stdout.write(table);
      return 0;
    }
    if (!io.interactive) {
      io.stdout.write(table);
      io.stderr.write(`${NAME}: pass a session path or ID\n`);
      return 2;
    }
    io.stderr.write(table);
    const picked = await pickSession(sessions, io);
    if (!picked) return EXIT_INTERRUPTED;
    file = picked.path;
  }
  return trace(file, args, io);
}

/**
 * @param {string} file  absolute path of the session log
 * @param {Args} args
 * @param {IO} io
 * @returns {Promise<number>}
 */
async function trace(file, args, io) {
  const text = readFileSync(file, 'utf8');
  /** @type {import('../view/steps.js').View} */
  let view;
  try {
    view = toView(parseSession(text, { file: basename(file), format: args.format }));
  } catch (e) {
    if (e instanceof UnknownFormatError) {
      io.stderr.write(`${NAME}: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
  const html = renderHtml(view);

  if (args.stdout) {
    io.stdout.write(html);
    return 0;
  }
  const out = args.output !== undefined ? resolve(io.cwd, args.output) : join(io.cwd, `${basename(file, '.jsonl')}.trace.html`);
  writeFileSync(out, html);
  io.stderr.write(`${file}\n→ ${out}  (${view.steps.length} steps, ${view.meta.turns} loop turns)\n`);
  return 0;
}
