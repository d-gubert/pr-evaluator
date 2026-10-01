// Helpers for the JSON boundary of a format: a log line is `unknown` until a
// guard narrows it. Private to the format modules.

/** A JSON object: not null, not an array. */
export type Rec = { readonly [key: string]: unknown };

export const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The object, or an empty object. It lets a chain of reads end in `undefined` instead of an error. */
export const asRec = (x: unknown): Rec => (isRec(x) ? x : {});

/** The array, or an empty array. */
export const asArr = (x: unknown): readonly unknown[] => (Array.isArray(x) ? x : []);

/** The string, or `''`. */
export const str = (x: unknown): string => (typeof x === 'string' ? x : '');

export const isString = (x: unknown): x is string => typeof x === 'string';

/** A finite number, else 0. */
export const num0 = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
