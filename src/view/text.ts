// Private text helpers of the view layer.

export const MAX_LINE = 160;

/** A JSON object: not null, not an array. */
export const isRecord = (x: unknown): x is { readonly [key: string]: unknown } => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Collapse whitespace and cut to `n` characters. */
export const clip = (s: unknown, n: number = MAX_LINE): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

export const quote = (s: unknown, n: number = 100): string => JSON.stringify(clip(s, n));

export const num = (n: number | null | undefined): string => Number(n || 0).toLocaleString('en-US');

export const ktok = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));

export const plural = (n: number, one: string, many: string = one + 's'): string => `${n} ${n === 1 ? one : many}`;

export const times = (n: number): string => (n === 1 ? 'one time' : `${n} times`);

export function duration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !(ms >= 0)) return 'an unknown time';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function countNames(names: readonly string[]): string {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) || 0) + 1);
  return [...m].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ');
}
