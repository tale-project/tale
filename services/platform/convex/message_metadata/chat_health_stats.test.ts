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
