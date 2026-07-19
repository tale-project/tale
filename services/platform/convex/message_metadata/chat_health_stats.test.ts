import { describe, expect, it } from 'vitest';

import type { Doc } from '../_generated/dataModel';
import {
  computeChatHealthStats,
  percentile,
  PINNED_ROUTE_REASON,
  UNATTRIBUTED_AGENT_SLUG,
} from './chat_health_stats';

type MetaRow = Doc<'messageMetadata'>;

let nextId = 1;

function row(overrides: Partial<MetaRow>): MetaRow {
  const id = nextId++;
  return {
    _id: `mm_${id}` as MetaRow['_id'],
    _creationTime: 0,
    messageId: `m_${id}`,
    threadId: 't_1',
    model: 'gpt-4o',
    provider: 'openai',
    ...overrides,
  } as MetaRow;
}

const OPTS = { windowStartMs: null, maxScan: 1000 };

describe('percentile', () => {
  it('returns null for an empty input', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([], 0.95)).toBeNull();
  });

  it('returns the single value for a one-element input', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('computes nearest-rank p50 and p95', () => {
    // ceil(0.5 * 4) = 2 → index 1 → 2
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    // ceil(0.95 * 5) = 5 → index 4 → 50
    expect(percentile([10, 20, 30, 40, 50], 0.95)).toBe(50);
    // 1..100: ceil(0.95 * 100) = 95 → index 94 → 95
    const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(oneToHundred, 0.95)).toBe(95);
    expect(percentile(oneToHundred, 0.5)).toBe(50);
  });
});

