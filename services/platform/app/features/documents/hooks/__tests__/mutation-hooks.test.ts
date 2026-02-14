import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toId } from '@/convex/lib/type_cast_helpers';

const mockMutationFn = vi.fn();

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => mockMutationFn,
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    documents: {
      mutations: {
        deleteDocument: 'deleteDocument',
        updateDocument: 'updateDocument',
      },
    },
  },
}));

import { useDeleteDocument, useUpdateDocument } from '../mutations';

describe('useDeleteDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const deleteDocument = useDeleteDocument();
    expect(deleteDocument).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(null);
    const deleteDocument = useDeleteDocument();

    await deleteDocument({ documentId: toId<'documents'>('doc-123') });

    expect(mockMutationFn).toHaveBeenCalledWith({
      documentId: toId<'documents'>('doc-123'),
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Delete failed'));
    const deleteDocument = useDeleteDocument();

    await expect(
      deleteDocument({ documentId: toId<'documents'>('doc-789') }),
    ).rejects.toThrow('Delete failed');
  });
});

describe('useUpdateDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const updateDocument = useUpdateDocument();
    expect(updateDocument).toBe(mockMutationFn);
  });

  it('calls mutation with documentId and teamTags', async () => {
    mockMutationFn.mockResolvedValueOnce(undefined);
    const updateDocument = useUpdateDocument();

    await updateDocument({
      documentId: toId<'documents'>('doc-123'),
      teamTags: ['team-1', 'team-2'],
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      documentId: toId<'documents'>('doc-123'),
      teamTags: ['team-1', 'team-2'],
    });
  });

  it('calls mutation with documentId only', async () => {
    mockMutationFn.mockResolvedValueOnce(undefined);
    const updateDocument = useUpdateDocument();

    await updateDocument({ documentId: toId<'documents'>('doc-123') });

    expect(mockMutationFn).toHaveBeenCalledWith({
      documentId: toId<'documents'>('doc-123'),
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Update failed'));
    const updateDocument = useUpdateDocument();

    await expect(
      updateDocument({
        documentId: toId<'documents'>('doc-789'),
        teamTags: ['team-1'],
      }),
    ).rejects.toThrow('Update failed');
  });
});
