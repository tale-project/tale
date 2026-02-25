import type { WorkflowManager } from '@convex-dev/workflow';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { Id } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';

import { recoverStuckExecutions } from './recover_stuck_executions';

const NOW = new Date('2026-02-12T12:00:00Z').getTime();
const SEVEN_HOURS_AGO = NOW - 7 * 60 * 60 * 1000;
const FIVE_HOURS_AGO = NOW - 5 * 60 * 60 * 1000;
const TWO_HOURS_AGO = NOW - 2 * 60 * 60 * 1000;
const FIVE_MINUTES_AGO = NOW - 5 * 60 * 1000;

function makeExecution(
  overrides: Partial<{
    _id: string;
    status: string;
    updatedAt: number;
    componentWorkflowId: string;
    shardIndex: number;
    workflowConfig: string;
  }> = {},
) {
  return {
    _id: overrides._id ?? ('exec_1' as Id<'wfExecutions'>),
    status: overrides.status ?? 'running',
    updatedAt: overrides.updatedAt ?? SEVEN_HOURS_AGO,
    organizationId: 'org_1',
    wfDefinitionId: 'def_1',
    currentStepSlug: 'step_1',
    startedAt: SEVEN_HOURS_AGO,
    componentWorkflowId: overrides.componentWorkflowId,
    shardIndex: overrides.shardIndex,
    workflowConfig: overrides.workflowConfig,
  };
}

function createMockManagers() {
  const cancelCalls: Array<{ managerIndex: number; workflowId: unknown }> = [];
  const managers = Array.from({ length: 4 }, (_, i) => ({
    cancel: vi.fn(async (_ctx: unknown, workflowId: unknown) => {
      cancelCalls.push({ managerIndex: i, workflowId });
    }),
  }));
  return {
    managers: managers as unknown as WorkflowManager[],
    _cancelCalls: cancelCalls,
  };
}

