/**
 * Integration tests for workflow execution lifecycle mutations
 *
 * Tests the pure logic of fail/complete/updateStatus/cleanupStorage by mocking ctx.db.
 */

import { describe, it, expect, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

import {
  cleanupExecutionStorage,
  STORAGE_RETENTION_MS,
} from '../../workflows/executions/cleanup_execution_storage';
import { completeExecution } from '../../workflows/executions/complete_execution';
import { failExecution } from '../../workflows/executions/fail_execution';
import { updateExecutionStatus } from '../../workflows/executions/update_execution_status';

function createMockCtx() {
  const patchedData: Record<string, unknown>[] = [];
  const deletedStorageIds: string[] = [];
  const scheduledJobs: { delay: number; args: Record<string, unknown> }[] = [];
  const storedExecution: Record<string, unknown> = {
    _id: 'exec_1' as Id<'wfExecutions'>,
    organizationId: 'org_1',
    status: 'running',
    variablesStorageId: undefined,
    outputStorageId: undefined,
  };

  return {
    db: {
      get: vi.fn().mockResolvedValue(storedExecution),
      patch: vi.fn(async (_id: string, data: Record<string, unknown>) => {
        patchedData.push(data);
        Object.assign(storedExecution, data);
      }),
    },
    storage: {
      delete: vi.fn(async (id: string) => {
        deletedStorageIds.push(id);
      }),
    },
    scheduler: {
      runAfter: vi.fn(
        async (delay: number, _fn: unknown, args: Record<string, unknown>) => {
          scheduledJobs.push({ delay, args });
        },
      ),
    },
    _patchedData: patchedData,
    _deletedStorageIds: deletedStorageIds,
    _scheduledJobs: scheduledJobs,
    _storedExecution: storedExecution,
  };
}

describe('failExecution', () => {
  it('should set status to failed with error in metadata', async () => {
    const ctx = createMockCtx();

    await failExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
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

    await failExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      error: 'error',
    });

    const patchCall = ctx.db.patch.mock.calls[0][1];
    expect(patchCall.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('should schedule storage cleanup after 30 days if variablesStorageId exists', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'storage_abc';

    await failExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      error: 'error',
    });

    expect(ctx.storage.delete).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      STORAGE_RETENTION_MS,
      expect.anything(),
      expect.objectContaining({
        executionId: 'exec_1',
        variablesStorageId: 'storage_abc',
      }),
    );
  });

  it('should not schedule cleanup if no storage IDs', async () => {
    const ctx = createMockCtx();

    await failExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      error: 'error',
    });

    expect(ctx.storage.delete).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});

describe('completeExecution', () => {
  it('should set status to completed with output', async () => {
    const ctx = createMockCtx();

    await completeExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
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

    await completeExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      output: {},
    });

    const patchCall = ctx.db.patch.mock.calls[0][1];
    expect(patchCall.completedAt).toBeGreaterThanOrEqual(before);
    expect(patchCall.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('should include variables when provided', async () => {
    const ctx = createMockCtx();

    await completeExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      output: {},
      variablesSerialized: '{"final": true}',
      variablesStorageId: 'new_storage' as Id<'_storage'>,
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({
        variables: '{"final": true}',
        variablesStorageId: 'new_storage',
      }),
    );
  });

  it('should immediately delete old storage when replaced by different storage', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'old_storage';

    await completeExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      output: {},
      variablesSerialized: '{}',
      variablesStorageId: 'new_storage' as Id<'_storage'>,
    });

    expect(ctx.storage.delete).toHaveBeenCalledWith('old_storage');
  });

  it('should not immediately delete storage when IDs match', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'same_storage';

    await completeExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      output: {},
      variablesSerialized: '{}',
      variablesStorageId: 'same_storage' as Id<'_storage'>,
    });

    expect(ctx._deletedStorageIds).not.toContain('same_storage');
  });

  it('should NOT immediately delete storage when no replacement is provided', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'existing_storage';

    await completeExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      output: {},
    });

    expect(ctx.storage.delete).not.toHaveBeenCalled();
  });

  it('should schedule 30-day cleanup for final storage IDs', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'var_storage';
    ctx._storedExecution.outputStorageId = 'out_storage';

    await completeExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      output: {},
    });

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      STORAGE_RETENTION_MS,
      expect.anything(),
      expect.objectContaining({
        executionId: 'exec_1',
        variablesStorageId: 'var_storage',
        outputStorageId: 'out_storage',
      }),
    );
  });

  it('should schedule cleanup for new storage when replacing', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'old_storage';

    await completeExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      output: {},
      variablesSerialized: '{}',
      variablesStorageId: 'new_storage' as Id<'_storage'>,
      outputStorageId: 'out_storage' as Id<'_storage'>,
    });

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      STORAGE_RETENTION_MS,
      expect.anything(),
      expect.objectContaining({
        executionId: 'exec_1',
        variablesStorageId: 'new_storage',
        outputStorageId: 'out_storage',
      }),
    );
  });

  it('should not schedule cleanup when no storage IDs exist', async () => {
    const ctx = createMockCtx();

    await completeExecution(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      output: {},
    });

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});

