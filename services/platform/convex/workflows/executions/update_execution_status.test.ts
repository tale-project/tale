import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { updateExecutionStatus } from './update_execution_status';

const executionId = 'exec_1' as Id<'wfExecutions'>;

function mockCtx(executionDoc: Partial<Doc<'wfExecutions'>> | null = null) {
  return {
    db: {
      get: vi.fn(async (_id: string) => executionDoc),
      patch: vi.fn(async (_id: string, _data: unknown) => undefined),
    },
  };
}

describe('updateExecutionStatus', () => {
  it('persists error at the top level and merges it into metadata', async () => {
    const ctx = mockCtx({
      metadata: JSON.stringify({ componentWorkflowIds: ['wf_component_1'] }),
    });

    await updateExecutionStatus(ctx as unknown as MutationCtx, {
      executionId,
      status: 'failed',
      error: 'canceled',
      errorCode: 'canceled',
    });

    expect(ctx.db.patch).toHaveBeenCalledTimes(1);
    const data = ctx.db.patch.mock.calls[0][1] as Record<string, unknown>;
    expect(data.status).toBe('failed');
    expect(data.error).toBe('canceled');
    expect(data.errorCode).toBe('canceled');
    expect(JSON.parse(String(data.metadata))).toEqual({
      componentWorkflowIds: ['wf_component_1'],
      error: 'canceled',
    });
  });

  it('sets completedAt for the failed status, not only completed', async () => {
    const ctx = mockCtx();

    await updateExecutionStatus(ctx as unknown as MutationCtx, {
      executionId,
      status: 'failed',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({ completedAt: expect.any(Number) }),
    );
  });

  it('does not read the document or touch metadata when no error is passed', async () => {
    const ctx = mockCtx();

    await updateExecutionStatus(ctx as unknown as MutationCtx, {
      executionId,
      status: 'running',
      currentStepSlug: 'step_2',
    });

    expect(ctx.db.get).not.toHaveBeenCalled();
    const data = ctx.db.patch.mock.calls[0][1] as Record<string, unknown>;
    expect('metadata' in data).toBe(false);
    expect('completedAt' in data).toBe(false);
  });
});
