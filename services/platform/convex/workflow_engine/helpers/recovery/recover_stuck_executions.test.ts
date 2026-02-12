import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { Id } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';

import { recoverStuckExecutions } from './recover_stuck_executions';

const NOW = new Date('2026-02-12T12:00:00Z').getTime();
const THIRTY_ONE_MINUTES_AGO = NOW - 31 * 60 * 1000;
const TWENTY_MINUTES_AGO = NOW - 20 * 60 * 1000;
const FIVE_MINUTES_AGO = NOW - 5 * 60 * 1000;

function makeExecution(
  overrides: Partial<{
    _id: string;
    status: string;
    updatedAt: number;
  }> = {},
) {
  return {
    _id: overrides._id ?? ('exec_1' as Id<'wfExecutions'>),
    status: overrides.status ?? 'running',
    updatedAt: overrides.updatedAt ?? THIRTY_ONE_MINUTES_AGO,
    organizationId: 'org_1',
    wfDefinitionId: 'def_1',
    currentStepSlug: 'step_1',
    startedAt: THIRTY_ONE_MINUTES_AGO,
  };
}

function createMockCtx(executions: ReturnType<typeof makeExecution>[]) {
  const patchCalls: Array<{ id: string; data: Record<string, unknown> }> = [];

  const makeAsyncIterator = (items: ReturnType<typeof makeExecution>[]) => ({
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) return { value: items[i++], done: false };
          return { value: undefined, done: true };
        },
      };
    },
  });

  const db = {
    query: vi.fn((table: string) => {
      return {
        withIndex: vi.fn((_indexName: string, cb: (q: unknown) => unknown) => {
          const statusFilter = { _eq: '' };
          const q = {
            eq: (_field: string, value: string) => {
              statusFilter._eq = value;
              return q;
            },
          };
          cb(q);

          const filtered = executions.filter(
            (e) => table === 'wfExecutions' && e.status === statusFilter._eq,
          );
          return makeAsyncIterator(filtered);
        }),
      };
    }),
    patch: vi.fn(async (id: string, data: Record<string, unknown>) => {
      patchCalls.push({ id, data });
    }),
  };

  return {
    db,
    _patchCalls: patchCalls,
  };
}

describe('recoverStuckExecutions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should recover executions stuck in running for >30 minutes', async () => {
    const stuckExecution = makeExecution({
      _id: 'exec_stuck',
      status: 'running',
      updatedAt: THIRTY_ONE_MINUTES_AGO,
    });
    const ctx = createMockCtx([stuckExecution]);

    const result = await recoverStuckExecutions(ctx as unknown as MutationCtx);

    expect(result.recovered).toBe(1);
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_stuck',
      expect.objectContaining({
        status: 'failed',
      }),
    );
    const patchData = ctx._patchCalls[0].data;
    const metadata = JSON.parse(patchData.metadata as string);
    expect(metadata.previousStatus).toBe('running');
    expect(metadata.error).toContain('timed out');
  });

  it('should NOT recover executions running for <30 minutes', async () => {
    const recentExecution = makeExecution({
      _id: 'exec_recent',
      status: 'running',
      updatedAt: TWENTY_MINUTES_AGO,
    });
    const ctx = createMockCtx([recentExecution]);

    const result = await recoverStuckExecutions(ctx as unknown as MutationCtx);

    expect(result.recovered).toBe(0);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('should recover stuck pending executions', async () => {
    const stuckPending = makeExecution({
      _id: 'exec_pending',
      status: 'pending',
      updatedAt: THIRTY_ONE_MINUTES_AGO,
    });
    const ctx = createMockCtx([stuckPending]);

    const result = await recoverStuckExecutions(ctx as unknown as MutationCtx);

    expect(result.recovered).toBe(1);
    const patchData = ctx._patchCalls[0].data;
    const metadata = JSON.parse(patchData.metadata as string);
    expect(metadata.previousStatus).toBe('pending');
  });

  it('should return 0 recovered when no stuck executions exist', async () => {
    const ctx = createMockCtx([]);

    const result = await recoverStuckExecutions(ctx as unknown as MutationCtx);

    expect(result.recovered).toBe(0);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('should not touch recently active executions among stuck ones', async () => {
    const stuck = makeExecution({
      _id: 'exec_stuck',
      status: 'running',
      updatedAt: THIRTY_ONE_MINUTES_AGO,
    });
    const active = makeExecution({
      _id: 'exec_active',
      status: 'running',
      updatedAt: FIVE_MINUTES_AGO,
    });
    const ctx = createMockCtx([stuck, active]);

    const result = await recoverStuckExecutions(ctx as unknown as MutationCtx);

    expect(result.recovered).toBe(1);
    expect(ctx._patchCalls[0].id).toBe('exec_stuck');
  });
});
