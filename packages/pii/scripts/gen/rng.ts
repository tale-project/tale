/**
 * Seeded RNG for deterministic fixture generation.
 *
 * `seedrandom` is the deterministic PRNG of choice — given the same seed
 * + same source data, regenerating produces byte-identical output. CI's
 * `fixtures:verify` job depends on this to detect drift.
 *
 * All randomness threads through a single `Rng` instance: builders pull
 * `pick`, `pickN`, `int`, `chance`. No builder ever calls `Math.random()`
 * directly — that would silently break determinism.
 */

import seedrandom from 'seedrandom';

export interface Rng {
  /** Uniform random in [0, 1). */
  next(): number;
  /** Uniform random integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Pick one element. Throws on empty input. */
  pick<T>(xs: readonly T[]): T;
  /** Pick `n` distinct elements (without replacement). Caps at `xs.length`. */
  pickN<T>(xs: readonly T[], n: number): T[];
  /** True with probability `p` (∈ [0, 1]). */
  chance(p: number): boolean;
}

export function makeRng(seed: number): Rng {
  // seedrandom returns a `() => number` PRNG; wrap to avoid leaking `Math.random`.
  const fn = seedrandom(String(seed));
  function next(): number {
    return fn();
  }
  function int(min: number, max: number): number {
    return Math.floor(next() * (max - min + 1)) + min;
  }
  function pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error('Rng.pick called on empty array');
    return xs[int(0, xs.length - 1)];
  }
  function pickN<T>(xs: readonly T[], n: number): T[] {
    const capped = Math.min(n, xs.length);
    // Fisher-Yates partial shuffle — O(capped) time, no full copy.
    const arr = [...xs];
    for (let i = 0; i < capped; i++) {
      const j = i + int(0, arr.length - 1 - i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, capped);
  }
  function chance(p: number): boolean {
    return next() < p;
  }
  return { next, int, pick, pickN, chance };
}
