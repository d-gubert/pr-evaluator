// Claude Code sessions: <root>/projects/<project-dir>/<session-id>.jsonl
import { open, readdir, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { basename, join } from 'node:path';
import type { SessionInfo, SessionSource } from './index.js';

const SOURCE_ID = 'claude-code';
const HEAD_BYTES = 64 * 1024;
const MIN_PREFIX = 4;
const CONCURRENCY = 16;

/** A JSON object: not null, not an array. */
type Rec = { readonly [key: string]: unknown };
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

export class AmbiguousSessionError extends Error {
  readonly candidates: readonly string[];

  constructor(id: string, candidates: readonly string[]) {
    super(`session id "${id}" is ambiguous: ${candidates.length} matches\n  ${candidates.join('\n  ')}`);
    this.name = 'AmbiguousSessionError';
    this.candidates = candidates;
  }
}

/** Map over items with a bounded number of concurrent calls, keeping order. */
async function mapLimit<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  // All workers take from one iterator, so each item is mapped once.
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [i, item] of queue) out[i] = await fn(item);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

type SessionFile = { readonly id: string; readonly path: string; readonly projectDir: string };

/** Session files one level below <root>/projects. Missing directories give []. */
async function findFiles(root: string): Promise<SessionFile[]> {
  const projectsDir = join(root, 'projects');
  let projects: string[];
  try {
    projects = await readdir(projectsDir);
  } catch {
    return [];
  }
  const perProject = await mapLimit(projects, async (name): Promise<SessionFile[]> => {
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

/** First text of a user record's content, or "" when it is not a plain prompt. */
function promptText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const blocks: readonly unknown[] = content;
  if (blocks.some((b) => isRec(b) && b.type === 'tool_result')) return '';
  return blocks
    .filter((b): b is Rec & { readonly text: string } => isRec(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/** Read at most the first 64 KiB of a file and pick out cwd and first prompt. */
async function readHead(path: string, size: number): Promise<{ cwd: string; firstPrompt: string }> {
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
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRec(rec)) continue;
    if (!cwd && typeof rec.cwd === 'string' && rec.cwd) cwd = rec.cwd;
    if (!firstPrompt && rec.type === 'user' && !rec.isMeta && !rec.isSidechain) {
      const t = promptText(isRec(rec.message) ? rec.message.content : undefined).trim();
      if (t && !t.startsWith('<')) firstPrompt = t;
    }
    if (cwd && firstPrompt) break;
  }
  return { cwd, firstPrompt };
}

export const claudeCodeSource: SessionSource = {
  id: SOURCE_ID,
  name: 'Claude Code',

  root(env, home) {
    return env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : join(home, '.claude');
  },

  async list(root, opts = {}) {
    const files = await findFiles(root);
    const stats = (
      await mapLimit(files, async (f): Promise<(SessionFile & { readonly st: Stats }) | null> => {
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

    return mapLimit(picked, async (f): Promise<SessionInfo> => {
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
    if (exact.length > 1) throw new AmbiguousSessionError(id, exact.map((f) => f.path));
    if (exact[0]) return exact[0].path;
    if (id.length < MIN_PREFIX) return null;
    const hits = files.filter((f) => f.id.startsWith(id));
    if (hits.length > 1) throw new AmbiguousSessionError(id, hits.map((f) => f.path));
    return hits[0]?.path ?? null;
  },
};
