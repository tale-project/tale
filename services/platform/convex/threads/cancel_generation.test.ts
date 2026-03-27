import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { MutationCtx } from '../_generated/server';

const mockAbortStream = vi.fn();
const mockListStreams = vi.fn();
const mockListMessages = vi.fn();

vi.mock('@convex-dev/agent', () => ({
  abortStream: (...args: unknown[]) => mockAbortStream(...args),
  listStreams: (...args: unknown[]) => mockListStreams(...args),
  listMessages: (...args: unknown[]) => mockListMessages(...args),
}));

vi.mock('../_generated/api', () => ({
  components: {
    agent: {
      threads: { getThread: 'mock-getThread' },
      messages: { updateMessage: 'mock-updateMessage' },
    },
  },
}));

import { cancelGeneration } from './cancel_generation';

function createMockCtx(
  thread: Record<string, unknown> | null = {
    userId: 'user_1',
    status: 'active',
  },
  threadMeta: Record<string, unknown> | null = null,
) {
  const mockQuery = {
    withIndex: vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue(threadMeta),
    }),
  };
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(thread),
    runMutation: vi.fn().mockResolvedValue(undefined),
    db: {
      query: vi.fn().mockReturnValue(mockQuery),
      patch: vi.fn().mockResolvedValue(undefined),
    },
  };
  return ctx;
}

// ============================================================================
// Happy path
// ============================================================================

