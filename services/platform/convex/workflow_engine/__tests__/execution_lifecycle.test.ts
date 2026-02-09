/**
 * Integration tests for workflow execution lifecycle mutations
 *
 * Tests the pure logic of fail/complete/updateStatus by mocking ctx.db.
 */

import { describe, it, expect, vi } from 'vitest';

import { completeExecution } from '../../workflows/executions/complete_execution';
import { failExecution } from '../../workflows/executions/fail_execution';
import { updateExecutionStatus } from '../../workflows/executions/update_execution_status';

function createMockCtx() {
  const patchedData: Record<string, unknown>[] = [];
  const deletedStorageIds: string[] = [];
  const storedExecution: Record<string, unknown> = {
    _id: 'exec_1' as any,
    organizationId: 'org_1',
    status: 'running',
    variablesStorageId: undefined,
    outputStorageId: undefined,
  };

  return {
    db: {
      get: vi.fn().mockResolvedValue(storedExecution),
      patch: vi.fn(async (_id: any, data: Record<string, unknown>) => {
        patchedData.push(data);
        Object.assign(storedExecution, data);
      }),
    },
    storage: {
      delete: vi.fn(async (id: string) => {
        deletedStorageIds.push(id);
      }),
    },
    _patchedData: patchedData,
    _deletedStorageIds: deletedStorageIds,
    _storedExecution: storedExecution,
  };
}

describe('failExecution', () => {
  it('should set status to failed with error in metadata', async () => {
    const ctx = createMockCtx();

    await failExecution(ctx as any, {
      executionId: 'exec_1' as any,
      error: 'Something went wrong',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({
        status: 'failed',
        metadata: JSON.stringify({ error: 'Something went wrong' }),
      }),
    );
  });

  it('should set updatedAt timestamp', async () => {
    const ctx = createMockCtx();
    const before = Date.now();

    await failExecution(ctx as any, {
      executionId: 'exec_1' as any,
      error: 'error',
    });

    const patchCall = ctx.db.patch.mock.calls[0][1];
    expect(patchCall.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('should clean up storage if variablesStorageId exists', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'storage_abc';

    await failExecution(ctx as any, {
      executionId: 'exec_1' as any,
      error: 'error',
    });

    expect(ctx.storage.delete).toHaveBeenCalledWith('storage_abc');
  });

  it('should not delete storage if no variablesStorageId', async () => {
    const ctx = createMockCtx();

    await failExecution(ctx as any, {
      executionId: 'exec_1' as any,
      error: 'error',
    });

    expect(ctx.storage.delete).not.toHaveBeenCalled();
  });
});

describe('completeExecution', () => {
  it('should set status to completed with output', async () => {
    const ctx = createMockCtx();

    await completeExecution(ctx as any, {
      executionId: 'exec_1' as any,
      output: { result: 'success' },
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({
        status: 'completed',
        output: { result: 'success' },
      }),
    );
  });

  it('should set completedAt and updatedAt timestamps', async () => {
    const ctx = createMockCtx();
    const before = Date.now();

    await completeExecution(ctx as any, {
      executionId: 'exec_1' as any,
      output: {},
    });

    const patchCall = ctx.db.patch.mock.calls[0][1];
    expect(patchCall.completedAt).toBeGreaterThanOrEqual(before);
    expect(patchCall.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('should include variables when provided', async () => {
    const ctx = createMockCtx();

    await completeExecution(ctx as any, {
      executionId: 'exec_1' as any,
      output: {},
      variablesSerialized: '{"final": true}',
      variablesStorageId: 'new_storage' as any,
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({
        variables: '{"final": true}',
        variablesStorageId: 'new_storage',
      }),
    );
  });

  it('should clean up old storage when new storage differs', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'old_storage';

    await completeExecution(ctx as any, {
      executionId: 'exec_1' as any,
      output: {},
      variablesSerialized: '{}',
      variablesStorageId: 'new_storage' as any,
    });

    expect(ctx.storage.delete).toHaveBeenCalledWith('old_storage');
  });

  it('should not clean up storage when IDs match', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'same_storage';

    await completeExecution(ctx as any, {
      executionId: 'exec_1' as any,
      output: {},
      variablesSerialized: '{}',
      variablesStorageId: 'same_storage' as any,
    });

    expect(ctx._deletedStorageIds).not.toContain('same_storage');
  });
});

describe('updateExecutionStatus', () => {
  it('should update status', async () => {
    const ctx = createMockCtx();

    await updateExecutionStatus(ctx as any, {
      executionId: 'exec_1' as any,
      status: 'running',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({ status: 'running' }),
    );
  });

  it('should update currentStepSlug when provided', async () => {
    const ctx = createMockCtx();

    await updateExecutionStatus(ctx as any, {
      executionId: 'exec_1' as any,
      status: 'running',
      currentStepSlug: 'step_2',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({ currentStepSlug: 'step_2' }),
    );
  });

  it('should set completedAt when status is completed', async () => {
    const ctx = createMockCtx();
    const before = Date.now();

    await updateExecutionStatus(ctx as any, {
      executionId: 'exec_1' as any,
      status: 'completed',
    });

    const patchCall = ctx.db.patch.mock.calls[0][1];
    expect(patchCall.completedAt).toBeGreaterThanOrEqual(before);
  });

  it('should not set completedAt for non-completed status', async () => {
    const ctx = createMockCtx();

    await updateExecutionStatus(ctx as any, {
      executionId: 'exec_1' as any,
      status: 'failed',
    });

    const patchCall = ctx.db.patch.mock.calls[0][1];
    expect(patchCall.completedAt).toBeUndefined();
  });

  it('should store error in metadata when provided', async () => {
    const ctx = createMockCtx();

    await updateExecutionStatus(ctx as any, {
      executionId: 'exec_1' as any,
      status: 'failed',
      error: 'Timeout exceeded',
    });

    const patchCall = ctx.db.patch.mock.calls[0][1];
    expect(patchCall.metadata).toBe(
      JSON.stringify({ error: 'Timeout exceeded' }),
    );
  });

  it('should set waitingFor when provided', async () => {
    const ctx = createMockCtx();

    await updateExecutionStatus(ctx as any, {
      executionId: 'exec_1' as any,
      status: 'running',
      waitingFor: 'approval_task_123',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({ waitingFor: 'approval_task_123' }),
    );
  });
});
