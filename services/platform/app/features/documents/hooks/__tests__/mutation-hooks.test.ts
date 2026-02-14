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

  it('returns mutateAsync from useConvexMutation', () => {
    const deleteDocument = useDeleteDocument();
    expect(deleteDocument).toBe(mockMutateAsync);
  });

  it('calls mutateAsync with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const deleteDocument = useDeleteDocument();

    await deleteDocument({ documentId: toId<'documents'>('doc-123') });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: toId<'documents'>('doc-123'),
    });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Delete failed'));
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

  it('returns mutateAsync from useConvexMutation', () => {
    const updateDocument = useUpdateDocument();
    expect(updateDocument).toBe(mockMutateAsync);
  });

  it('calls mutateAsync with documentId and teamTags', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const updateDocument = useUpdateDocument();

    await updateDocument({
      documentId: toId<'documents'>('doc-123'),
      teamTags: ['team-1', 'team-2'],
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: toId<'documents'>('doc-123'),
      teamTags: ['team-1', 'team-2'],
    });
  });

  it('calls mutateAsync with documentId only', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const updateDocument = useUpdateDocument();

    await updateDocument({ documentId: toId<'documents'>('doc-123') });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: toId<'documents'>('doc-123'),
    });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Update failed'));
    const updateDocument = useUpdateDocument();

    await expect(
      updateDocument({
        documentId: toId<'documents'>('doc-789'),
        teamTags: ['team-1'],
      }),
    ).rejects.toThrow('Update failed');
  });
});
