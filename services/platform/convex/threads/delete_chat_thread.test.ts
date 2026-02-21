import { describe, it, expect, vi } from 'vitest';

import type { MutationCtx } from '../_generated/server';

import { deleteChatThread, parseSubThreadIds } from './delete_chat_thread';

describe('parseSubThreadIds', () => {
  it('should return empty array for undefined summary', () => {
    expect(parseSubThreadIds(undefined)).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(parseSubThreadIds('')).toEqual([]);
  });

  it('should return empty array for invalid JSON', () => {
    expect(parseSubThreadIds('not-json')).toEqual([]);
  });

  it('should return empty array for summary without subThreads', () => {
    const summary = JSON.stringify({ chatType: 'general' });
    expect(parseSubThreadIds(summary)).toEqual([]);
  });

  it('should return empty array for empty subThreads map', () => {
    const summary = JSON.stringify({ chatType: 'general', subThreads: {} });
    expect(parseSubThreadIds(summary)).toEqual([]);
  });

  it('should return sub-thread IDs from summary', () => {
    const summary = JSON.stringify({
      chatType: 'general',
      subThreads: {
        document_assistant: 'thread_1',
        crm_assistant: 'thread_2',
      },
    });
    const result = parseSubThreadIds(summary);
    expect(result).toHaveLength(2);
    expect(result).toContain('thread_1');
    expect(result).toContain('thread_2');
  });

  it('should handle single sub-thread', () => {
    const summary = JSON.stringify({
      chatType: 'general',
      subThreads: { workflow_assistant: 'thread_abc' },
    });
    expect(parseSubThreadIds(summary)).toEqual(['thread_abc']);
  });
});

describe('deleteChatThread', () => {
  function createMockCtx(threadSummary?: string) {
    const scheduledJobs: Array<{
      delay: number;
      args: Record<string, unknown>;
    }> = [];

    const mockRunQuery = vi
      .fn()
      .mockResolvedValue(
        threadSummary !== undefined
          ? { status: 'active', summary: threadSummary }
          : null,
      );
    const mockRunMutation = vi.fn().mockResolvedValue(undefined);
    const mockRunAfter = vi.fn(
      async (delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduledJobs.push({ delay, args });
      },
    );

    const mockPatch = vi.fn();
    const dbQueryChain = {
      withIndex: () => dbQueryChain,
      first: vi.fn().mockResolvedValue(null),
    };
    const mockDb = {
      query: () => dbQueryChain,
      patch: mockPatch,
    };

    const ctx = {
      runQuery: mockRunQuery,
      runMutation: mockRunMutation,
      scheduler: { runAfter: mockRunAfter },
      db: mockDb,
    } as unknown as MutationCtx;

    return {
      ctx,
      mockRunQuery,
      mockRunMutation,
      mockRunAfter,
      mockPatch,
      dbQueryChain,
      scheduledJobs,
    };
  }

  it('should archive the parent thread', async () => {
    const { ctx, mockRunMutation } = createMockCtx(
      JSON.stringify({ chatType: 'general' }),
    );

    await deleteChatThread(ctx, 'parent_1');

    expect(mockRunMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: 'parent_1',
        patch: { status: 'archived' },
      }),
    );
  });

  it('should archive threadMetadata when present', async () => {
    const summary = JSON.stringify({ chatType: 'general' });
    const { ctx, mockPatch, dbQueryChain } = createMockCtx(summary);
    const mockRecord = { _id: 'meta_1' };
    dbQueryChain.first.mockResolvedValue(mockRecord);

    await deleteChatThread(ctx, 'parent_1');

    expect(mockPatch).toHaveBeenCalledWith('meta_1', { status: 'archived' });
  });

  it('should not patch threadMetadata when not found', async () => {
    const summary = JSON.stringify({ chatType: 'general' });
    const { ctx, mockPatch } = createMockCtx(summary);

    await deleteChatThread(ctx, 'parent_1');

    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('should not schedule cleanup when no sub-threads exist', async () => {
    const { ctx, mockRunAfter } = createMockCtx(
      JSON.stringify({ chatType: 'general' }),
    );

    await deleteChatThread(ctx, 'parent_1');

    expect(mockRunAfter).not.toHaveBeenCalled();
  });

  it('should schedule async cleanup when sub-threads exist', async () => {
    const summary = JSON.stringify({
      chatType: 'general',
      subThreads: {
        document_assistant: 'sub_1',
        crm_assistant: 'sub_2',
      },
    });
    const { ctx, mockRunAfter, scheduledJobs } = createMockCtx(summary);

    await deleteChatThread(ctx, 'parent_1');

    expect(mockRunAfter).toHaveBeenCalledOnce();
    expect(scheduledJobs[0].delay).toBe(0);
    expect(scheduledJobs[0].args).toEqual({
      parentThreadId: 'parent_1',
      subThreadIds: expect.arrayContaining(['sub_1', 'sub_2']),
    });
  });

  it('should skip archiving and cleanup when thread is not found', async () => {
    const { ctx, mockRunMutation, mockRunAfter } = createMockCtx();

    await deleteChatThread(ctx, 'missing_thread');

    expect(mockRunMutation).not.toHaveBeenCalled();
    expect(mockRunAfter).not.toHaveBeenCalled();
  });
});
