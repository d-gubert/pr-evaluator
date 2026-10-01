// @ts-check
// Format registry. To add a format, write one module that exports a `Format`
// and add it to the `formats` array. Nothing else changes.

import { claudeCode } from './claude-code.js';

/** @typedef {import('../model.js').Session} Session */

/**
 * @typedef {object} Format
 * @property {string} id                       e.g. "claude-code"
 * @property {string} name                     e.g. "Claude Code"
 * @property {(sample: {path: string, head: string}) => boolean} detect
 *           `head` is the first 64 KiB (or less) of the file.
 * @property {(text: string, opts: {file: string}) => Session} parse
 */

const HEAD_SIZE = 64 * 1024;

/** @type {Format[]} */
export const formats = [claudeCode];

/** @param {string} id @returns {Format|undefined} */
export function getFormat(id) {
  return formats.find(f => f.id === id);
}

/** @param {{path: string, head: string}} sample @returns {Format|undefined} First match. */
export function detectFormat(sample) {
  return formats.find(f => f.detect(sample));
}

export class UnknownFormatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'UnknownFormatError';
  }
}

/**
 * Parse the text of a log file. Uses `opts.format` when given, else detects the format.
 * @param {string} text
 * @param {{file: string, format?: string}} opts
 * @returns {Session}
 * @throws {UnknownFormatError} when no format matches, or `opts.format` is not a known id.
 */
export function parseSession(text, opts) {
  let format;
  if (opts.format !== undefined) {
    format = getFormat(opts.format);
    if (!format) throw new UnknownFormatError(`unknown format "${opts.format}"`);
  } else {
    format = detectFormat({ path: opts.file, head: text.slice(0, HEAD_SIZE) });
    if (!format) throw new UnknownFormatError(`no known format matches ${opts.file || 'the log'}`);
  }
  return format.parse(text, { file: opts.file });
}
