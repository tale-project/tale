import { describe, expect, test } from 'bun:test';

import { summarize } from './statistics';

describe('performance measurements', () => {
  test('uses nearest-rank percentiles and total elapsed throughput', () => {
    const durations = [40, 10, 20, 30];
    expect(summarize(durations, 5)).toMatchObject({
      p50Ms: 20,
      p95Ms: 40,
      p99Ms: 40,
      meanMs: 25,
      operationsPerSecond: 200,
      operationsPerSample: 5,
    });
    expect(durations).toEqual([40, 10, 20, 30]);
  });

  test('rejects empty, zero, invalid durations and invalid counts', () => {
    for (const values of [[], [0], [-1], [Infinity], [NaN]]) {
      expect(() => summarize(values, 1)).toThrow();
    }
    for (const count of [0, -1, 0.5, Infinity]) {
      expect(() => summarize([1], count)).toThrow();
    }
  });
});
