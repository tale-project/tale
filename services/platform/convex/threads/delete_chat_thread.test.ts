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
    const mockDelete = vi.fn();

    // `.first()` result shared by the legal-hold + threadMetadata lookups.
    let firstResult: unknown = null;
    // Rows yielded by the cascade `for await` loops, keyed by the table name
    // passed to `ctx.db.query(<table>)`. Keeping them per-table lets the
    // agentWebhookUserThreads and slackThreads cascades iterate independent
    // sets instead of sharing one chain (which would double-delete).
    const tableRows: Record<string, Array<{ _id: string }>> = {};

    const mockDb = {
      query: (tableName: string) => ({
        withIndex() {
          return this;
        },
        first: async () => firstResult,
        collect: async () => tableRows[tableName] ?? [],
        async *[Symbol.asyncIterator](): AsyncGenerator<
          { _id: string },
          void,
          unknown
        > {
          for (const row of tableRows[tableName] ?? []) yield row;
        },
      }),
      patch: mockPatch,
      delete: mockDelete,
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
      mockDelete,
      scheduledJobs,
      setFirst: (value: unknown) => {
        firstResult = value;
      },
      setTableRows: (table: string, rows: Array<{ _id: string }>) => {
        tableRows[table] = rows;
      },
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

  it('should soft-trash threadMetadata when present (user-trash mode)', async () => {
    const summary = JSON.stringify({ chatType: 'general' });
    const { ctx, mockPatch, setFirst } = createMockCtx(summary);
    // `.first()` is consulted for legalHolds (org undefined → skipped) and for
    // the threadMetadata lookup; both share this record.
    const mockRecord = { _id: 'meta_1', organizationId: undefined };
    setFirst(mockRecord);

    await deleteChatThread(ctx, 'parent_1');

    // Default mode is 'user-trash': flips status to 'trashed' AND sets
    // statusChangedAt. We don't pin the timestamp so just assert shape.
    expect(mockPatch).toHaveBeenCalledWith(
      'meta_1',
      expect.objectContaining({
        status: 'trashed',
        statusChangedAt: expect.any(Number),
      }),
    );
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

  it('should cascade-delete agentWebhookUserThreads mapping rows that point at this thread', async () => {
    const { ctx, mockDelete, setTableRows } = createMockCtx(
      JSON.stringify({ chatType: 'general' }),
    );
    // The webhook cascade iterates via `for await` over the thread-scoped
    // index. Yield two webhook mappings; `.first()` returns null so the
    // threadMetadata trash path is skipped, and no slackThreads rows exist.
    setTableRows('agentWebhookUserThreads', [
      { _id: 'mapping_a' },
      { _id: 'mapping_b' },
    ]);

    await deleteChatThread(ctx, 'parent_1');

    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenNthCalledWith(1, 'mapping_a');
    expect(mockDelete).toHaveBeenNthCalledWith(2, 'mapping_b');
  });

  it('should cascade-delete slackThreads mapping rows that point at this thread', async () => {
    // Regression for the trashed-thread resurrection bug: user-trash must drop
    // the Slack-conversation → threadId mapping, otherwise the next inbound
    // Slack message resolves the stale mapping and writes into the tombstone.
    const { ctx, mockDelete, setTableRows } = createMockCtx(
      JSON.stringify({ chatType: 'general' }),
    );
    setTableRows('slackThreads', [{ _id: 'slack_a' }, { _id: 'slack_b' }]);

    await deleteChatThread(ctx, 'parent_1');

    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenNthCalledWith(1, 'slack_a');
    expect(mockDelete).toHaveBeenNthCalledWith(2, 'slack_b');
  });

  it('cascades both webhook and slack mappings independently in one trash', async () => {
    const { ctx, mockDelete, setTableRows } = createMockCtx(
      JSON.stringify({ chatType: 'general' }),
    );
    setTableRows('agentWebhookUserThreads', [{ _id: 'wh_1' }]);
    setTableRows('slackThreads', [{ _id: 'sl_1' }]);

    await deleteChatThread(ctx, 'parent_1');

    // Webhook cascade runs first, then the Slack cascade — each over its own
    // row set, so neither double-deletes the other's mappings.
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenNthCalledWith(1, 'wh_1');
    expect(mockDelete).toHaveBeenNthCalledWith(2, 'sl_1');
  });
});
