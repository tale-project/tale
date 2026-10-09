import { describe, expect, test } from 'bun:test';

import { LatencyHistogram } from '../../src/metrics/histogram.ts';
import {
  ERROR_DETAIL_MAX,
  MetricsRegistry,
  formatSummary,
  mergeSnapshots,
  metricsSnapshotSchema,
  summarize,
} from '../../src/metrics/registry.ts';

/** A clock the test moves by hand; starts on a window boundary. */
function manualClock(start = 1_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let at = start;
  return {
    now: () => at,
    advance: (ms) => {
      at += ms;
    },
  };
}

describe('MetricsRegistry recording', () => {
  test('timings, requests, counters, gauges and statuses', () => {
    const clock = manualClock();
    const registry = new MetricsRegistry({ now: clock.now });
    registry.request('GET /a', 10, 200);
    registry.request('GET /a', 30, 200);
    registry.request('GET /a', 50, 503);
    registry.timing('chat.ttft', 400);
    registry.counter('turns');
    registry.counter('turns', 2);
    registry.gauge('sse.open', 1);
    registry.gauge('sse.open', 1);
    registry.gauge('sse.open', -1);

    expect(registry.histogram('GET /a')?.count).toBe(3);
    expect(registry.counterValue('turns')).toBe(3);
    expect(registry.counterValue('missing')).toBe(0);
    expect(registry.gaugeValue('sse.open')).toEqual({ current: 1, max: 2 });
    expect(registry.totals()).toEqual({ requests: 3, errors: 0 });

    clock.advance(1_000);
    const snapshot = registry.snapshot();
    expect(snapshot.statuses['GET /a']).toEqual({ '200': 2, '503': 1 });
    expect(snapshot.timings['GET /a'].kind).toBe('request');
    expect(snapshot.timings['chat.ttft'].kind).toBe('timing');
    expect(snapshot.counters).toEqual({ turns: 3 });
    expect(snapshot.gauges['sse.open']).toEqual({ current: 1, max: 2 });
    expect(snapshot.endedAt - snapshot.startedAt).toBe(1_000);
  });

  test('error samples keep the latest five, truncated to 300 characters', () => {
    const registry = new MetricsRegistry();
    for (let i = 0; i < 8; i += 1) {
      registry.error('GET /a', 'http_500', `failure ${i}`);
    }
    registry.error('GET /a', 'net_ECONNRESET');
    registry.error('GET /b', 'http_502', 'x'.repeat(1_000));

    const errors = registry.snapshot().errors;
    expect(errors['GET /a'].http_500.count).toBe(8);
    expect(errors['GET /a'].http_500.samples).toEqual([
      'failure 3',
      'failure 4',
      'failure 5',
      'failure 6',
      'failure 7',
    ]);
    expect(errors['GET /a'].net_ECONNRESET).toEqual({ count: 1, samples: [] });
    const [long] = errors['GET /b'].http_502.samples;
    expect(long.length).toBe(ERROR_DETAIL_MAX);
    expect(registry.errorCount('GET /a')).toBe(9);
    expect(registry.errorCount('GET /a', 'http_500')).toBe(8);
    expect(registry.totals().errors).toBe(10);
  });

  test('the snapshot is JSON-safe and passes its own schema', () => {
    const registry = new MetricsRegistry({ shard: { index: 2, count: 5 } });
    registry.request('GET /a', 12, 200);
    registry.error('GET /a', 'http_500', 'boom');
    registry.timing('chat.ttft', 900);
    const snapshot = registry.snapshot();
    const roundTripped: unknown = JSON.parse(JSON.stringify(snapshot));
    expect(roundTripped).toEqual(snapshot);
    expect(metricsSnapshotSchema.parse(roundTripped)).toEqual(snapshot);
    expect(snapshot.shards).toEqual([{ index: 2, count: 5 }]);
  });
});

describe('MetricsRegistry time series', () => {
  test('buckets requests, errors, latency and chat.ttft into windows', () => {
    const clock = manualClock(10_000);
    const registry = new MetricsRegistry({ now: clock.now, windowMs: 5_000 });
    registry.request('GET /a', 10, 200);
    registry.request('GET /a', 20, 500);
    registry.error('GET /a', 'http_500', 'boom');
    registry.timing('chat.ttft', 700);
    registry.timing('chat.ttft.cold', 1_500);
    registry.timing('other', 5);
    expect(registry.recent()).toBeNull();

    clock.advance(5_000);
    registry.request('GET /a', 40, 200);
    const recent = registry.recent();
    expect(recent?.start).toBe(10_000);
    expect(recent?.requests).toBe(2);
    expect(recent?.errors).toBe(1);
    expect(recent?.p99).toBeCloseTo(20, 0);

    const { series } = registry.snapshot();
    expect(series.map((window) => window.start)).toEqual([10_000, 15_000]);
    const [first, second] = series;
    expect(first.requests).toBe(2);
    expect(first.errors).toBe(1);
    expect(Object.keys(first.ttft).sort()).toEqual([
      'chat.ttft',
      'chat.ttft.cold',
    ]);
    expect(LatencyHistogram.decode(first.ttft['chat.ttft']).count).toBe(1);
    expect(LatencyHistogram.decode(first.latency ?? '').count).toBe(2);
    expect(second.requests).toBe(1);
    expect(second.ttft).toEqual({});

    const since = registry.snapshot({ seriesSince: 15_000 }).series;
    expect(since.map((window) => window.start)).toEqual([15_000]);
  });

  test('history older than the retention span is dropped', () => {
    const clock = manualClock(0);
    const registry = new MetricsRegistry({
      now: clock.now,
      windowMs: 1_000,
      retentionMs: 3_000,
    });
    for (let i = 0; i < 10; i += 1) {
      registry.request('GET /a', 1, 200);
      clock.advance(1_000);
    }
    const starts = registry.snapshot().series.map((window) => window.start);
    expect(starts).toEqual([7_000, 8_000, 9_000]);
  });
});

