/**
 * Deterministic randomness for level building and dressing. Pure (no three.js).
 * Everything that varies by `mood.seed` must go through here so a level always looks the same.
 */

/** 32-bit integer hash of several numbers (order matters). */
export function hashInts(...values: number[]): number {
  let h = 0x811c9dc5 ^ values.length;
  for (const v of values) {
    let k = Math.floor(v * 1000) | 0; // fractional tile coords stay distinct
    k = Math.imul(k ^ (k >>> 16), 0x7feb352d);
    k = Math.imul(k ^ (k >>> 15), 0x846ca68b);
    k ^= k >>> 16;
    h = Math.imul(h ^ k, 0x01000193);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic number in [0, 1) from several numbers. */
export function rand01(...values: number[]): number {
  return hashInts(...values) / 4294967296;
}

/** Small seeded PRNG (mulberry32) with helpers. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = hashInts(seed) || 1;
  }

  /** A child generator for an independent stream (e.g. one per building). */
  fork(...salt: number[]): Rng {
    return new Rng(hashInts(this.s, ...salt));
  }

  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }

  /** Weighted pick: `[[item, weight], ...]`. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of items) total += Math.max(0, w);
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= Math.max(0, w);
      if (r < 0) return item;
    }
    return items[items.length - 1][0];
  }
}
