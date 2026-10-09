/**
 * Seeded randomness for the mock provider.
 *
 * Every sampled quantity (time to first token, token rate, reply length,
 * faults) draws from a `Random`, so a run with a fixed seed is replayable:
 * the same requests in the same order meet the same latencies and the same
 * faults. The generator is sfc32 (fast, 128-bit state, passes PractRand far
 * beyond what a load test draws), seeded through splitmix32 so that nearby
 * seeds still give unrelated streams.
 */

/** A uniform draw in `[0, 1)`. */
export type Random = () => number;

/** z-score of the 95th percentile of the standard normal distribution. */
const Z95 = 1.6448536269514722;

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** sfc32 over four 32-bit words of state. */
export function createRandomFromWords(
  a: number,
  b: number,
  c: number,
  d: number,
): Random {
  let s0 = a | 0;
  let s1 = b | 0;
  let s2 = c | 0;
  let s3 = d | 0;
  const next: Random = () => {
    const t = (((s0 + s1) | 0) + s3) | 0;
    s3 = (s3 + 1) | 0;
    s0 = s1 ^ (s1 >>> 9);
    s1 = (s2 + (s2 << 3)) | 0;
    s2 = (s2 << 21) | (s2 >>> 11);
    s2 = (s2 + t) | 0;
    return (t >>> 0) / 4_294_967_296;
  };
  // The first outputs of a freshly seeded sfc32 still echo the seed.
  for (let i = 0; i < 12; i++) next();
  return next;
}

/** A generator seeded from one integer. */
export function createRandom(seed: number): Random {
  const words = splitmix32(seed);
  return createRandomFromWords(words(), words(), words(), words());
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** A standard-normal draw scaled to `mean` and `sd` (Box-Muller). */
export function normal(random: Random, mean: number, sd: number): number {
  const u1 = 1 - random();
  const u2 = random();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * A lognormal draw described the way latency is usually quoted: by its
 * median and its 95th percentile. A p95 at or below the median collapses
 * the distribution onto the median.
 */
export function lognormalFromMedianP95(
  random: Random,
  median: number,
  p95: number,
): number {
  if (median <= 0) return 0;
  const sigma = p95 > median ? Math.log(p95 / median) / Z95 : 0;
  return Math.exp(normal(random, Math.log(median), sigma));
}

/** An integer in `[min, max]`, both inclusive. */
export function randomInt(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** One element of a non-empty list. */
export function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick() needs a non-empty list');
  return item;
}

/** True with probability `probability`. */
export function chance(random: Random, probability: number): boolean {
  return probability > 0 && random() < probability;
}

const ID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A base62 identifier of `length` characters, the shape provider ids take. */
export function randomId(random: Random, length: number): string {
  let id = '';
  for (let i = 0; i < length; i++) {
    id += ID_ALPHABET.charAt(Math.floor(random() * ID_ALPHABET.length));
  }
  return id;
}
