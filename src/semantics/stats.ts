/* Allocation-free, stack-safe aggregates. Math.max(...arr) throws RangeError past ~65k elements,
   and these arrays now reach 210k rows, so nothing in the app may spread an array into Math. */

export function maxOf(values: ArrayLike<number>, seed = -Infinity): number {
  let m = seed;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (v > m) m = v; }
  return m;
}
export function minOf(values: ArrayLike<number>, seed = Infinity): number {
  let m = seed;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (v < m) m = v; }
  return m;
}
export function extent(values: ArrayLike<number>): [number, number] {
  let lo = Infinity; let hi = -Infinity;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}
/** max of f(x) over a collection, skipping null/undefined/NaN. */
export function maxBy<T>(items: Iterable<T>, f: (x: T) => number | null | undefined, seed = -Infinity): number {
  let m = seed;
  for (const it of items) { const v = f(it); if (v !== null && v !== undefined && Number.isFinite(v) && v > m) m = v; }
  return m;
}
export function minBy<T>(items: Iterable<T>, f: (x: T) => number | null | undefined, seed = Infinity): number {
  let m = seed;
  for (const it of items) { const v = f(it); if (v !== null && v !== undefined && Number.isFinite(v) && v < m) m = v; }
  return m;
}
export function sumBy<T>(items: Iterable<T>, f: (x: T) => number | null | undefined): number {
  let s = 0;
  for (const it of items) { const v = f(it); if (v !== null && v !== undefined && Number.isFinite(v)) s += v; }
  return s;
}
/** Distinct count without materialising a Set of every cell value twice. */
export function distinctCount<T>(items: Iterable<T>, f: (x: T) => unknown): number {
  const s = new Set<unknown>();
  for (const it of items) { const v = f(it); if (v !== null && v !== undefined && v !== '') s.add(v); }
  return s.size;
}
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
