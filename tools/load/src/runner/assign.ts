/**
 * Deterministic per-user choices: which persona user `k` plays, its random
 * stream, the synthetic address it signs in from. The same plan, weights
 * and seed always produce the same population, on whichever generator a
 * user lands.
 */

import {
  PERSONA_NAMES,
  type PersonaName,
  type PersonaWeights,
} from '../scenario/contract.ts';

/** A small, fast, well-distributed PRNG (mulberry32). Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Mix a user index with the run seed into one 32-bit seed. */
export function userSeed(runSeed: number, index: number): number {
  let h = (runSeed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** The persona user `index` plays under these weights. */
export function personaFor(
  weights: PersonaWeights,
  runSeed: number,
  index: number,
): PersonaName {
  const entries = PERSONA_NAMES.map(
    (name) => [name, Math.max(0, weights[name] ?? 0)] as const,
  ).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) {
    throw new Error('persona weights must contain a positive weight');
  }
  let pick = mulberry32(userSeed(runSeed, index) ^ 0x5bd1e995)() * total;
  for (const [name, weight] of entries) {
    pick -= weight;
    if (pick < 0) return name;
  }
  const last = entries[entries.length - 1];
  if (last === undefined) throw new Error('no persona to assign');
  return last[0];
}

/**
 * A synthetic client address for user `index` in 198.18.0.0/15, the range
 * set aside for benchmarking (RFC 2544): routable-looking, never a real
 * customer, and outside the private ranges a deployment trusts as its own
 * proxies — so a target that trusts the generator as a proxy rate-limits
 * each virtual user on its own address, the way it would real people.
 */
export function benchmarkAddress(index: number): string {
  const n = index % 131_072;
  return `198.${18 + (n >>> 16)}.${(n >>> 8) & 255}.${n & 255}`;
}
