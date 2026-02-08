/**
 * Integration tests for workflow execution variable updates
 *
 * Tests updateExecutionVariables logic including storage cleanup.
 */

import { describe, it, expect, vi } from 'vitest';
import { updateExecutionVariables } from '../../workflows/executions/update_execution_variables';

function createMockCtx(executionOverrides: Record<string, unknown> = {}) {
  const execution = {
    _id: 'exec_1' as any,
    organizationId: 'org_1',
    status: 'running',
    variables: '{}',
    variablesStorageId: undefined,
    ...executionOverrides,
  };

  return {
    db: {
      get: vi.fn().mockResolvedValue(execution),
      patch: vi.fn(),
    },
    storage: {
      delete: vi.fn(),
    },
  };
}

describe('updateExecutionVariables', () => {
  describe('inline variable updates', () => {
    it('should patch execution with serialized variables', async () => {
      const ctx = createMockCtx();

      await updateExecutionVariables(ctx as any, {
        executionId: 'exec_1' as any,
        variablesSerialized: '{"updated": true}',
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        'exec_1',
        expect.objectContaining({
          variables: '{"updated": true}',
          updatedAt: expect.any(Number),
        }),
      );
    });

    it('should set variablesStorageId to undefined for inline updates', async () => {
      const ctx = createMockCtx();

      await updateExecutionVariables(ctx as any, {
        executionId: 'exec_1' as any,
        variablesSerialized: '{"inline": true}',
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        'exec_1',
        expect.objectContaining({
          variablesStorageId: undefined,
        }),
      );
    });
  });

  describe('storage variable updates', () => {
    it('should set new storage ID when provided', async () => {
      const ctx = createMockCtx();

      await updateExecutionVariables(ctx as any, {
        executionId: 'exec_1' as any,
        variablesSerialized: '{"_storageRef":"new_id"}',
        variablesStorageId: 'new_id' as any,
      });

      expect(ctx.db.patch).toHaveBeenCalledWith(
        'exec_1',
        expect.objectContaining({
          variablesStorageId: 'new_id',
        }),
      );
    });
  });

  describe('storage cleanup', () => {
    it('should delete old storage when transitioning from storage to inline', async () => {
      const ctx = createMockCtx({ variablesStorageId: 'old_storage' });

      await updateExecutionVariables(ctx as any, {
        executionId: 'exec_1' as any,
        variablesSerialized: '{"inline": true}',
      });

      expect(ctx.storage.delete).toHaveBeenCalledWith('old_storage');
    });

    it('should delete old storage when storage ID changes', async () => {
      const ctx = createMockCtx({ variablesStorageId: 'old_storage' });

      await updateExecutionVariables(ctx as any, {
        executionId: 'exec_1' as any,
        variablesSerialized: '{"_storageRef":"new_storage"}',
        variablesStorageId: 'new_storage' as any,
      });

      expect(ctx.storage.delete).toHaveBeenCalledWith('old_storage');
    });

    it('should not delete storage when IDs are the same', async () => {
      const ctx = createMockCtx({ variablesStorageId: 'same_id' });

      await updateExecutionVariables(ctx as any, {
        executionId: 'exec_1' as any,
        variablesSerialized: '{"_storageRef":"same_id"}',
        variablesStorageId: 'same_id' as any,
      });

      expect(ctx.storage.delete).not.toHaveBeenCalled();
    });

    it('should not delete anything when no old storage exists', async () => {
      const ctx = createMockCtx();

      await updateExecutionVariables(ctx as any, {
        executionId: 'exec_1' as any,
        variablesSerialized: '{}',
      });

      expect(ctx.storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should no-op when execution is deleted (null)', async () => {
      const ctx = createMockCtx();
      ctx.db.get.mockResolvedValue(null);

      const result = await updateExecutionVariables(ctx as any, {
        executionId: 'exec_1' as any,
        variablesSerialized: '{"data": true}',
      });

      expect(result).toBeNull();
      expect(ctx.db.patch).not.toHaveBeenCalled();
    });

    it('should no-op when no serialized variables provided', async () => {
      const ctx = createMockCtx();

      const result = await updateExecutionVariables(ctx as any, {
        executionId: 'exec_1' as any,
      });

      expect(result).toBeNull();
      expect(ctx.db.patch).not.toHaveBeenCalled();
    });
  });
});
