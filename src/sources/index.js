// @ts-check
// Session sources: find session files on disk. Does not parse whole logs.
import { claudeCodeSource, AmbiguousSessionError } from './claude-code.js';

/**
 * @typedef {object} SessionInfo
 * @property {string} id          file name without ".jsonl"
 * @property {string} path        absolute path
 * @property {string} source      source id, e.g. "claude-code"
 * @property {string} project     cwd from the log, else the project directory name
 * @property {Date}   modifiedAt  file mtime
 * @property {number} size        bytes
 * @property {string} firstPrompt first user prompt, "" when none in the head
 */

/**
 * @typedef {object} SessionSource
 * @property {string} id
 * @property {string} name
 * @property {(env: Record<string, string | undefined>, home: string) => string} root
 * @property {(root: string, opts?: { limit?: number }) => Promise<SessionInfo[]>} list
 * @property {(root: string, id: string) => Promise<string | null>} resolve
 */

/** @type {SessionSource[]} Claude Code first. */
export const sources = [claudeCodeSource];

/**
 * @param {string} id
 * @returns {SessionSource | undefined}
 */
export function getSource(id) {
  return sources.find((s) => s.id === id);
}

// The class lives in claude-code.js so that module can throw it without a
// circular runtime import; it is part of this module's public API.
export { AmbiguousSessionError };
