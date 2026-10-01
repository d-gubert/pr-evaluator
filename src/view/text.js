// @ts-check
// Private text helpers of the view layer.

export const MAX_LINE = 160;

/** Collapse whitespace and cut to `n` characters.
 * @param {unknown} s
 * @param {number} [n]
 */
export const clip = (s, n = MAX_LINE) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** @param {unknown} s @param {number} [n] */
export const quote = (s, n = 100) => JSON.stringify(clip(s, n));

/** @param {number|null|undefined} n */
export const num = n => Number(n || 0).toLocaleString('en-US');

/** @param {number} n */
export const ktok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));

/** @param {number} n @param {string} one @param {string} [many] */
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** @param {number} n */
export const times = n => (n === 1 ? 'one time' : `${n} times`);

/** @param {number|null|undefined} ms */
export function duration(ms) {
  if (typeof ms !== 'number' || !(ms >= 0)) return 'an unknown time';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** @param {string[]} names */
export function countNames(names) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const n of names) m.set(n, (m.get(n) || 0) + 1);
  return [...m].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ');
}
