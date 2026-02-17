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
        web_assistant: 'thread_1',
        document_assistant: 'thread_2',
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

// oxlint-disable typescript/unbound-method -- vitest mock assertions require method references
describe('deleteChatThread', () => {
  function createMockCtx(threadSummary?: string) {
    const scheduledJobs: Array<{
      delay: number;
      args: Record<string, unknown>;
    }> = [];

    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValue(
          threadSummary !== undefined
            ? { status: 'active', summary: threadSummary }
            : null,
        ),
      runMutation: vi.fn().mockResolvedValue(undefined),
      scheduler: {
        runAfter: vi.fn(
          async (
            delay: number,
            _ref: unknown,
            args: Record<string, unknown>,
          ) => {
            scheduledJobs.push({ delay, args });
          },
        ),
      },
    };

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test mock
    return { ctx: ctx as unknown as MutationCtx, scheduledJobs };
  }

  it('should archive the parent thread', async () => {
    const { ctx } = createMockCtx(JSON.stringify({ chatType: 'general' }));

    await deleteChatThread(ctx, 'parent_1');

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: 'parent_1',
        patch: { status: 'archived' },
      }),
    );
  });

  it('should not schedule cleanup when no sub-threads exist', async () => {
    const { ctx } = createMockCtx(JSON.stringify({ chatType: 'general' }));

    await deleteChatThread(ctx, 'parent_1');

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('should schedule async cleanup when sub-threads exist', async () => {
    const summary = JSON.stringify({
      chatType: 'general',
      subThreads: {
        web_assistant: 'sub_1',
        document_assistant: 'sub_2',
      },
    });
    const { ctx, scheduledJobs } = createMockCtx(summary);

    await deleteChatThread(ctx, 'parent_1');

    expect(ctx.scheduler.runAfter).toHaveBeenCalledOnce();
    expect(scheduledJobs[0].delay).toBe(0);
    expect(scheduledJobs[0].args).toEqual({
      parentThreadId: 'parent_1',
      subThreadIds: expect.arrayContaining(['sub_1', 'sub_2']),
    });
  });

  it('should skip archiving and cleanup when thread is not found', async () => {
    const { ctx } = createMockCtx();

    await deleteChatThread(ctx, 'missing_thread');

    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});
