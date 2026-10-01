// The golden files, read and typed.
import { readFileSync } from 'node:fs';
import type { Session } from '../../src/model.js';
import { decodeSession } from './decode.js';
import { GOLDEN_SESSION, GOLDEN_STEPS } from './paths.js';

/** The golden Session, checked against the model by the decoder. */
export function readGoldenSession(): Session {
  return decodeSession(JSON.parse(readFileSync(GOLDEN_SESSION, 'utf8')));
}

/** The golden steps, as read from the file. */
export function readGoldenSteps(): unknown {
  return JSON.parse(readFileSync(GOLDEN_STEPS, 'utf8'));
}
