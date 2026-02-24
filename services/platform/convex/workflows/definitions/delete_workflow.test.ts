import { describe, expect, it, vi } from 'vitest';

import type { MutationCtx } from '../../_generated/server';

import { deleteTriggerLogsBatch } from './delete_workflow';

type MockId = string;

function asyncIterable<T>(items: T[]) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) {
            return { value: items[i++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

function createMockCtx(triggerLogs: Array<{ _id: string }>) {
  const deletedIds: string[] = [];

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue(asyncIterable(triggerLogs)),
      }),
      delete: vi.fn().mockImplementation(async (id: string) => {
        deletedIds.push(id);
      }),
    },
  };

  return { ctx, deletedIds };
}

describe('deleteTriggerLogsBatch', () => {
  it('returns hasMore: false when no trigger logs exist', async () => {
    const { ctx } = createMockCtx([]);

    const result = await deleteTriggerLogsBatch(
      ctx as unknown as MutationCtx,
      'wf_1' as MockId as never,
    );

    expect(result).toEqual({ hasMore: false });
  });

  it('deletes trigger logs and returns hasMore: false within batch', async () => {
    const logs = Array.from({ length: 5 }, (_, i) => ({ _id: `log_${i}` }));
    const { ctx, deletedIds } = createMockCtx(logs);

    const result = await deleteTriggerLogsBatch(
      ctx as unknown as MutationCtx,
      'wf_1' as MockId as never,
    );

    expect(result).toEqual({ hasMore: false });
    expect(deletedIds).toHaveLength(5);
  });

  it('returns hasMore: true when batch size exceeded', async () => {
    const logs = Array.from({ length: 501 }, (_, i) => ({ _id: `log_${i}` }));
    const { ctx, deletedIds } = createMockCtx(logs);

    const result = await deleteTriggerLogsBatch(
      ctx as unknown as MutationCtx,
      'wf_1' as MockId as never,
    );

    expect(result).toEqual({ hasMore: true });
    expect(deletedIds).toHaveLength(500);
  });
});
