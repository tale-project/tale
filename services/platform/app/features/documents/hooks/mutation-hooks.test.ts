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
    documents: {
      mutations: {
        deleteDocument: 'deleteDocument',
        updateDocument: 'updateDocument',
      },
      queries: {
        listDocuments: 'listDocuments',
      },
    },
  },
}));

import { useDeleteDocument, useUpdateDocument } from './mutations';

describe('useDeleteDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useDeleteDocument();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: deleteDocument } = useDeleteDocument();

    await deleteDocument({ documentId: 'doc-123' });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: 'doc-123',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Delete failed'));
    const { mutateAsync: deleteDocument } = useDeleteDocument();

    await expect(deleteDocument({ documentId: 'doc-789' })).rejects.toThrow(
      'Delete failed',
    );
  });
});

describe('useUpdateDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useUpdateDocument();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with documentId and teamIds', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const { mutateAsync: updateDocument } = useUpdateDocument();

    await updateDocument({
      documentId: 'doc-123',
      teamIds: ['team-1'],
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: 'doc-123',
      teamIds: ['team-1'],
    });
  });

  it('calls mutation with documentId only', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const { mutateAsync: updateDocument } = useUpdateDocument();

    await updateDocument({ documentId: 'doc-123' });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: 'doc-123',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Update failed'));
    const { mutateAsync: updateDocument } = useUpdateDocument();

    await expect(
      updateDocument({
        documentId: 'doc-789',
        teamIds: ['team-1'],
      }),
    ).rejects.toThrow('Update failed');
  });
});
