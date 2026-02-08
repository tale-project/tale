import { describe, it, expect, vi } from 'vitest';
import { deserializeVariablesInAction } from './deserialize_variables';

function createMockCtx(blobContent?: string) {
  return {
    storage: {
      get: vi
        .fn()
        .mockResolvedValue(
          blobContent !== undefined
            ? new Blob([blobContent], { type: 'application/json' })
            : null,
        ),
    },
  };
}

describe('deserializeVariablesInAction', () => {
  describe('null/undefined handling', () => {
    it('should return empty object for null input', async () => {
      const ctx = createMockCtx();

      const result = await deserializeVariablesInAction(ctx, null);

      expect(result).toEqual({});
    });

    it('should return empty object for undefined input', async () => {
      const ctx = createMockCtx();

      const result = await deserializeVariablesInAction(ctx, undefined);

      expect(result).toEqual({});
    });

    it('should return empty object for empty string', async () => {
      const ctx = createMockCtx();

      // Empty string is falsy, so should return {}
      const result = await deserializeVariablesInAction(ctx, '');

      expect(result).toEqual({});
    });
  });

  describe('inline JSON deserialization', () => {
    it('should parse inline JSON object', async () => {
      const ctx = createMockCtx();
      const variables = { name: 'test', count: 42 };

      const result = await deserializeVariablesInAction(
        ctx,
        JSON.stringify(variables),
      );

      expect(result).toEqual(variables);
    });

    it('should handle nested objects', async () => {
      const ctx = createMockCtx();
      const variables = { deep: { nested: { value: true } } };

      const result = await deserializeVariablesInAction(
        ctx,
        JSON.stringify(variables),
      );

      expect(result).toEqual(variables);
      expect(ctx.storage.get).not.toHaveBeenCalled();
    });

    it('should return empty object for non-object JSON values', async () => {
      const ctx = createMockCtx();

      const result = await deserializeVariablesInAction(ctx, '"string"');

      expect(result).toEqual({});
    });

    it('should throw for JSON null (null has no properties to check)', async () => {
      const ctx = createMockCtx();

      await expect(deserializeVariablesInAction(ctx, 'null')).rejects.toThrow();
    });
  });

  describe('storage reference deserialization', () => {
    it('should fetch from storage when _storageRef is present', async () => {
      const storedVars = { fromStorage: true, data: [1, 2, 3] };
      const ctx = createMockCtx(JSON.stringify(storedVars));

      const result = await deserializeVariablesInAction(
        ctx,
        JSON.stringify({ _storageRef: 'kg123abc' }),
      );

      expect(result).toEqual(storedVars);
      expect(ctx.storage.get).toHaveBeenCalledWith('kg123abc');
    });

    it('should throw when storage file is not found', async () => {
      const ctx = createMockCtx(); // returns null from storage.get

      await expect(
        deserializeVariablesInAction(
          ctx,
          JSON.stringify({ _storageRef: 'missing_id' }),
        ),
      ).rejects.toThrow('Variables storage file not found: missing_id');
    });
  });
});
