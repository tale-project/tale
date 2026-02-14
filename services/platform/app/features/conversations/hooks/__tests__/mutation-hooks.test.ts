import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toId } from '@/convex/lib/type_cast_helpers';

const mockMutationFn = vi.fn();

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => mockMutationFn,
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    conversations: {
      mutations: {
        closeConversation: 'closeConversation',
        reopenConversation: 'reopenConversation',
        markConversationAsRead: 'markConversationAsRead',
        markConversationAsSpam: 'markConversationAsSpam',
      },
    },
  },
}));

import {
  useCloseConversation,
  useReopenConversation,
  useMarkAsRead,
  useMarkAsSpam,
} from '../mutations';

describe('useCloseConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const closeConversation = useCloseConversation();
    expect(closeConversation).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(null);
    const closeConversation = useCloseConversation();

    await closeConversation({
      conversationId: toId<'conversations'>('conv-123'),
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      conversationId: toId<'conversations'>('conv-123'),
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Close failed'));
    const closeConversation = useCloseConversation();

    await expect(
      closeConversation({
        conversationId: toId<'conversations'>('conv-789'),
      }),
    ).rejects.toThrow('Close failed');
  });
});

describe('useReopenConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const reopenConversation = useReopenConversation();
    expect(reopenConversation).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(null);
    const reopenConversation = useReopenConversation();

    await reopenConversation({
      conversationId: toId<'conversations'>('conv-123'),
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      conversationId: toId<'conversations'>('conv-123'),
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Reopen failed'));
    const reopenConversation = useReopenConversation();

    await expect(
      reopenConversation({
        conversationId: toId<'conversations'>('conv-789'),
      }),
    ).rejects.toThrow('Reopen failed');
  });
});

describe('useMarkAsRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const markAsRead = useMarkAsRead();
    expect(markAsRead).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(null);
    const markAsRead = useMarkAsRead();

    await markAsRead({
      conversationId: toId<'conversations'>('conv-123'),
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      conversationId: toId<'conversations'>('conv-123'),
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('MarkAsRead failed'));
    const markAsRead = useMarkAsRead();

    await expect(
      markAsRead({
        conversationId: toId<'conversations'>('conv-789'),
      }),
    ).rejects.toThrow('MarkAsRead failed');
  });
});

describe('useMarkAsSpam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const markAsSpam = useMarkAsSpam();
    expect(markAsSpam).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(null);
    const markAsSpam = useMarkAsSpam();

    await markAsSpam({
      conversationId: toId<'conversations'>('conv-123'),
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      conversationId: toId<'conversations'>('conv-123'),
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Spam failed'));
    const markAsSpam = useMarkAsSpam();

    await expect(
      markAsSpam({
        conversationId: toId<'conversations'>('conv-789'),
      }),
    ).rejects.toThrow('Spam failed');
  });
});
