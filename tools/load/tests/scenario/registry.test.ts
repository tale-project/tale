import { describe, expect, test } from 'bun:test';

import { MetricsRegistry, summarize } from '../../src/metrics/index.ts';
import {
  HINT_LATENCY,
  HintRegistry,
  createHintReceiver,
} from '../../src/scenario/registry.ts';

function latencies(metrics: MetricsRegistry): {
  count: number;
  max: number;
} {
  const row = summarize(metrics.snapshot()).timings.find(
    (entry) => entry.name === HINT_LATENCY,
  );
  return { count: row?.count ?? 0, max: row?.max ?? 0 };
}

describe('HintRegistry', () => {
  test('each tab measures a write once, from the click', () => {
    let now = 1_000;
    const registry = new HintRegistry(() => now);
    const metrics = new MetricsRegistry();
    const alice = createHintReceiver();
    const bob = createHintReceiver();
    registry.registerWrite(metrics, 'task-1', 1_000);
    now = 1_250;
    registry.observeHint(metrics, 'task-1', alice);
    now = 1_400;
    registry.observeHint(metrics, 'task-1', bob);
    // The same entity changes again in another process 30 s later: its
    // hint must not read as a 30 s propagation of the earlier click.
    now = 31_000;
    registry.observeHint(metrics, 'task-1', alice);
    registry.observeHint(metrics, 'task-1', bob);
    const seen = latencies(metrics);
    expect(seen.count).toBe(2);
    expect(seen.max).toBeGreaterThanOrEqual(399);
    expect(seen.max).toBeLessThanOrEqual(401);
  });

  test('a new local write is measured again by the same tab', () => {
    let now = 0;
    const registry = new HintRegistry(() => now);
    const metrics = new MetricsRegistry();
    const tab = createHintReceiver();
    registry.registerWrite(metrics, 'task-1', 0);
    now = 100;
    registry.observeHint(metrics, 'task-1', tab);
    now = 5_000;
    registry.registerWrite(metrics, 'task-1', 5_000);
    now = 5_300;
    registry.observeHint(metrics, 'task-1', tab);
    expect(latencies(metrics).count).toBe(2);
  });

  test('a hint that beats the write response is matched once it registers', () => {
    let now = 5_000;
    const registry = new HintRegistry(() => now);
    const metrics = new MetricsRegistry();
    now = 5_120;
    registry.observeHint(metrics, 'task-2', createHintReceiver());
    registry.observeHint(metrics, 'task-2', createHintReceiver());
    expect(latencies(metrics).count).toBe(0);
    now = 5_300;
    registry.registerWrite(metrics, 'task-2', 5_000);
    const seen = latencies(metrics);
    expect(seen.count).toBe(2);
    expect(seen.max).toBeLessThanOrEqual(121);
  });

  test('a parked hint older than the click announced another change', () => {
    let now = 0;
    const registry = new HintRegistry(() => now);
    const metrics = new MetricsRegistry();
    registry.observeHint(metrics, 'task-3', createHintReceiver());
    now = 20_000;
    registry.registerWrite(metrics, 'task-3', 19_900);
    expect(latencies(metrics).count).toBe(0);
  });

  test('hints for unknown or stale writes record nothing', () => {
    let now = 0;
    const registry = new HintRegistry(() => now);
    const metrics = new MetricsRegistry();
    registry.registerWrite(metrics, 'old', 0);
    now = 120_000;
    registry.observeHint(metrics, 'old', createHintReceiver());
    registry.observeHint(metrics, 'never-written', createHintReceiver());
    expect(latencies(metrics).count).toBe(0);
    expect(registry.size.early).toBe(2);
  });
});
