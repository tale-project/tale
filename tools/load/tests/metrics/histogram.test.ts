import { describe, expect, test } from 'bun:test';

import {
  HIGHEST_TRACKABLE_US,
  LatencyHistogram,
  mergeEncoded,
} from '../../src/metrics/histogram.ts';

/** A deterministic pseudo-random stream (mulberry32), so failures replay. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function latencies(seed: number, count: number, scaleMs: number): number[] {
  const random = seeded(seed);
  return Array.from({ length: count }, () => random() * scaleMs);
}

const PERCENTILES = [1, 25, 50, 75, 90, 95, 99, 99.9, 100];

describe('LatencyHistogram', () => {
  test('records milliseconds and answers in milliseconds', () => {
    const histogram = new LatencyHistogram();
    for (let ms = 1; ms <= 100; ms += 1) {
      histogram.record(ms);
    }
    expect(histogram.count).toBe(100);
    expect(histogram.percentile(50)).toBeCloseTo(50, 1);
    expect(histogram.percentile(99)).toBeCloseTo(99, 1);
    expect(histogram.max).toBeCloseTo(100, 1);
    expect(histogram.min).toBeCloseTo(1, 2);
    expect(histogram.mean).toBeCloseTo(50.5, 1);
  });

  test('keeps sub-millisecond resolution', () => {
    const histogram = new LatencyHistogram();
    histogram.record(0.25);
    expect(histogram.percentile(50)).toBeCloseTo(0.25, 3);
  });

  test('clamps negative, non-finite and out-of-range values', () => {
    const histogram = new LatencyHistogram();
    histogram.record(-5);
    histogram.record(Number.NaN);
    histogram.record(10 * 3_600_000);
    expect(histogram.count).toBe(3);
    expect(histogram.percentile(50)).toBe(0);
    // An hour, within the histogram's 0.1 % precision.
    const ceilingMs = HIGHEST_TRACKABLE_US / 1000;
    expect(Math.abs(histogram.max - ceilingMs) / ceilingMs).toBeLessThan(0.001);
  });

  test('an empty histogram reports zeros', () => {
    const histogram = new LatencyHistogram();
    expect(histogram.count).toBe(0);
    expect(histogram.percentile(95)).toBe(0);
    expect(histogram.mean).toBe(0);
    expect(histogram.max).toBe(0);
    expect(histogram.min).toBe(0);
  });

  test('encode and decode round-trip every statistic', () => {
    const histogram = new LatencyHistogram();
    for (const ms of latencies(7, 5_000, 2_000)) {
      histogram.record(ms);
    }
    const encoded = histogram.encode();
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeLessThan(20_000);
    const decoded = LatencyHistogram.decode(encoded);
    expect(decoded.count).toBe(histogram.count);
    expect(decoded.mean).toBe(histogram.mean);
    expect(decoded.max).toBe(histogram.max);
    for (const p of PERCENTILES) {
      expect(decoded.percentile(p)).toBe(histogram.percentile(p));
    }
  });

  test('merged percentiles equal one histogram fed both streams', () => {
    const first = latencies(11, 4_000, 800);
    const second = latencies(23, 6_000, 5_000);
    const single = new LatencyHistogram();
    const a = new LatencyHistogram();
    const b = new LatencyHistogram();
    for (const ms of first) {
      single.record(ms);
      a.record(ms);
    }
    for (const ms of second) {
      single.record(ms);
      b.record(ms);
    }
    // Merge through the wire format, as shards do.
    const merged = LatencyHistogram.decode(a.encode());
    merged.merge(LatencyHistogram.decode(b.encode()));
    expect(merged.count).toBe(single.count);
    expect(merged.max).toBe(single.max);
    expect(merged.mean).toBeCloseTo(single.mean, 6);
    for (const p of PERCENTILES) {
      expect(merged.percentile(p)).toBe(single.percentile(p));
    }

    const viaHelper = mergeEncoded([a.encode(), b.encode()]);
    expect(viaHelper?.percentile(95)).toBe(single.percentile(95));
    expect(mergeEncoded([])).toBeNull();
  });

  test('reset empties the histogram for reuse', () => {
    const histogram = new LatencyHistogram({ significantDigits: 2 });
    histogram.record(12);
    histogram.reset();
    expect(histogram.count).toBe(0);
    histogram.record(3);
    expect(histogram.percentile(100)).toBeCloseTo(3, 1);
  });
});
