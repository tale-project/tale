import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../../_generated/server';
import { getOrgWorkflowMetrics } from './get_org_workflow_metrics';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

type Row = {
  _id: string;
  organizationId: string;
  status: 'completed' | 'failed' | 'running';
  startedAt: number;
  completedAt?: number;
  wfDefinitionId?: string;
  workflowSlug?: string;
};

/**
 * Builds a mock `ctx` whose `wfExecutions` query is an async iterable over the
 * provided rows. Mirrors the real `by_org` desc walk: rows are yielded in the
 * order given, and the test supplies them newest-first (decreasing startedAt).
 * `iterated` counts how many rows the consumer actually pulled, so we can
 * assert the loop stops early instead of draining lifetime history.
 */
function createCtx(rows: Row[]) {
  const counter = { iterated: 0 };

  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        counter.iterated += 1;
        yield row;
      }
    },
  };

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue(builder),
    },
  };

  return { ctx: ctx as unknown as QueryCtx, builder, counter };
}

function makeRow(
  partial: Partial<Row> & { startedAt: number; status: Row['status'] },
): Row {
  return {
    _id: `exec_${partial.startedAt}`,
    organizationId: 'org_1',
    ...partial,
  };
}

describe('getOrgWorkflowMetrics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries the by_org index in descending order', async () => {
    const { ctx, builder } = createCtx([]);

    await getOrgWorkflowMetrics(ctx, {
      organizationId: 'org_1',
      periodDays: 7,
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org',
      expect.any(Function),
    );
    expect(builder.order).toHaveBeenCalledWith('desc');
  });

  it('counts in-window and prior-window rows into the right buckets', async () => {
    // periodDays = 7 → window = last 7 days, prior window = the 7 days before.
    const inWindow = NOW - 2 * DAY_MS;
    const priorWindow = NOW - 9 * DAY_MS;
    const rows = [
      makeRow({
        startedAt: inWindow,
        status: 'completed',
        completedAt: inWindow + 5000,
      }),
      makeRow({ startedAt: inWindow - DAY_MS, status: 'failed' }),
      makeRow({
        startedAt: priorWindow,
        status: 'completed',
        completedAt: priorWindow + 1000,
      }),
    ];
    const { ctx } = createCtx(rows);

    const result = await getOrgWorkflowMetrics(ctx, {
      organizationId: 'org_1',
      periodDays: 7,
    });

    expect(result.summary.total).toBe(2);
    expect(result.summary.completed).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.capped).toBe(false);
    expect(result.previousSummary.total).toBe(1);
    expect(result.previousSummary.completed).toBe(1);
  });

  it('stops scanning once it passes the prior window and does not cap on historical volume', async () => {
    const inWindow = NOW - DAY_MS;
    const priorWindow = NOW - 9 * DAY_MS;
    const rows: Row[] = [
      makeRow({
        startedAt: inWindow,
        status: 'completed',
        completedAt: inWindow + 1000,
      }),
      makeRow({
        startedAt: priorWindow,
        status: 'completed',
        completedAt: priorWindow + 1000,
      }),
    ];
    // A large amount of old history that sits before both windows. The desc
    // walk should break before touching any of it.
    for (let i = 0; i < 6000; i++) {
      rows.push(
        makeRow({ startedAt: NOW - (30 + i) * DAY_MS, status: 'completed' }),
      );
    }

    const { ctx, counter } = createCtx(rows);

    const result = await getOrgWorkflowMetrics(ctx, {
      organizationId: 'org_1',
      periodDays: 7,
    });

    // Only in-window + prior-window rows are counted; capped stays false even
    // though lifetime history exceeds MAX_SCAN.
    expect(result.summary.total).toBe(1);
    expect(result.previousSummary.total).toBe(1);
    expect(result.summary.capped).toBe(false);
    // The loop should break at the first out-of-scope row, not drain history.
    expect(counter.iterated).toBeLessThanOrEqual(3);
  });

  it('caps only when in-scope rows exceed MAX_SCAN', async () => {
    const rows: Row[] = [];
    // 5001 rows all inside the current window → genuinely truncated.
    for (let i = 0; i < 5001; i++) {
      rows.push(
        makeRow({
          startedAt: NOW - (i % 6) * DAY_MS - 1000,
          status: 'completed',
        }),
      );
    }

    const { ctx } = createCtx(rows);

    const result = await getOrgWorkflowMetrics(ctx, {
      organizationId: 'org_1',
      periodDays: 7,
    });

    expect(result.summary.capped).toBe(true);
  });
});