describe('mergeSnapshots and summarize', () => {
  test('two shards merge into what one registry fed both would report', () => {
    const clock = manualClock(20_000);
    const a = new MetricsRegistry({
      now: clock.now,
      shard: { index: 0, count: 2 },
    });
    const b = new MetricsRegistry({
      now: clock.now,
      shard: { index: 1, count: 2 },
    });
    const both = new MetricsRegistry({ now: clock.now });
    for (let i = 1; i <= 200; i += 1) {
      const target = i % 2 === 0 ? a : b;
      for (const registry of [target, both]) {
        registry.request('GET /a', i, i % 50 === 0 ? 500 : 200);
        if (i % 50 === 0) {
          registry.error('GET /a', 'http_500', `sample ${i}`);
        }
        registry.timing('chat.ttft', i * 10);
        registry.counter('turns');
      }
    }
    a.gauge('open', 3);
    b.gauge('open', 4);
    clock.advance(2_000);

    const merged = mergeSnapshots([a.snapshot(), b.snapshot()]);
    expect(merged.shards).toEqual([
      { index: 0, count: 2 },
      { index: 1, count: 2 },
    ]);
    expect(merged.counters.turns).toBe(200);
    expect(merged.gauges.open).toEqual({ current: 7, max: 7 });
    expect(merged.statuses['GET /a']).toEqual({ '200': 196, '500': 4 });
    expect(merged.errors['GET /a'].http_500.count).toBe(4);
    expect(merged.series).toHaveLength(1);
    expect(merged.series[0].requests).toBe(200);
    expect(merged.series[0].errors).toBe(4);

    const fromMerge = summarize(merged);
    const fromOne = summarize(both.snapshot());
    const mergedRow = fromMerge.timings.find((row) => row.name === 'GET /a');
    const oneRow = fromOne.timings.find((row) => row.name === 'GET /a');
    expect(mergedRow).toEqual(oneRow);
    expect(fromMerge.http).toEqual(fromOne.http);
    expect(fromMerge.shards).toBe(2);
  });

  test('summary rows carry rates, percentiles and error rates', () => {
    const clock = manualClock(0);
    const registry = new MetricsRegistry({ now: clock.now });
    for (let i = 1; i <= 100; i += 1) {
      registry.request('GET /a', i, 200);
    }
    for (let i = 1; i <= 100; i += 1) {
      registry.request('POST /b', 1_000 + i, i <= 10 ? 500 : 200);
      if (i <= 10) {
        registry.error('POST /b', 'http_500', 'boom');
      }
    }
    registry.timing('chat.ttft', 250);
    registry.error('sse.events', 'net_ECONNRESET', 'reset');
    registry.counter('turns', 20);
    clock.advance(10_000);

    const summary = summarize(registry.snapshot());
    expect(summary.durationS).toBe(10);
    const a = summary.timings.find((row) => row.name === 'GET /a');
    expect(a?.count).toBe(100);
    expect(a?.rate).toBe(10);
    expect(a?.p50).toBeCloseTo(50, 0);
    expect(a?.errorRate).toBe(0);
    const b = summary.timings.find((row) => row.name === 'POST /b');
    expect(b?.errors).toBe(10);
    expect(b?.errorRate).toBeCloseTo(0.1, 6);
    expect(summary.http.count).toBe(200);
    expect(summary.http.errors).toBe(10);
    expect(summary.http.max).toBeCloseTo(1_100, -1);
    const ttft = summary.timings.find((row) => row.name === 'chat.ttft');
    expect(ttft?.kind).toBe('timing');
    expect(summary.totals).toEqual({
      requests: 200,
      errors: 11,
      errorsPerS: 1.1,
      errorRate: 11 / 200,
    });
    expect(summary.counters).toEqual([{ name: 'turns', value: 20, rate: 2 }]);
    expect(summary.errors[0]).toMatchObject({ name: 'POST /b', count: 10 });

    const table = formatSummary(summary);
    expect(table).toContain('GET /a');
    expect(table).toContain('POST /b');
    expect(table).toContain('chat.ttft');
    expect(table).toContain('turns');
    expect(table).toContain('http_500');
    const widths = new Set(
      table
        .split('\n')
        .filter((line) => line.startsWith('GET /a') || line.startsWith('http '))
        .map((line) => line.length),
    );
    expect(widths.size).toBe(1);
  });

  test('refuses an empty list and mismatched window lengths', () => {
    expect(() => mergeSnapshots([])).toThrow();
    const a = new MetricsRegistry({ windowMs: 5_000 }).snapshot();
    const b = new MetricsRegistry({ windowMs: 1_000 }).snapshot();
    expect(() => mergeSnapshots([a, b])).toThrow(/window lengths/);
  });
});