describe('computeChatHealthStats', () => {
  it('returns zeroed stats and null percentiles for no rows', () => {
    const out = computeChatHealthStats([], OPTS);
    expect(out.totalMessages).toBe(0);
    expect(out.errorRate).toBe(0);
    expect(out.errors.byType).toEqual([]);
    expect(out.errors.recent).toEqual([]);
    expect(out.blockedRate).toBe(0);
    expect(out.latency.durationMs).toEqual({ p50: null, p95: null, count: 0 });
    expect(out.latency.timeToFirstTokenMs.count).toBe(0);
    expect(out.tools.totalCalls).toBe(0);
    expect(out.routing.byAutoRouteReason).toEqual([]);
    expect(out.tokens).toEqual({ input: 0, output: 0, total: 0 });
    expect(out.costCents).toBe(0);
    expect(out.capped).toBe(false);
    expect(out.scanned).toBe(0);
  });

  it('computes error and blocked rates over all turns', () => {
    const out = computeChatHealthStats(
      [
        row({ error: 'boom' }),
        row({ error: '' }), // empty string is NOT an error
        row({}),
        row({
          blockedReason: {
            code: 'pii.blocked',
            direction: 'output',
            categoryIds: ['email'],
            sanitizationRunId: 'run_1',
          },
        }),
      ],
      OPTS,
    );
    expect(out.totalMessages).toBe(4);
    expect(out.errorCount).toBe(1);
    expect(out.errorRate).toBeCloseTo(0.25, 10);
    expect(out.blockedCount).toBe(1);
    expect(out.blockedRate).toBeCloseTo(0.25, 10);
  });

  it('classifies errored turns by type and collects the recent ones', () => {
    const out = computeChatHealthStats(
      [
        row({
          _creationTime: 5,
          error:
            'Uncaught Error: This request requires more credits, or an amount greater than your balance. You can only afford 2117.',
          model: 'gpt-4o',
          agentSlug: 'researcher',
        }),
        row({
          _creationTime: 4,
          error: '429 Too Many Requests: rate limit exceeded',
        }),
        row({
          _creationTime: 3,
          error: 'Provider returned a 500 Internal Server Error',
        }),
        row({ _creationTime: 2, error: 'This operation was aborted' }), // → generic
        row({ _creationTime: 1, error: '' }), // empty string is NOT an error
        row({ _creationTime: 0 }), // absent error is NOT counted
      ],
      OPTS,
    );

    expect(out.errorCount).toBe(4);
    const byType = Object.fromEntries(
      out.errors.byType.map((e) => [e.key, e.count]),
    );
    expect(byType.credit_exhausted).toBe(1);
    expect(byType.rate_limited).toBe(1);
    expect(byType.provider_error).toBe(1);
    expect(byType.generic).toBe(1);
    // Non-errors never bucket: the tally sums to exactly the error count.
    expect(out.errors.byType.reduce((n, e) => n + e.count, 0)).toBe(4);

    // recent preserves scan order and projects the turn's type/model/agent.
    expect(out.errors.recent).toHaveLength(4);
    expect(out.errors.recent[0]).toEqual({
      at: 5,
      type: 'credit_exhausted',
      model: 'gpt-4o',
      agentSlug: 'researcher',
    });
    expect(out.errors.recent.map((r) => r.type)).toEqual([
      'credit_exhausted',
      'rate_limited',
      'provider_error',
      'generic',
    ]);
  });

  it('caps recent errored turns at 20 while still tallying all by type', () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row({ _creationTime: i, error: '429 rate limit exceeded' }),
    );
    const out = computeChatHealthStats(rows, {
      windowStartMs: null,
      maxScan: 1000,
    });
    expect(out.errorCount).toBe(25);
    const byType = Object.fromEntries(
      out.errors.byType.map((e) => [e.key, e.count]),
    );
    expect(byType.rate_limited).toBe(25);
    expect(out.errors.recent).toHaveLength(20);
  });

  it('computes latency percentiles only over rows that carry the metric', () => {
    const out = computeChatHealthStats(
      [
        row({ durationMs: 100, timeToFirstTokenMs: 50 }),
        row({ durationMs: 300 }), // no ttft
        row({ durationMs: 200, timeToFirstTokenMs: 90 }),
        row({}), // neither
      ],
      OPTS,
    );
    // durationMs sorted [100,200,300]: p50 = ceil(1.5)=2→idx1→200; p95 = ceil(2.85)=3→idx2→300
    expect(out.latency.durationMs.count).toBe(3);
    expect(out.latency.durationMs.p50).toBe(200);
    expect(out.latency.durationMs.p95).toBe(300);
    // ttft only two rows: [50,90]
    expect(out.latency.timeToFirstTokenMs.count).toBe(2);
    expect(out.latency.timeToFirstTokenMs.p50).toBe(50);
  });

  it('counts tool-call volume, not failures', () => {
    const out = computeChatHealthStats(
      [
        row({
          toolsUsage: [{ toolName: 'web_search' }, { toolName: 'rag_search' }],
        }),
        row({ toolsUsage: [{ toolName: 'web_search' }] }),
        row({}), // no tools
      ],
      OPTS,
    );
    expect(out.tools.totalCalls).toBe(3);
    expect(out.tools.messagesUsingTools).toBe(2);
    expect(out.tools.byTool).toEqual([
      { key: 'web_search', count: 2 },
      { key: 'rag_search', count: 1 },
    ]);
  });

  it('buckets routing by reason (pinned for absent), agent, and model', () => {
    const out = computeChatHealthStats(
      [
        row({ autoRouteReason: 'classified', agentSlug: 'researcher' }),
        row({ autoRouteReason: 'classified', agentSlug: 'researcher' }),
        row({ autoRouteReason: 'trivial', agentSlug: 'general' }),
        row({ agentSlug: 'general' }), // pinned (no autoRouteReason)
        row({ model: 'claude-opus-4-8', provider: 'anthropic' }), // pinned + no agent
      ],
      OPTS,
    );
    const reasons = Object.fromEntries(
      out.routing.byAutoRouteReason.map((r) => [r.key, r.count]),
    );
    expect(reasons.classified).toBe(2);
    expect(reasons.trivial).toBe(1);
    expect(reasons[PINNED_ROUTE_REASON]).toBe(2);

    const agents = Object.fromEntries(
      out.routing.byAgentSlug.map((a) => [a.key, a.count]),
    );
    expect(agents.researcher).toBe(2);
    expect(agents.general).toBe(2);
    expect(agents[UNATTRIBUTED_AGENT_SLUG]).toBe(1);

    // byModel: 4 gpt-4o/openai (defaults) + 1 claude-opus-4-8/anthropic
    const gpt = out.routing.byModel.find((m) => m.model === 'gpt-4o');
    expect(gpt).toEqual({ provider: 'openai', model: 'gpt-4o', count: 4 });
    expect(
      out.routing.byModel.find((m) => m.model === 'claude-opus-4-8')?.count,
    ).toBe(1);
  });

  it('sums tokens and cost, deriving total when absent', () => {
    const out = computeChatHealthStats(
      [
        row({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
        row({ inputTokens: 10, outputTokens: 5 }), // total derived → 15
        row({ costEstimateCents: 3 }),
        row({ costEstimateCents: 7 }),
      ],
      OPTS,
    );
    expect(out.tokens).toEqual({ input: 110, output: 55, total: 165 });
    expect(out.costCents).toBe(10);
  });

  it('caps the scan at maxScan and flags it', () => {
    const rows = Array.from({ length: 10 }, () => row({ durationMs: 1 }));
    const out = computeChatHealthStats(rows, {
      windowStartMs: null,
      maxScan: 5,
    });
    expect(out.capped).toBe(true);
    // Reducer stops the turn it exceeds maxScan, so it counts exactly maxScan.
    expect(out.totalMessages).toBe(5);
  });
});
