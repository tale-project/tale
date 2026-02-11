import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: (fn: unknown) => fn,
  };
});

import {
  useRemoveMember,
  useUpdateMemberRole,
  useUpdateMemberDisplayName,
} from '../mutations';

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

describe('useRemoveMember', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.delete with the memberId', async () => {
    const removeMember = useRemoveMember(mockCollection as never);
    await removeMember({ memberId: 'member-123' });

    expect(mockCollection.delete).toHaveBeenCalledWith('member-123');
  });

  it('awaits isPersisted.promise', async () => {
    const removeMember = useRemoveMember(mockCollection as never);
    const result = removeMember({ memberId: 'member-456' });

    await expect(result).resolves.toBeUndefined();
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Delete failed'));
    mockCollection.delete.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const removeMember = useRemoveMember(mockCollection as never);
    await expect(removeMember({ memberId: 'member-789' })).rejects.toThrow(
      'Delete failed',
    );
  });
});

describe('useUpdateMemberRole', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.update with memberId and role updater', async () => {
    const updateRole = useUpdateMemberRole(mockCollection as never);
    await updateRole({ memberId: 'member-123', role: 'admin' });

    expect(mockCollection.update).toHaveBeenCalledWith(
      'member-123',
      expect.any(Function),
    );
  });

  it('applies role to draft', async () => {
    const updateRole = useUpdateMemberRole(mockCollection as never);
    await updateRole({ memberId: 'member-123', role: 'editor' });

    const updateFn = mockCollection.update.mock.calls[0][1];
    const draft = { role: 'member', displayName: 'Test' };
    updateFn(draft);
    expect(draft.role).toBe('editor');
    expect(draft.displayName).toBe('Test');
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Update failed'));
    mockCollection.update.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const updateRole = useUpdateMemberRole(mockCollection as never);
    await expect(
      updateRole({ memberId: 'member-789', role: 'admin' }),
    ).rejects.toThrow('Update failed');
  });
});

describe('useUpdateMemberDisplayName', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.update with memberId and displayName updater', async () => {
    const updateName = useUpdateMemberDisplayName(mockCollection as never);
    await updateName({ memberId: 'member-123', displayName: 'New Name' });

    expect(mockCollection.update).toHaveBeenCalledWith(
      'member-123',
      expect.any(Function),
    );
  });

  it('applies displayName to draft', async () => {
    const updateName = useUpdateMemberDisplayName(mockCollection as never);
    await updateName({ memberId: 'member-123', displayName: 'New Name' });

    const updateFn = mockCollection.update.mock.calls[0][1];
    const draft = { role: 'member', displayName: 'Old Name' };
    updateFn(draft);
    expect(draft.displayName).toBe('New Name');
    expect(draft.role).toBe('member');
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Update failed'));
    mockCollection.update.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const updateName = useUpdateMemberDisplayName(mockCollection as never);
    await expect(
      updateName({ memberId: 'member-789', displayName: 'Fail' }),
    ).rejects.toThrow('Update failed');
  });
});
