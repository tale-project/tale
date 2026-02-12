import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: (fn: unknown) => fn,
  };
});

import {
  useDeleteIntegration,
  useDeleteEmailProvider,
  useUpdateEmailProvider,
} from '../mutations';

function createMockCollection() {
  const persistedPromise = Promise.resolve();
  return {
    delete: vi.fn((_id: string) => ({
      isPersisted: { promise: persistedPromise },
    })),
    update: vi.fn(
      (_id: string, _cb: (draft: Record<string, unknown>) => void) => ({
        isPersisted: { promise: persistedPromise },
      }),
    ),
    _persistedPromise: persistedPromise,
  };
}

describe('useDeleteIntegration', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.delete with the integrationId', async () => {
    const deleteIntegration = useDeleteIntegration(mockCollection as never);
    await deleteIntegration({ integrationId: 'int-123' });

    expect(mockCollection.delete).toHaveBeenCalledWith('int-123');
  });

  it('awaits isPersisted.promise', async () => {
    const deleteIntegration = useDeleteIntegration(mockCollection as never);
    const result = deleteIntegration({ integrationId: 'int-456' });

    await expect(result).resolves.toBeUndefined();
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Delete failed'));
    mockCollection.delete.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const deleteIntegration = useDeleteIntegration(mockCollection as never);
    await expect(
      deleteIntegration({ integrationId: 'int-789' }),
    ).rejects.toThrow('Delete failed');
  });
});

describe('useDeleteEmailProvider', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.delete with the providerId', async () => {
    const deleteProvider = useDeleteEmailProvider(mockCollection as never);
    await deleteProvider({ providerId: 'ep-123' });

    expect(mockCollection.delete).toHaveBeenCalledWith('ep-123');
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Delete failed'));
    mockCollection.delete.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const deleteProvider = useDeleteEmailProvider(mockCollection as never);
    await expect(deleteProvider({ providerId: 'ep-789' })).rejects.toThrow(
      'Delete failed',
    );
  });
});

describe('useUpdateEmailProvider', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.update with providerId and updater', async () => {
    const updateProvider = useUpdateEmailProvider(mockCollection as never);
    await updateProvider({ providerId: 'ep-123', name: 'New Name' });

    expect(mockCollection.update).toHaveBeenCalledWith(
      'ep-123',
      expect.any(Function),
    );
  });

  it('updater sets the name on draft', async () => {
    const updateProvider = useUpdateEmailProvider(mockCollection as never);
    await updateProvider({ providerId: 'ep-123', name: 'Updated Provider' });

    const updaterFn = mockCollection.update.mock.calls[0][1];
    const draft = { name: 'Old Name' };
    updaterFn(draft);
    expect(draft.name).toBe('Updated Provider');
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Update failed'));
    mockCollection.update.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const updateProvider = useUpdateEmailProvider(mockCollection as never);
    await expect(
      updateProvider({ providerId: 'ep-789', name: 'Fail' }),
    ).rejects.toThrow('Update failed');
  });
});
