// Format registry. To add a format, write one module that exports a `Format`
// and add it to the `formats` tuple. Nothing else changes.

import type { NonEmptyReadonly, Session } from '../model.js';
import { claudeCode } from './claude-code.js';

/** What `detect` gets: the path and the start of the file. */
export type FormatSample = {
  readonly path: string;
  /** The first 64 KiB (or less) of the file. */
  readonly head: string;
};

export type ParseOptions = {
  /** Base name of the log file. */
  readonly file: string;
};

export type Format = {
  /** For example "claude-code". It is what `-f, --format` takes. */
  readonly id: string;
  /** For example "Claude Code". */
  readonly name: string;
  /** Must be fast and must not throw. `true` only when the file is surely this format. */
  readonly detect: (sample: FormatSample) => boolean;
  /** Gets the whole file as text. Must not read the disk. */
  readonly parse: (text: string, opts: ParseOptions) => Session;
};

const HEAD_SIZE = 64 * 1024;

/** Invariant 10: at least one format. The compiler rejects an empty registry. */
export const formats: NonEmptyReadonly<Format> = [claudeCode];

export function getFormat(id: string): Format | undefined {
  return formats.find((f) => f.id === id);
}

/** The first format whose `detect` is true. */
export function detectFormat(sample: FormatSample): Format | undefined {
  return formats.find((f) => f.detect(sample));
}

export class UnknownFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownFormatError';
  }
}

/**
 * Parse the text of a log file. Uses `opts.format` when given, else detects the format.
 * @throws {UnknownFormatError} when no format matches, or `opts.format` is not a known id.
 */
export function parseSession(text: string, opts: ParseOptions & { readonly format?: string | undefined }): Session {
  let format: Format | undefined;
  if (opts.format !== undefined) {
    format = getFormat(opts.format);
    if (!format) throw new UnknownFormatError(`unknown format "${opts.format}"`);
  } else {
    format = detectFormat({ path: opts.file, head: text.slice(0, HEAD_SIZE) });
    if (!format) throw new UnknownFormatError(`no known format matches ${opts.file || 'the log'}`);
  }
  return format.parse(text, { file: opts.file });
}
