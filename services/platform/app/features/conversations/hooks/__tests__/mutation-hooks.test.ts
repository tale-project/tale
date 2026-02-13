import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toId } from '@/convex/lib/type_cast_helpers';

const mockMutateAsync = vi.fn();

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
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

  it('returns mutateAsync from useConvexMutation', () => {
    const closeConversation = useCloseConversation();
    expect(closeConversation).toBe(mockMutateAsync);
  });

  it('calls mutateAsync with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const closeConversation = useCloseConversation();

    await closeConversation({
      conversationId: toId<'conversations'>('conv-123'),
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      conversationId: toId<'conversations'>('conv-123'),
    });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Close failed'));
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

  it('returns mutateAsync from useConvexMutation', () => {
    const reopenConversation = useReopenConversation();
    expect(reopenConversation).toBe(mockMutateAsync);
  });

  it('calls mutateAsync with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const reopenConversation = useReopenConversation();

    await reopenConversation({
      conversationId: toId<'conversations'>('conv-123'),
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      conversationId: toId<'conversations'>('conv-123'),
    });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Reopen failed'));
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

  it('returns mutateAsync from useConvexMutation', () => {
    const markAsRead = useMarkAsRead();
    expect(markAsRead).toBe(mockMutateAsync);
  });

  it('calls mutateAsync with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const markAsRead = useMarkAsRead();

    await markAsRead({
      conversationId: toId<'conversations'>('conv-123'),
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      conversationId: toId<'conversations'>('conv-123'),
    });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('MarkAsRead failed'));
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

  it('returns mutateAsync from useConvexMutation', () => {
    const markAsSpam = useMarkAsSpam();
    expect(markAsSpam).toBe(mockMutateAsync);
  });

  it('calls mutateAsync with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const markAsSpam = useMarkAsSpam();

    await markAsSpam({
      conversationId: toId<'conversations'>('conv-123'),
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      conversationId: toId<'conversations'>('conv-123'),
    });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Spam failed'));
    const markAsSpam = useMarkAsSpam();

    await expect(
      markAsSpam({
        conversationId: toId<'conversations'>('conv-789'),
      }),
    ).rejects.toThrow('Spam failed');
  });
});
