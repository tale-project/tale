import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: (fn: unknown) => fn,
  };
});

import { useRemoveTeamMember } from '../mutations';

function createMockCollection() {
  const persistedPromise = Promise.resolve();
  return {
    delete: vi.fn(() => ({
      isPersisted: { promise: persistedPromise },
    })),
    _persistedPromise: persistedPromise,
  };
}

describe('useRemoveTeamMember', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;

  beforeEach(() => {
    mockCollection = createMockCollection();
  });

  it('calls collection.delete with teamMemberId and metadata', async () => {
    const removeTeamMember = useRemoveTeamMember(mockCollection as never);
    await removeTeamMember({
      teamMemberId: 'tm-123',
      organizationId: 'org-456',
    });

    expect(mockCollection.delete).toHaveBeenCalledWith('tm-123', {
      metadata: { organizationId: 'org-456' },
    });
  });

  it('awaits isPersisted.promise', async () => {
    const removeTeamMember = useRemoveTeamMember(mockCollection as never);
    const result = removeTeamMember({
      teamMemberId: 'tm-123',
      organizationId: 'org-456',
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('propagates errors from isPersisted.promise', async () => {
    const rejectedPromise = Promise.reject(new Error('Delete failed'));
    mockCollection.delete.mockReturnValueOnce({
      isPersisted: { promise: rejectedPromise },
    });

    const removeTeamMember = useRemoveTeamMember(mockCollection as never);
    await expect(
      removeTeamMember({
        teamMemberId: 'tm-789',
        organizationId: 'org-456',
      }),
    ).rejects.toThrow('Delete failed');
  });
});