function createMockCtx(executions: ReturnType<typeof makeExecution>[]) {
  const patchCalls: Array<{ id: string; data: Record<string, unknown> }> = [];
  const schedulerCalls: Array<{
    delay: number;
    fn: unknown;
    args: unknown;
  }> = [];

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

  const scheduler = {
    runAfter: vi.fn(async (delay: number, fn: unknown, args: unknown) => {
      schedulerCalls.push({ delay, fn, args });
    }),
  };

  return {
    db,
    scheduler,
    _patchCalls: patchCalls,
    _schedulerCalls: schedulerCalls,
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

  it('should recover executions stuck in running for >6 hours (default timeout)', async () => {
    const stuckExecution = makeExecution({
      _id: 'exec_stuck',
      status: 'running',
      updatedAt: SEVEN_HOURS_AGO,
    });
    const ctx = createMockCtx([stuckExecution]);
    const { managers } = createMockManagers();

    const result = await recoverStuckExecutions(
      ctx as unknown as MutationCtx,
      managers,
    );

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
    expect(metadata.error).toContain('360 minutes');
  });

  it('should NOT recover executions running for <6 hours', async () => {
    const recentExecution = makeExecution({
      _id: 'exec_recent',
      status: 'running',
      updatedAt: FIVE_HOURS_AGO,
    });
    const ctx = createMockCtx([recentExecution]);
    const { managers } = createMockManagers();

    const result = await recoverStuckExecutions(
      ctx as unknown as MutationCtx,
      managers,
    );

    expect(result.recovered).toBe(0);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('should recover stuck pending executions', async () => {
    const stuckPending = makeExecution({
      _id: 'exec_pending',
      status: 'pending',
      updatedAt: SEVEN_HOURS_AGO,
    });
    const ctx = createMockCtx([stuckPending]);
    const { managers } = createMockManagers();

    const result = await recoverStuckExecutions(
      ctx as unknown as MutationCtx,
      managers,
    );

    expect(result.recovered).toBe(1);
    const patchData = ctx._patchCalls[0].data;
    const metadata = JSON.parse(patchData.metadata as string);
    expect(metadata.previousStatus).toBe('pending');
  });

  it('should return 0 recovered when no stuck executions exist', async () => {
    const ctx = createMockCtx([]);
    const { managers } = createMockManagers();

    const result = await recoverStuckExecutions(
      ctx as unknown as MutationCtx,
      managers,
    );

    expect(result.recovered).toBe(0);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('should not touch recently active executions among stuck ones', async () => {
    const stuck = makeExecution({
      _id: 'exec_stuck',
      status: 'running',
      updatedAt: SEVEN_HOURS_AGO,
    });
    const active = makeExecution({
      _id: 'exec_active',
      status: 'running',
      updatedAt: FIVE_MINUTES_AGO,
    });
    const ctx = createMockCtx([stuck, active]);
    const { managers } = createMockManagers();

    const result = await recoverStuckExecutions(
      ctx as unknown as MutationCtx,
      managers,
    );

    expect(result.recovered).toBe(1);
    expect(ctx._patchCalls[0].id).toBe('exec_stuck');
  });

  it('should use per-workflow timeout from workflowConfig', async () => {
    const oneHourMs = 60 * 60 * 1000;
    const execution = makeExecution({
      _id: 'exec_custom_timeout',
      status: 'running',
      updatedAt: TWO_HOURS_AGO,
      workflowConfig: JSON.stringify({
        name: 'Short Workflow',
        config: { timeout: oneHourMs },
      }),
    });
    const ctx = createMockCtx([execution]);
    const { managers } = createMockManagers();

    const result = await recoverStuckExecutions(
      ctx as unknown as MutationCtx,
      managers,
    );

    expect(result.recovered).toBe(1);
    const metadata = JSON.parse(ctx._patchCalls[0].data.metadata as string);
    expect(metadata.error).toContain('60 minutes');
  });

  it('should NOT recover execution within its per-workflow timeout', async () => {
    const tenHoursMs = 10 * 60 * 60 * 1000;
    const execution = makeExecution({
      _id: 'exec_long',
      status: 'running',
      updatedAt: SEVEN_HOURS_AGO,
      workflowConfig: JSON.stringify({
        name: 'Long Workflow',
        config: { timeout: tenHoursMs },
      }),
    });
    const ctx = createMockCtx([execution]);
    const { managers } = createMockManagers();

    const result = await recoverStuckExecutions(
      ctx as unknown as MutationCtx,
      managers,
    );

    expect(result.recovered).toBe(0);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('should cancel the component workflow when recovering', async () => {
    const execution = makeExecution({
      _id: 'exec_cancel',
      status: 'running',
      updatedAt: SEVEN_HOURS_AGO,
      componentWorkflowId: 'wf_component_123',
      shardIndex: 2,
    });
    const ctx = createMockCtx([execution]);
    const { managers, _cancelCalls } = createMockManagers();

    await recoverStuckExecutions(ctx as unknown as MutationCtx, managers);

    expect(_cancelCalls).toHaveLength(1);
    expect(_cancelCalls[0].managerIndex).toBe(2);
    expect(_cancelCalls[0].workflowId).toBe('wf_component_123');
  });

  it('should schedule cleanup after cancelling component workflow', async () => {
    const execution = makeExecution({
      _id: 'exec_cleanup',
      status: 'running',
      updatedAt: SEVEN_HOURS_AGO,
      componentWorkflowId: 'wf_component_456',
      shardIndex: 1,
    });
    const ctx = createMockCtx([execution]);
    const { managers } = createMockManagers();

    await recoverStuckExecutions(ctx as unknown as MutationCtx, managers);

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      10_000,
      expect.anything(),
      { workflowId: 'wf_component_456', shardIndex: 1 },
    );
  });

  it('should gracefully handle executions without componentWorkflowId', async () => {
    const execution = makeExecution({
      _id: 'exec_no_component',
      status: 'running',
      updatedAt: SEVEN_HOURS_AGO,
    });
    const ctx = createMockCtx([execution]);
    const { managers, _cancelCalls } = createMockManagers();

    const result = await recoverStuckExecutions(
      ctx as unknown as MutationCtx,
      managers,
    );

    expect(result.recovered).toBe(1);
    expect(_cancelCalls).toHaveLength(0);
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});
