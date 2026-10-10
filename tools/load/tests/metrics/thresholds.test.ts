import { describe, expect, test } from 'bun:test';

import { MetricsRegistry, summarize } from '../../src/metrics/registry.ts';
import type { MetricsSummary } from '../../src/metrics/registry.ts';
import {
  evaluateThresholds,
  formatThresholdResults,
  parseThresholds,
  thresholdsSchema,
} from '../../src/metrics/thresholds.ts';

function sampleSummary(): MetricsSummary {
  let at = 0;
  const registry = new MetricsRegistry({ now: () => at });
  for (let i = 1; i <= 100; i += 1) {
    registry.request('GET /api/app/chat/threads', i * 10, 200);
  }
  registry.request('POST /api/app/chat/threads', 50, 500);
  registry.error('POST /api/app/chat/threads', 'http_500', 'boom');
  registry.timing('chat.ttft', 700);
  registry.counter('sse.events.reconnects', 30);
  registry.gauge('sse.events.open', 5);
  registry.gauge('sse.events.open', -2);
  at = 10_000;
  return summarize(registry.snapshot());
}

describe('parseThresholds', () => {
  test('flattens keys, splitting the stat at the last dot', () => {
    const thresholds = parseThresholds({
      'http.p95': '<800',
      'errors.errorRate': '<=0.01',
      'GET /api/app/chat/threads.p99': ['< 2000', '>0'],
      'chat.ttft.mean': '>=1e2',
    });
    expect(thresholds).toEqual([
      {
        key: 'http.p95',
        metric: 'http',
        stat: 'p95',
        expression: '<800',
        operator: '<',
        value: 800,
      },
      {
        key: 'errors.errorRate',
        metric: 'errors',
        stat: 'errorRate',
        expression: '<=0.01',
        operator: '<=',
        value: 0.01,
      },
      {
        key: 'GET /api/app/chat/threads.p99',
        metric: 'GET /api/app/chat/threads',
        stat: 'p99',
        expression: '< 2000',
        operator: '<',
        value: 2000,
      },
      {
        key: 'GET /api/app/chat/threads.p99',
        metric: 'GET /api/app/chat/threads',
        stat: 'p99',
        expression: '>0',
        operator: '>',
        value: 0,
      },
      {
        key: 'chat.ttft.mean',
        metric: 'chat.ttft',
        stat: 'mean',
        expression: '>=1e2',
        operator: '>=',
        value: 100,
      },
    ]);
  });

  test('rejects malformed keys, stats and expressions, naming each', () => {
    const result = thresholdsSchema.safeParse({
      p95: '<800',
      'http.p42': '<800',
      'http.p95': 'below 800',
      'http.max': ['<1', '=>2'],
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message) ?? [];
    expect(messages.some((m) => m.includes('not <metric>.<stat>'))).toBe(true);
    expect(messages.some((m) => m.includes('unknown stat "p42"'))).toBe(true);
    expect(messages.some((m) => m.includes('"below 800"'))).toBe(true);
    expect(messages.some((m) => m.includes('"=>2"'))).toBe(true);
    expect(() => parseThresholds({ 'http.p95': 'below 800' })).toThrow();
  });

  test('rejects a value that is not an expression or a list of them', () => {
    expect(thresholdsSchema.safeParse({ 'http.count': 5 }).success).toBe(false);
    expect(thresholdsSchema.safeParse({ 'http.count': [] }).success).toBe(
      false,
    );
    expect(thresholdsSchema.safeParse(['http.p95<800']).success).toBe(false);
  });
});

describe('evaluateThresholds', () => {
  test('passes and fails on measured values', () => {
    const summary = sampleSummary();
    const results = evaluateThresholds(
      parseThresholds({
        'http.p95': '<2000',
        'http.count': '==101',
        'GET /api/app/chat/threads.p50': '<400',
        'POST /api/app/chat/threads.errorRate': '<0.5',
        'errors.errorRate': '<=0.001',
        'errors.count': '==1',
        'chat.ttft.p95': '<800',
        'sse.events.reconnects.rate': '<=3',
        'sse.events.reconnects.count': '<10',
        'sse.events.open.max': '==5',
      }),
      summary,
    );
    const verdicts = Object.fromEntries(
      results.map((result) => [result.key, result.ok]),
    );
    expect(verdicts).toEqual({
      'http.p95': true,
      'http.count': true,
      'GET /api/app/chat/threads.p50': false,
      'POST /api/app/chat/threads.errorRate': false,
      'errors.errorRate': false,
      'errors.count': true,
      'chat.ttft.p95': true,
      'sse.events.reconnects.rate': true,
      'sse.events.reconnects.count': false,
      'sse.events.open.max': true,
    });
    const errorRate = results.find(
      (result) => result.key === 'errors.errorRate',
    );
    expect(errorRate?.actual).toBeCloseTo(1 / 101, 6);
    expect(results.every((result) => result.reason === undefined)).toBe(true);
  });

  test('an unknown metric fails with a reason instead of passing', () => {
    const [result] = evaluateThresholds(
      parseThresholds({ 'chat.ttfx.p95': '<800' }),
      sampleSummary(),
    );
    expect(result.ok).toBe(false);
    expect(result.actual).toBeNull();
    expect(result.reason).toContain('unknown metric "chat.ttfx"');
  });

  test('a stat the metric lacks, or a percentile of nothing, fails', () => {
    let at = 0;
    const empty = new MetricsRegistry({ now: () => at });
    empty.counter('turns', 3);
    at = 1_000;
    const results = evaluateThresholds(
      parseThresholds({
        'http.p95': '<800',
        'errors.errorRate': '<0.01',
        'errors.p95': '<1',
        'turns.p95': '<1',
        'turns.count': '>=3',
      }),
      summarize(empty.snapshot()),
    );
    const byKey = Object.fromEntries(
      results.map((result) => [result.key, result]),
    );
    expect(byKey['http.p95'].ok).toBe(false);
    expect(byKey['http.p95'].reason).toContain('no samples');
    expect(byKey['errors.errorRate'].ok).toBe(false);
    expect(byKey['errors.p95'].ok).toBe(false);
    expect(byKey['turns.p95'].ok).toBe(false);
    expect(byKey['turns.p95'].reason).toContain('counter "turns"');
    expect(byKey['turns.count'].ok).toBe(true);

    const report = formatThresholdResults(results);
    expect(report).toContain('FAIL  http.p95 <800');
    expect(report).toContain('PASS  turns.count >=3  (actual 3)');
  });
});
