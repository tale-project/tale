/**
 * Draws from one user's seeded uniform stream (`ctx.random`). Everything a
 * virtual user decides goes through these, so the same plan, seed and user
 * index replay the same choices.
 */

export type Random = () => number;

/** Uniform integer in `[min, max]`. */
export function intBetween(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** `true` with probability `p`. */
export function chance(random: Random, p: number): boolean {
  return random() < p;
}

/** One element, uniformly; `undefined` for an empty list. */
export function pick<T>(random: Random, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}

/** One element by weight; `undefined` when no weight is positive. */
export function pickWeighted<T>(
  random: Random,
  entries: readonly (readonly [T, number])[],
): T | undefined {
  let total = 0;
  for (const [, weight] of entries) total += Math.max(0, weight);
  if (total <= 0) return undefined;
  let draw = random() * total;
  for (const [item, weight] of entries) {
    const positive = Math.max(0, weight);
    if (draw < positive) return item;
    draw -= positive;
  }
  return entries[entries.length - 1]?.[0];
}

/** A standard normal draw (Box–Muller; one of the pair is discarded). */
function normal(random: Random): number {
  // 1 - u keeps the logarithm's argument in (0, 1].
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * A log-normal draw with the given MEDIAN and shape `sigma`: most draws sit
 * near the median, a long tail runs well past it — how long people take to
 * read, think or type.
 */
export function logNormal(
  random: Random,
  median: number,
  sigma: number,
): number {
  return median * Math.exp(sigma * normal(random));
}

/** An exponential draw with the given mean (memoryless waits, lifetimes). */
export function exponential(random: Random, mean: number): number {
  return -mean * Math.log(1 - random());
}

/** A fresh 31-bit seed drawn from the stream. */
export function seedFrom(random: Random): number {
  return Math.floor(random() * 2_147_483_647);
}
