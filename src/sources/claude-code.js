// @ts-check
// Claude Code sessions: <root>/projects/<project-dir>/<session-id>.jsonl
import { open, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** @typedef {import('./index.js').SessionInfo} SessionInfo */
/** @typedef {import('./index.js').SessionSource} SessionSource */

const SOURCE_ID = 'claude-code';
const HEAD_BYTES = 64 * 1024;
const MIN_PREFIX = 4;
const CONCURRENCY = 16;

export class AmbiguousSessionError extends Error {
  /** @param {string} id @param {string[]} candidates */
  constructor(id, candidates) {
    super(`session id "${id}" is ambiguous: ${candidates.length} matches\n  ${candidates.join('\n  ')}`);
    this.name = 'AmbiguousSessionError';
    /** @type {string[]} */
    this.candidates = candidates;
  }
}

/**
 * Map over items with a bounded number of concurrent calls, keeping order.
 * @template T, R
 * @param {T[]} items
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, fn) {
  /** @type {R[]} */
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

/**
 * Session files one level below <root>/projects. Missing directories give [].
 * @param {string} root
 * @returns {Promise<{ id: string, path: string, projectDir: string }[]>}
 */
async function findFiles(root) {
  const projectsDir = join(root, 'projects');
  /** @type {string[]} */
  let projects;
  try {
    projects = await readdir(projectsDir);
  } catch {
    return [];
  }
  const perProject = await mapLimit(projects, async (name) => {
    const dir = join(projectsDir, name);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.jsonl'))
        .map((e) => ({ id: basename(e.name, '.jsonl'), path: join(dir, e.name), projectDir: name }));
    } catch {
      return []; // not a directory, or unreadable
    }
  });
  return perProject.flat();
}

/**
 * First text of a user record's content, or "" when it is not a plain prompt.
 * @param {unknown} content
 * @returns {string}
 */
function promptText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  if (content.some((b) => b && b.type === 'tool_result')) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Read at most the first 64 KiB of a file and pick out cwd and first prompt.
 * @param {string} path
 * @param {number} size
 * @returns {Promise<{ cwd: string, firstPrompt: string }>}
 */
async function readHead(path, size) {
  let text = '';
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, HEAD_BYTES));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    text = buf.toString('utf8', 0, bytesRead);
    // A cut-off last line is not a record; drop it. It would not parse anyway.
    if (size > bytesRead) text = text.slice(0, text.lastIndexOf('\n') + 1);
  } finally {
    await fh.close();
  }

  let cwd = '';
  let firstPrompt = '';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    /** @type {any} */
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== 'object') continue;
    if (!cwd && typeof rec.cwd === 'string' && rec.cwd) cwd = rec.cwd;
    if (!firstPrompt && rec.type === 'user' && !rec.isMeta && !rec.isSidechain) {
      const t = promptText(rec.message?.content).trim();
      if (t && !t.startsWith('<')) firstPrompt = t;
    }
    if (cwd && firstPrompt) break;
  }
  return { cwd, firstPrompt };
}

/** @type {SessionSource} */
export const claudeCodeSource = {
  id: SOURCE_ID,
  name: 'Claude Code',

  root(env, home) {
    return env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : join(home, '.claude');
  },

  async list(root, opts = {}) {
    const files = await findFiles(root);
    const stats = (
      await mapLimit(files, async (f) => {
        try {
          const st = await stat(f.path);
          return st.isFile() ? { ...f, st } : null;
        } catch {
          return null; // vanished or unreadable
        }
      })
    ).filter((x) => x !== null);
    stats.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    const picked = opts.limit === undefined ? stats : stats.slice(0, Math.max(0, opts.limit));

    return mapLimit(picked, async (f) => {
      /** @type {{ cwd: string, firstPrompt: string }} */
      let head = { cwd: '', firstPrompt: '' };
      try {
        head = await readHead(f.path, f.st.size);
      } catch {
        // unreadable file: list it without details
      }
      return {
        id: f.id,
        path: f.path,
        source: SOURCE_ID,
        project: head.cwd || f.projectDir,
        modifiedAt: f.st.mtime,
        size: f.st.size,
        firstPrompt: head.firstPrompt,
      };
    });
  },

  async resolve(root, id) {
    const files = await findFiles(root);
    const exact = files.filter((f) => f.id === id);
    if (exact.length === 1) return exact[0].path;
    if (exact.length > 1) throw new AmbiguousSessionError(id, exact.map((f) => f.path));
    if (id.length < MIN_PREFIX) return null;
    const hits = files.filter((f) => f.id.startsWith(id));
    if (hits.length === 1) return hits[0].path;
    if (hits.length > 1) throw new AmbiguousSessionError(id, hits.map((f) => f.path));
    return null;
  },
};
