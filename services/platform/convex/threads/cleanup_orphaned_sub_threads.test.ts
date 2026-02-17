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

  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args: { threadId: string }) => {
      return threadMap.get(args.threadId) ?? null;
    }),
    runMutation: vi.fn(async (_ref: unknown, args: { threadId: string }) => {
      archivedIds.push(args.threadId);
    }),
  };

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test mock
  return { ctx: ctx as unknown as MutationCtx, archivedIds };
}

// oxlint-disable typescript/unbound-method -- vitest mock assertions require method references
describe('cleanupOrphanedSubThreads', () => {
  it('should archive all active sub-threads', async () => {
    const { ctx, archivedIds } = createMockCtx([
      { threadId: 'sub_1', status: 'active' },
      { threadId: 'sub_2', status: 'active' },
    ]);

    const result = await cleanupOrphanedSubThreads(ctx, 'parent_1', [
      'sub_1',
      'sub_2',
    ]);

    expect(result).toEqual({ archivedCount: 2 });
    expect(archivedIds).toEqual(['sub_1', 'sub_2']);
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
    expect(ctx.runMutation).toHaveBeenCalledTimes(2);
  });

  it('should skip already-archived sub-threads', async () => {
    const { ctx, archivedIds } = createMockCtx([
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
    expect(ctx.runQuery).toHaveBeenCalledTimes(3);
    expect(ctx.runMutation).toHaveBeenCalledTimes(2);
  });

  it('should skip sub-threads that do not exist', async () => {
    const { ctx, archivedIds } = createMockCtx([
      { threadId: 'sub_1', status: 'active' },
    ]);

    const result = await cleanupOrphanedSubThreads(ctx, 'parent_1', [
      'sub_1',
      'sub_nonexistent',
    ]);

    expect(result).toEqual({ archivedCount: 1 });
    expect(archivedIds).toEqual(['sub_1']);
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
  });

  it('should return zero when all sub-threads are already archived', async () => {
    const { ctx } = createMockCtx([
      { threadId: 'sub_1', status: 'archived' },
      { threadId: 'sub_2', status: 'archived' },
    ]);

    const result = await cleanupOrphanedSubThreads(ctx, 'parent_1', [
      'sub_1',
      'sub_2',
    ]);

    expect(result).toEqual({ archivedCount: 0 });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('should return zero for an empty sub-thread list', async () => {
    const { ctx } = createMockCtx([]);

    const result = await cleanupOrphanedSubThreads(ctx, 'parent_1', []);

    expect(result).toEqual({ archivedCount: 0 });
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
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
