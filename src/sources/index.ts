// Session sources: find session files on disk. Does not parse whole logs.
import { claudeCodeSource, AmbiguousSessionError } from './claude-code.js';

// Not imported from the model: a source imports node built-ins only (docs/plan.md).
type NonEmptyReadonly<T> = readonly [T, ...T[]];

export type SessionInfo = {
  /** File name without ".jsonl". */
  readonly id: string;
  /** Absolute path. */
  readonly path: string;
  /** Source id, for example "claude-code". */
  readonly source: string;
  /** The cwd from the log, else the project directory name. */
  readonly project: string;
  /** File mtime. */
  readonly modifiedAt: Date;
  /** Bytes. */
  readonly size: number;
  /** First user prompt, "" when none in the head. */
  readonly firstPrompt: string;
};

export type SessionSource = {
  readonly id: string;
  readonly name: string;
  /** The data directory of the harness. Reads `env` and `home`, never `process.env`. */
  readonly root: (env: Readonly<Record<string, string | undefined>>, home: string) => string;
  /** Newest first. A missing directory gives `[]`. */
  readonly list: (root: string, opts?: { readonly limit?: number }) => Promise<SessionInfo[]>;
  /** The path of the session with this ID or unique ID prefix, or `null`. */
  readonly resolve: (root: string, id: string) => Promise<string | null>;
};

/**
 * Invariant 10: at least one source. The compiler rejects an empty registry.
 * Claude Code first.
 */
export const sources: NonEmptyReadonly<SessionSource> = [claudeCodeSource];

export function getSource(id: string): SessionSource | undefined {
  return sources.find((s) => s.id === id);
}

// The class lives in claude-code.ts so that module can throw it without a
// circular run-time import; it is part of this module's public API.
export { AmbiguousSessionError };
