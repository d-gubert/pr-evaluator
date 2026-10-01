// @ts-check
// Ask the user to pick one session. Knows SessionInfo only.

import { createInterface } from 'node:readline';
import { UsageError } from './args.js';

/** @typedef {import('../sources/index.js').SessionInfo} SessionInfo */

const MAX_TRIES = 3;

/**
 * Read one answer per line from `io.stdin` and write the prompt to `io.stderr`.
 * A number picks that session; an empty line picks 1; "q" or the end of input gives null.
 * @param {SessionInfo[]} sessions  at least one
 * @param {{stdin: NodeJS.ReadableStream, stderr: {write(s: string): unknown}}} io
 * @returns {Promise<SessionInfo | null>}
 * @throws {UsageError} after three wrong answers
 */
export async function pickSession(sessions, io) {
  const rl = createInterface({ input: io.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  try {
    for (let tries = 0; tries < MAX_TRIES; tries++) {
      io.stderr.write(`Session [1-${sessions.length}, Enter = 1, q = quit]: `);
      const { value, done } = await lines.next();
      if (done) {
        io.stderr.write('\n');
        return null;
      }
      const answer = String(value).trim();
      if (answer === '') return sessions[0];
      if (/^q(uit)?$/i.test(answer)) return null;
      if (/^\d+$/.test(answer)) {
        const n = Number(answer);
        if (n >= 1 && n <= sessions.length) return sessions[n - 1];
      }
      io.stderr.write(`"${answer}" is not a session number.\n`);
    }
    throw new UsageError('no valid session number');
  } finally {
    rl.close();
  }
}
