import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { MutationCtx } from '../_generated/server';

const mockAbortStream = vi.fn();
const mockListStreams = vi.fn();
const mockListMessages = vi.fn();
const mockSaveMessage = vi.fn();

vi.mock('@convex-dev/agent', () => ({
  abortStream: (...args: unknown[]) => mockAbortStream(...args),
  listStreams: (...args: unknown[]) => mockListStreams(...args),
  listMessages: (...args: unknown[]) => mockListMessages(...args),
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
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
) {
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(thread),
    runMutation: vi.fn().mockResolvedValue(undefined),
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

  it('truncates assistant message when displayedContent is provided', async () => {
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
        status: 'failed',
      },
    });
  });

  it('sets status to failed without truncating content when displayedContent is null', async () => {
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

  it('sets status to failed without truncating content when displayedContent is undefined', async () => {
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
    mockSaveMessage.mockResolvedValue(undefined);
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

  it('truncates with empty string displayedContent (not treated as null)', async () => {
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

    // Empty string is a valid displayedContent (user stopped before any text appeared)
    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      '',
    );

    // Should still update the message with empty string
    expect(ctx.runMutation).toHaveBeenCalledWith('mock-updateMessage', {
      messageId: 'msg_1',
      patch: {
        message: {
          role: 'assistant',
          content: '',
        },
        status: 'failed',
      },
    });
  });

  it('creates failed message via saveMessage when no assistant message is found', async () => {
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

    expect(mockListMessages).toHaveBeenCalled();
    // No updateMessage — instead saveMessage creates a new failed message
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(mockSaveMessage).toHaveBeenCalledWith(ctx, expect.anything(), {
      threadId: 'thread_1',
      message: { role: 'assistant', content: 'some content' },
      metadata: { status: 'failed' },
    });
  });

  it('creates failed message with empty content when no messages exist and displayedContent is undefined', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({ page: [] });

    await cancelGeneration(ctx as unknown as MutationCtx, 'user_1', 'thread_1');

    expect(mockListMessages).toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(mockSaveMessage).toHaveBeenCalledWith(ctx, expect.anything(), {
      threadId: 'thread_1',
      message: { role: 'assistant', content: '' },
      metadata: { status: 'failed' },
    });
  });

  it('creates failed message with empty content when no messages exist and displayedContent is null', async () => {
    const ctx = createMockCtx({ userId: 'user_1', status: 'active' });
    mockListMessages.mockResolvedValue({ page: [] });

    await cancelGeneration(
      ctx as unknown as MutationCtx,
      'user_1',
      'thread_1',
      null,
    );

    expect(mockSaveMessage).toHaveBeenCalledWith(ctx, expect.anything(), {
      threadId: 'thread_1',
      message: { role: 'assistant', content: '' },
      metadata: { status: 'failed' },
    });
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
        status: 'failed',
      },
    });
  });

  // Issue #5: Mid-codepoint truncation — displayedContent with multi-byte
  // characters (emoji, CJK) must be stored as-is without corruption.
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
        status: 'failed',
      },
    });
  });

  it('correctly compares string userId with thread userId', async () => {
    // Thread userId is stored as a string; authUser._id may be an Id type
    // that gets String()-ified. This test verifies the comparison works.
    const ctx = createMockCtx({ userId: 'user_abc123', status: 'active' });

    // Should NOT throw when userId matches
    await expect(
      cancelGeneration(
        ctx as unknown as MutationCtx,
        'user_abc123',
        'thread_1',
      ),
    ).resolves.toBeUndefined();

    // Should throw when userId doesn't match
    const ctx2 = createMockCtx({ userId: 'user_abc123', status: 'active' });
    await expect(
      cancelGeneration(
        ctx2 as unknown as MutationCtx,
        'user_different',
        'thread_1',
      ),
    ).rejects.toThrow('Thread not found');
  });
});