describe('cancelGeneration — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListStreams.mockResolvedValue([]);
    mockAbortStream.mockResolvedValue(undefined);
    mockListMessages.mockResolvedValue({ page: [] });
  });

  it('validates thread ownership and aborts active streams', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListStreams.mockResolvedValue([
      { streamId: 'stream_1' },
      { streamId: 'stream_2' },
    ]);

    await cancelGeneration(ctx as unknown as MutationCtx, 'user_1', 'thread_1');

    // Thread lookup
    expect(ctx.runQuery).toHaveBeenCalledWith('mock-getThread', {
      threadId: 'thread_1',
    });

    // Should list active streams
    expect(mockListStreams).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      expect.objectContaining({
        threadId: 'thread_1',
        includeStatuses: ['streaming'],
      }),
    );

    // Should abort both streams
    expect(mockAbortStream).toHaveBeenCalledTimes(2);
    expect(mockAbortStream).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      expect.objectContaining({
        streamId: 'stream_1',
        reason: 'user-cancelled',
      }),
    );
    expect(mockAbortStream).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      expect.objectContaining({
        streamId: 'stream_2',
        reason: 'user-cancelled',
      }),
    );
  });

  it('marks assistant message as success with displayedContent (ChatGPT-style)', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({
      page: [
        {
          _id: 'msg_1',
          message: { role: 'assistant', content: 'Full long response...' },
          text: 'Full long response...',
        },
      ],
    });

    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      'Full long',
    );

    expect(ctx.runMutation).toHaveBeenCalledWith('mock-updateMessage', {
      messageId: 'msg_1',
      patch: {
        message: {
          role: 'assistant',
          content: 'Full long',
        },
        status: 'success',
      },
    });
  });

  it('sets status to failed when displayedContent is null (no content shown)', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({
      page: [
        {
          _id: 'msg_1',
          message: { role: 'assistant', content: 'Some response' },
          text: 'Some response',
        },
      ],
    });

    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      null,
    );

    expect(mockListMessages).toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalledWith('mock-updateMessage', {
      messageId: 'msg_1',
      patch: { status: 'failed' },
    });
  });

  it('sets status to failed when displayedContent is undefined', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({
      page: [
        {
          _id: 'msg_1',
          message: { role: 'assistant', content: 'Some response' },
          text: 'Some response',
        },
      ],
    });

    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      undefined,
    );

    expect(mockListMessages).toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalledWith('mock-updateMessage', {
      messageId: 'msg_1',
      patch: { status: 'failed' },
    });
  });

  it('handles no active streams gracefully', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListStreams.mockResolvedValue([]);
    mockListMessages.mockResolvedValue({ page: [] });

    await cancelGeneration(ctx as unknown as MutationCtx, 'user_1', 'thread_1');

    expect(mockAbortStream).not.toHaveBeenCalled();
    expect(mockListMessages).toHaveBeenCalled();
  });

  it('finds latest assistant message among multiple messages', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({
      page: [
        {
          _id: 'msg_3',
          message: { role: 'assistant', content: 'Latest response' },
          text: 'Latest response',
        },
        {
          _id: 'msg_2',
          message: { role: 'user', content: 'User question' },
          text: 'User question',
        },
        {
          _id: 'msg_1',
          message: { role: 'assistant', content: 'Earlier response' },
          text: 'Earlier response',
        },
      ],
    });

    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      'Latest',
    );

    // Should update the FIRST assistant message found (latest in page order)
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-updateMessage',
      expect.objectContaining({ messageId: 'msg_3' }),
    );
  });

  it('sets cancelledAt on threadMetadata', async () => {
    const meta = {
      _id: 'meta_1',
      generationStatus: 'generating',
      streamId: 'stream_1',
    };
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' }, meta);

    await cancelGeneration(ctx as unknown as MutationCtx, 'user_1', 'thread_1');

    expect(ctx.db.patch).toHaveBeenCalledWith('meta_1', {
      cancelledAt: expect.any(Number),
      generationStatus: 'idle',
      streamId: undefined,
    });
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('cancelGeneration — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListStreams.mockResolvedValue([]);
    mockAbortStream.mockResolvedValue(undefined);
    mockListMessages.mockResolvedValue({ page: [] });
  });

  it('throws when thread is not found', async () => {
    const ctx = createMockCtx(null);

    await expect(
      cancelGeneration(
        ctx as unknown as MutationCtx,
        'user_1',
        'nonexistent_thread',
      ),
    ).rejects.toThrow('Thread not found');
  });

  it('throws when thread belongs to a different user', async () => {
    const ctx = createMockCtx({ userId: 'other_user', status: 'active' });

    await expect(
      cancelGeneration(ctx as unknown as MutationCtx, 'user_1', 'thread_1'),
    ).rejects.toThrow('Thread not found');
  });

  it('marks as failed with empty string displayedContent (no visible text)', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({
      page: [
        {
          _id: 'msg_1',
          message: { role: 'assistant', content: 'Some response text' },
          text: 'Some response text',
        },
      ],
    });

    // Empty string has no trim content — treated as no displayed content
    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      '',
    );

    expect(ctx.runMutation).toHaveBeenCalledWith('mock-updateMessage', {
      messageId: 'msg_1',
      patch: { status: 'failed' },
    });
  });

  it('does not create sentinel message when no assistant message exists (early cancel)', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({
      page: [
        {
          _id: 'msg_1',
          message: { role: 'user', content: 'Only a user message' },
          text: 'Only a user message',
        },
      ],
    });

    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      'some content',
    );

    // No updateMessage — no assistant message to update
    expect(ctx.runMutation).not.toHaveBeenCalled();
    // No saveMessage — cancelledAt signal replaces sentinel messages
  });

  it('does not create message when no messages exist at all', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({ page: [] });

    await cancelGeneration(ctx as unknown as MutationCtx, 'user_1', 'thread_1');

    expect(mockListMessages).toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('does not create message when no messages exist and displayedContent is null', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({ page: [] });

    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      null,
    );

    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('finds the first assistant message even without text property', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({
      page: [
        {
          _id: 'msg_1',
          message: { role: 'assistant', content: 'tool call result' },
          text: undefined,
        },
        {
          _id: 'msg_2',
          message: { role: 'assistant', content: 'Visible response' },
          text: 'Visible response',
        },
      ],
    });

    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      null,
    );

    // Should find first assistant message (msg_1) and update its status
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-updateMessage',
      expect.objectContaining({ messageId: 'msg_1' }),
    );
  });

  it('aborts a single stream', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListStreams.mockResolvedValue([{ streamId: 'stream_solo' }]);

    await cancelGeneration(ctx as unknown as MutationCtx, 'user_1', 'thread_1');

    expect(mockAbortStream).toHaveBeenCalledOnce();
    expect(mockAbortStream).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      expect.objectContaining({
        streamId: 'stream_solo',
        reason: 'user-cancelled',
      }),
    );
  });

  it('handles very long displayedContent', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    const longContent = 'A'.repeat(50000);
    mockListMessages.mockResolvedValue({
      page: [
        {
          _id: 'msg_1',
          message: { role: 'assistant', content: longContent + ' more text' },
          text: longContent + ' more text',
        },
      ],
    });

    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      longContent,
    );

    expect(ctx.runMutation).toHaveBeenCalledWith('mock-updateMessage', {
      messageId: 'msg_1',
      patch: {
        message: { role: 'assistant', content: longContent },
        status: 'success',
      },
    });
  });

  it('preserves multi-byte characters in displayedContent without corruption', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    const unicodeContent = 'Hello 🌍 世界! Here is some text with emoji 🎉🚀';
    mockListMessages.mockResolvedValue({
      page: [
        {
          _id: 'msg_1',
          message: {
            role: 'assistant',
            content: unicodeContent + ' and more...',
          },
          text: unicodeContent + ' and more...',
        },
      ],
    });

    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      unicodeContent,
    );

    expect(ctx.runMutation).toHaveBeenCalledWith('mock-updateMessage', {
      messageId: 'msg_1',
      patch: {
        message: { role: 'assistant', content: unicodeContent },
        status: 'success',
      },
    });
  });

  it('correctly compares string userId with thread userId', async () => {
    const ctx = createMockCtx({ userId: 'user_abc123', status: 'active' });

    await expect(
      cancelGeneration(
        ctx as unknown as MutationCtx,
        'user_abc123',
        'thread_1',
      ),
    ).resolves.toBeUndefined();

    const ctx2 = createMockCtx({ userId: 'user_abc123', status: 'active' });
    await expect(
      cancelGeneration(
        ctx2 as unknown as MutationCtx,
        'user_different',
        'thread_1',
      ),
    ).rejects.toThrow('Thread not found');
  });

  it('skips message update when latest assistant is already successful (early stop)', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({
      page: [
        {
          _id: 'msg_1',
          message: { role: 'assistant', content: 'Completed response' },
          text: 'Completed response',
          status: 'success',
        },
      ],
    });

    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      'Partial',
    );

    // Should NOT update the existing successful message
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('skips message creation when latest is successful and no displayedContent', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({
      page: [
        {
          _id: 'msg_1',
          message: { role: 'assistant', content: 'Done' },
          text: 'Done',
          status: 'success',
        },
      ],
    });

    await cancelGeneration(ctx as unknown as MutationCtx, 'user_1', 'thread_1');

    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});
