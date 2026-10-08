/**
 * Small seeded PRNG (mulberry32). Every random choice in the audio code goes through one of these,
 * so offline renders in checks are reproducible while the live game still varies per session.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** 0 ≤ x < 1 */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Integer in [a, b] (both inclusive). */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }

  /** Index chosen with the given (non-negative) weights. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    let x = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      x -= Math.max(0, weights[i]);
      if (x < 0) return i;
    }
    return weights.length - 1;
  }

  /** Exponentially distributed interval with the given mean (Poisson process gaps). */
  exp(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }

  /** Independent child generator (so one subsystem's choices do not shift another's). */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}
