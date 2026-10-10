import { describe, expect, test } from 'bun:test';

import {
  chance,
  exponential,
  intBetween,
  logNormal,
  pick,
  pickWeighted,
  seedFrom,
} from '../../src/data/random.ts';
import { mulberry32 } from '../../src/runner/assign.ts';

function draws<T>(count: number, draw: () => T): T[] {
  return Array.from({ length: count }, draw);
}

describe('seeded draws', () => {
  test('one seed replays the same stream', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(draws(20, () => intBetween(a, 0, 1_000))).toEqual(
      draws(20, () => intBetween(b, 0, 1_000)),
    );
  });

  test('intBetween stays inside its closed range and reaches both ends', () => {
    const random = mulberry32(7);
    const seen = new Set(draws(2_000, () => intBetween(random, 3, 6)));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  test('chance(0) never fires, chance(1) always does', () => {
    const random = mulberry32(1);
    expect(draws(100, () => chance(random, 0)).some(Boolean)).toBe(false);
    expect(draws(100, () => chance(random, 1)).every(Boolean)).toBe(true);
  });

  test('pick answers undefined for an empty list', () => {
    expect(pick(mulberry32(1), [])).toBeUndefined();
  });

  test('pickWeighted follows the weights and skips non-positive ones', () => {
    const random = mulberry32(3);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 10_000; i += 1) {
      const item = pickWeighted(random, [
        ['a', 3],
        ['b', 1],
        ['c', 0],
      ] as const);
      if (item !== undefined) counts[item] += 1;
    }
    expect(counts.c).toBe(0);
    expect(counts.a / counts.b).toBeGreaterThan(2.5);
    expect(counts.a / counts.b).toBeLessThan(3.5);
    expect(pickWeighted(random, [['x', 0]])).toBeUndefined();
  });

  test('logNormal centres on its median with a long right tail', () => {
    const random = mulberry32(11);
    const values = draws(20_000, () => logNormal(random, 1_000, 0.8)).sort(
      (x, y) => x - y,
    );
    const median = values[values.length / 2] ?? 0;
    const p99 = values[Math.floor(values.length * 0.99)] ?? 0;
    expect(median).toBeGreaterThan(900);
    expect(median).toBeLessThan(1_100);
    expect(p99).toBeGreaterThan(4 * median);
  });

  test('exponential draws average their mean', () => {
    const random = mulberry32(5);
    const values = draws(20_000, () => exponential(random, 60));
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeGreaterThan(55);
    expect(mean).toBeLessThan(65);
    expect(values.every((v) => v >= 0)).toBe(true);
  });

  test('seedFrom yields 31-bit integers', () => {
    const random = mulberry32(9);
    for (const seed of draws(100, () => seedFrom(random))) {
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2_147_483_647);
    }
  });
});