describe('cleanupExecutionStorage', () => {
  it('should delete blobs when IDs match current execution storage', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'var_storage';
    ctx._storedExecution.outputStorageId = 'out_storage';

    await cleanupExecutionStorage(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      variablesStorageId: 'var_storage' as Id<'_storage'>,
      outputStorageId: 'out_storage' as Id<'_storage'>,
    });

    expect(ctx.storage.delete).toHaveBeenCalledWith('var_storage');
    expect(ctx.storage.delete).toHaveBeenCalledWith('out_storage');
    expect(ctx.db.patch).toHaveBeenCalledWith('exec_1', {
      variablesStorageId: undefined,
    });
    expect(ctx.db.patch).toHaveBeenCalledWith('exec_1', {
      outputStorageId: undefined,
    });
  });

  it('should skip deletion when IDs do not match (execution was re-run)', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'newer_var_storage';
    ctx._storedExecution.outputStorageId = 'newer_out_storage';

    await cleanupExecutionStorage(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      variablesStorageId: 'old_var_storage' as Id<'_storage'>,
      outputStorageId: 'old_out_storage' as Id<'_storage'>,
    });

    expect(ctx.storage.delete).not.toHaveBeenCalled();
  });

  it('should handle missing execution gracefully', async () => {
    const ctx = createMockCtx();
    ctx.db.get.mockResolvedValue(null);

    const result = await cleanupExecutionStorage(
      ctx as unknown as MutationCtx,
      {
        executionId: 'exec_1' as Id<'wfExecutions'>,
        variablesStorageId: 'var_storage' as Id<'_storage'>,
      },
    );

    expect(result).toBeNull();
    expect(ctx.storage.delete).not.toHaveBeenCalled();
  });

  it('should handle already-deleted blobs gracefully', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'var_storage';
    ctx.storage.delete.mockRejectedValueOnce(new Error('Not found'));

    await cleanupExecutionStorage(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      variablesStorageId: 'var_storage' as Id<'_storage'>,
    });

    expect(ctx.db.patch).toHaveBeenCalledWith('exec_1', {
      variablesStorageId: undefined,
    });
  });

  it('should only delete variables storage when only it is provided', async () => {
    const ctx = createMockCtx();
    ctx._storedExecution.variablesStorageId = 'var_storage';
    ctx._storedExecution.outputStorageId = 'out_storage';

    await cleanupExecutionStorage(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      variablesStorageId: 'var_storage' as Id<'_storage'>,
    });

    expect(ctx.storage.delete).toHaveBeenCalledWith('var_storage');
    expect(ctx.storage.delete).not.toHaveBeenCalledWith('out_storage');
  });
});

describe('updateExecutionStatus', () => {
  it('should update status', async () => {
    const ctx = createMockCtx();

    await updateExecutionStatus(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      status: 'running',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({ status: 'running' }),
    );
  });

  it('should update currentStepSlug when provided', async () => {
    const ctx = createMockCtx();

    await updateExecutionStatus(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
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

    await updateExecutionStatus(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      status: 'completed',
    });

    const patchCall = ctx.db.patch.mock.calls[0][1];
    expect(patchCall.completedAt).toBeGreaterThanOrEqual(before);
  });

  it('should not set completedAt for non-completed status', async () => {
    const ctx = createMockCtx();

    await updateExecutionStatus(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      status: 'failed',
    });

    const patchCall = ctx.db.patch.mock.calls[0][1];
    expect(patchCall.completedAt).toBeUndefined();
  });

  it('should store error in metadata when provided', async () => {
    const ctx = createMockCtx();

    await updateExecutionStatus(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
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

    await updateExecutionStatus(ctx as unknown as MutationCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
      status: 'running',
      waitingFor: 'approval_task_123',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({ waitingFor: 'approval_task_123' }),
    );
  });
});
