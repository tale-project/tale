import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: (fn: unknown) => fn,
  };
});

import { useDeleteDocument, useUpdateDocument } from '../mutations';

function createMockCollection() {
  const persistedPromise = Promise.resolve();
  return {
    delete: vi.fn(() => ({
      isPersisted: { promise: persistedPromise },
    })),
    update: vi.fn(() => ({
      isPersisted: { promise: persistedPromise },
    })),
    _persistedPromise: persistedPromise,
  };
}

describe('useDeleteDocument', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.delete with documentId', async () => {
    const deleteDocument = useDeleteDocument(mockCollection as never);
    await deleteDocument({ documentId: 'doc-123' });

    expect(mockCollection.delete).toHaveBeenCalledWith('doc-123');
  });

  it('awaits isPersisted.promise', async () => {
    const deleteDocument = useDeleteDocument(mockCollection as never);
    const result = deleteDocument({ documentId: 'doc-123' });

    await expect(result).resolves.toBeUndefined();
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Delete failed'));
    mockCollection.delete.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const deleteDocument = useDeleteDocument(mockCollection as never);
    await expect(deleteDocument({ documentId: 'doc-789' })).rejects.toThrow(
      'Delete failed',
    );
  });
});

describe('useUpdateDocument', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.update with documentId and teamTags', async () => {
    const updateDocument = useUpdateDocument(mockCollection as never);
    await updateDocument({
      documentId: 'doc-123',
      teamTags: ['team-1', 'team-2'],
    });

    expect(mockCollection.update).toHaveBeenCalledWith(
      'doc-123',
      expect.any(Function),
    );
  });

  it('applies teamTags to draft', async () => {
    const updateDocument = useUpdateDocument(mockCollection as never);
    await updateDocument({
      documentId: 'doc-123',
      teamTags: ['team-1'],
    });

    const updateFn = mockCollection.update.mock.calls[0][1];
    const draft = { teamTags: undefined as string[] | undefined, name: 'old' };
    updateFn(draft);
    expect(draft.teamTags).toEqual(['team-1']);
    expect(draft.name).toBe('old');
  });

  it('applies name to draft', async () => {
    const updateDocument = useUpdateDocument(mockCollection as never);
    await updateDocument({
      documentId: 'doc-123',
      name: 'new-name',
    });

    const updateFn = mockCollection.update.mock.calls[0][1];
    const draft = { teamTags: ['existing'], name: 'old' };
    updateFn(draft);
    expect(draft.name).toBe('new-name');
    expect(draft.teamTags).toEqual(['existing']);
  });

  it('does not modify unspecified fields', async () => {
    const updateDocument = useUpdateDocument(mockCollection as never);
    await updateDocument({
      documentId: 'doc-123',
    });

    const updateFn = mockCollection.update.mock.calls[0][1];
    const draft = { teamTags: ['existing'], name: 'old' };
    updateFn(draft);
    expect(draft.teamTags).toEqual(['existing']);
    expect(draft.name).toBe('old');
  });

  it('awaits isPersisted.promise', async () => {
    const updateDocument = useUpdateDocument(mockCollection as never);
    const result = updateDocument({
      documentId: 'doc-123',
      teamTags: ['team-1'],
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Update failed'));
    mockCollection.update.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const updateDocument = useUpdateDocument(mockCollection as never);
    await expect(
      updateDocument({ documentId: 'doc-789', teamTags: ['team-1'] }),
    ).rejects.toThrow('Update failed');
  });
});
