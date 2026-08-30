import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMutateAsync = vi.fn();

const mockMutationResult = {
  mutate: mockMutateAsync,
  mutateAsync: mockMutateAsync,
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
  data: undefined,
  reset: vi.fn(),
};

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => mockMutationResult,
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
      queries: {
        listConversations: 'listConversations',
      },
    },
  },
}));

import {
  useCloseConversation,
  useReopenConversation,
  useMarkAsRead,
  useMarkAsSpam,
} from './mutations';

describe('useCloseConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useCloseConversation();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: closeConversation } = useCloseConversation();

    await closeConversation({
      conversationId: 'conv-123',
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      conversationId: 'conv-123',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Close failed'));
    const { mutateAsync: closeConversation } = useCloseConversation();

    await expect(
      closeConversation({
        conversationId: 'conv-789',
      }),
    ).rejects.toThrow('Close failed');
  });
});

describe('useReopenConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useReopenConversation();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: reopenConversation } = useReopenConversation();

    await reopenConversation({
      conversationId: 'conv-123',
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      conversationId: 'conv-123',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Reopen failed'));
    const { mutateAsync: reopenConversation } = useReopenConversation();

    await expect(
      reopenConversation({
        conversationId: 'conv-789',
      }),
    ).rejects.toThrow('Reopen failed');
  });
});

describe('useMarkAsRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useMarkAsRead();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: markAsRead } = useMarkAsRead();

    await markAsRead({
      conversationId: 'conv-123',
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      conversationId: 'conv-123',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('MarkAsRead failed'));
    const { mutateAsync: markAsRead } = useMarkAsRead();

    await expect(
      markAsRead({
        conversationId: 'conv-789',
      }),
    ).rejects.toThrow('MarkAsRead failed');
  });
});

describe('useMarkAsSpam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useMarkAsSpam();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: markAsSpam } = useMarkAsSpam();

    await markAsSpam({
      conversationId: 'conv-123',
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      conversationId: 'conv-123',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Spam failed'));
    const { mutateAsync: markAsSpam } = useMarkAsSpam();

    await expect(
      markAsSpam({
        conversationId: 'conv-789',
      }),
    ).rejects.toThrow('Spam failed');
  });
});
