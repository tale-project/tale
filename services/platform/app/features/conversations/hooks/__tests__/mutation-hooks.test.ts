import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: (fn: unknown) => fn,
  };
});

import {
  useCloseConversation,
  useReopenConversation,
  useMarkAsRead,
  useMarkAsSpam,
} from '../mutations';

function createMockCollection() {
  const persistedPromise = Promise.resolve();
  return {
    update: vi.fn(() => ({
      isPersisted: { promise: persistedPromise },
    })),
    _persistedPromise: persistedPromise,
  };
}

describe('useCloseConversation', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.update with conversationId and sets status to closed', async () => {
    const close = useCloseConversation(mockCollection as never);
    await close({ conversationId: 'conv-123' });

    expect(mockCollection.update).toHaveBeenCalledWith(
      'conv-123',
      expect.any(Function),
    );
  });

  it('applies closed status to draft', async () => {
    const close = useCloseConversation(mockCollection as never);
    await close({ conversationId: 'conv-123' });

    const updateFn = mockCollection.update.mock.calls[0][1];
    const draft = { status: 'open', unread_count: 5 };
    updateFn(draft);
    expect(draft.status).toBe('closed');
    expect(draft.unread_count).toBe(5);
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Close failed'));
    mockCollection.update.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const close = useCloseConversation(mockCollection as never);
    await expect(close({ conversationId: 'conv-789' })).rejects.toThrow(
      'Close failed',
    );
  });
});

describe('useReopenConversation', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.update with conversationId and sets status to open', async () => {
    const reopen = useReopenConversation(mockCollection as never);
    await reopen({ conversationId: 'conv-123' });

    expect(mockCollection.update).toHaveBeenCalledWith(
      'conv-123',
      expect.any(Function),
    );
  });

  it('applies open status to draft', async () => {
    const reopen = useReopenConversation(mockCollection as never);
    await reopen({ conversationId: 'conv-123' });

    const updateFn = mockCollection.update.mock.calls[0][1];
    const draft = { status: 'closed', unread_count: 0 };
    updateFn(draft);
    expect(draft.status).toBe('open');
    expect(draft.unread_count).toBe(0);
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Reopen failed'));
    mockCollection.update.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const reopen = useReopenConversation(mockCollection as never);
    await expect(reopen({ conversationId: 'conv-789' })).rejects.toThrow(
      'Reopen failed',
    );
  });
});

describe('useMarkAsRead', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.update with conversationId', async () => {
    const markAsRead = useMarkAsRead(mockCollection as never);
    await markAsRead({ conversationId: 'conv-123' });

    expect(mockCollection.update).toHaveBeenCalledWith(
      'conv-123',
      expect.any(Function),
    );
  });

  it('sets unread_count to 0 and updates last_read_at', async () => {
    const markAsRead = useMarkAsRead(mockCollection as never);
    await markAsRead({ conversationId: 'conv-123' });

    const updateFn = mockCollection.update.mock.calls[0][1];
    const draft = {
      status: 'open',
      unread_count: 5,
      last_read_at: undefined as string | undefined,
    };
    updateFn(draft);
    expect(draft.unread_count).toBe(0);
    expect(draft.last_read_at).toBeDefined();
    expect(draft.status).toBe('open');
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('MarkAsRead failed'));
    mockCollection.update.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const markAsRead = useMarkAsRead(mockCollection as never);
    await expect(markAsRead({ conversationId: 'conv-789' })).rejects.toThrow(
      'MarkAsRead failed',
    );
  });
});

describe('useMarkAsSpam', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.update with conversationId and sets status to spam', async () => {
    const markAsSpam = useMarkAsSpam(mockCollection as never);
    await markAsSpam({ conversationId: 'conv-123' });

    expect(mockCollection.update).toHaveBeenCalledWith(
      'conv-123',
      expect.any(Function),
    );
  });

  it('applies spam status to draft', async () => {
    const markAsSpam = useMarkAsSpam(mockCollection as never);
    await markAsSpam({ conversationId: 'conv-123' });

    const updateFn = mockCollection.update.mock.calls[0][1];
    const draft = { status: 'open', unread_count: 3 };
    updateFn(draft);
    expect(draft.status).toBe('spam');
    expect(draft.unread_count).toBe(3);
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Spam failed'));
    mockCollection.update.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const markAsSpam = useMarkAsSpam(mockCollection as never);
    await expect(markAsSpam({ conversationId: 'conv-789' })).rejects.toThrow(
      'Spam failed',
    );
  });
});
