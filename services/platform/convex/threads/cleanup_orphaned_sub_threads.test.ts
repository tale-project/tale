import { describe, it, expect, vi } from 'vitest';

import type { MutationCtx } from '../_generated/server';

import { cleanupOrphanedSubThreads } from './cleanup_orphaned_sub_threads';

type ThreadStatus = 'active' | 'archived';

interface MockThread {
  threadId: string;
  status: ThreadStatus;
}

function createMockCtx(threads: MockThread[]) {
  const threadMap = new Map(threads.map((t) => [t.threadId, t]));
  const archivedIds: string[] = [];

  const mockRunQuery = vi.fn(
    async (_ref: unknown, args: { threadId: string }) => {
      return threadMap.get(args.threadId) ?? null;
    },
  );
  const mockRunMutation = vi.fn(
    async (_ref: unknown, args: { threadId: string }) => {
      archivedIds.push(args.threadId);
    },
  );

  const ctx = {
    runQuery: mockRunQuery,
    runMutation: mockRunMutation,
  } as unknown as MutationCtx;

  return { ctx, mockRunQuery, mockRunMutation, archivedIds };
}

describe('cleanupOrphanedSubThreads', () => {
  it('should archive all active sub-threads', async () => {
    const { ctx, mockRunQuery, mockRunMutation, archivedIds } = createMockCtx([
      { threadId: 'sub_1', status: 'active' },
      { threadId: 'sub_2', status: 'active' },
    ]);

    const result = await cleanupOrphanedSubThreads(ctx, 'parent_1', [
      'sub_1',
      'sub_2',
    ]);

    expect(result).toEqual({ archivedCount: 2 });
    expect(archivedIds).toEqual(['sub_1', 'sub_2']);
    expect(mockRunQuery).toHaveBeenCalledTimes(2);
    expect(mockRunMutation).toHaveBeenCalledTimes(2);
  });

  it('should skip already-archived sub-threads', async () => {
    const { ctx, mockRunQuery, mockRunMutation, archivedIds } = createMockCtx([
      { threadId: 'sub_1', status: 'active' },
      { threadId: 'sub_2', status: 'archived' },
      { threadId: 'sub_3', status: 'active' },
    ]);

    const result = await cleanupOrphanedSubThreads(ctx, 'parent_1', [
      'sub_1',
      'sub_2',
      'sub_3',
    ]);

    expect(result).toEqual({ archivedCount: 2 });
    expect(archivedIds).toEqual(['sub_1', 'sub_3']);
    expect(mockRunQuery).toHaveBeenCalledTimes(3);
    expect(mockRunMutation).toHaveBeenCalledTimes(2);
  });

  it('should skip sub-threads that do not exist', async () => {
    const { ctx, mockRunQuery, mockRunMutation, archivedIds } = createMockCtx([
      { threadId: 'sub_1', status: 'active' },
    ]);

    const result = await cleanupOrphanedSubThreads(ctx, 'parent_1', [
      'sub_1',
      'sub_nonexistent',
    ]);

    expect(result).toEqual({ archivedCount: 1 });
    expect(archivedIds).toEqual(['sub_1']);
    expect(mockRunQuery).toHaveBeenCalledTimes(2);
    expect(mockRunMutation).toHaveBeenCalledTimes(1);
  });

  it('should return zero when all sub-threads are already archived', async () => {
    const { ctx, mockRunMutation } = createMockCtx([
      { threadId: 'sub_1', status: 'archived' },
      { threadId: 'sub_2', status: 'archived' },
    ]);

    const result = await cleanupOrphanedSubThreads(ctx, 'parent_1', [
      'sub_1',
      'sub_2',
    ]);

    expect(result).toEqual({ archivedCount: 0 });
    expect(mockRunMutation).not.toHaveBeenCalled();
  });

  it('should return zero for an empty sub-thread list', async () => {
    const { ctx, mockRunQuery, mockRunMutation } = createMockCtx([]);

    const result = await cleanupOrphanedSubThreads(ctx, 'parent_1', []);

    expect(result).toEqual({ archivedCount: 0 });
    expect(mockRunQuery).not.toHaveBeenCalled();
    expect(mockRunMutation).not.toHaveBeenCalled();
  });

  it('should handle a mix of active, archived, and nonexistent sub-threads', async () => {
    const { ctx, archivedIds } = createMockCtx([
      { threadId: 'sub_active', status: 'active' },
      { threadId: 'sub_archived', status: 'archived' },
    ]);

    const result = await cleanupOrphanedSubThreads(ctx, 'parent_1', [
      'sub_active',
      'sub_archived',
      'sub_missing',
    ]);

    expect(result).toEqual({ archivedCount: 1 });
    expect(archivedIds).toEqual(['sub_active']);
  });
});
