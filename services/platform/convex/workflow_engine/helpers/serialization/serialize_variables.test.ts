import { describe, it, expect, vi } from 'vitest';

import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';

import { serializeVariables, SIZE_THRESHOLD } from './serialize_variables';

function createMockCtx(
  storageId = 'mock_storage_id' as unknown as Id<'_storage'>,
) {
  const storeFn = vi.fn().mockResolvedValue(storageId);
  const ctx = {
    storage: {
      store: storeFn,
    },
  } as unknown as ActionCtx;
  return { ctx, storeFn };
}

describe('serializeVariables', () => {
  describe('inline serialization (< 400KB)', () => {
    it('should return inline JSON for small payloads', async () => {
      const { ctx, storeFn } = createMockCtx();
      const variables = { name: 'test', count: 42 };

      const result = await serializeVariables(ctx, variables);

      expect(result.serialized).toBe(JSON.stringify(variables));
      expect(result.storageId).toBeUndefined();
      expect(storeFn).not.toHaveBeenCalled();
    });

    it('should handle null variables', async () => {
      const { ctx } = createMockCtx();

      const result = await serializeVariables(ctx, null);

      expect(result.serialized).toBe('{}');
      expect(result.storageId).toBeUndefined();
    });

    it('should handle undefined variables', async () => {
      const { ctx } = createMockCtx();

      const result = await serializeVariables(ctx, undefined);

      expect(result.serialized).toBe('{}');
      expect(result.storageId).toBeUndefined();
    });

    it('should handle empty object', async () => {
      const { ctx } = createMockCtx();

      const result = await serializeVariables(ctx, {});

      expect(result.serialized).toBe('{}');
      expect(result.storageId).toBeUndefined();
    });
  });

  describe('storage serialization (>= 400KB)', () => {
    it('should store to storage when payload exceeds threshold', async () => {
      const { ctx, storeFn } = createMockCtx();
      const largeValue = 'x'.repeat(SIZE_THRESHOLD + 1000);
      const variables = { data: largeValue };

      const result = await serializeVariables(ctx, variables);

      expect(storeFn).toHaveBeenCalledOnce();
      expect(result.storageId).toBe('mock_storage_id');
      expect(JSON.parse(result.serialized)).toEqual({
        _storageRef: 'mock_storage_id',
      });
    });
  });

  describe('sticky storage (oldStorageId)', () => {
    it('should use storage even for small payloads when oldStorageId is provided', async () => {
      const { ctx, storeFn } = createMockCtx();
      const variables = { tiny: true };

      const result = await serializeVariables(
        ctx,
        variables,
        'old_id' as unknown as Id<'_storage'>,
      );

      expect(storeFn).toHaveBeenCalledOnce();
      expect(result.storageId).toBe('mock_storage_id');
    });

    it('should not use storage for small payloads without oldStorageId', async () => {
      const { ctx, storeFn } = createMockCtx();
      const variables = { tiny: true };

      const result = await serializeVariables(ctx, variables);

      expect(storeFn).not.toHaveBeenCalled();
      expect(result.storageId).toBeUndefined();
    });
  });

  describe('SIZE_THRESHOLD constant', () => {
    it('should be 400KB', () => {
      expect(SIZE_THRESHOLD).toBe(400 * 1024);
    });
  });
});
