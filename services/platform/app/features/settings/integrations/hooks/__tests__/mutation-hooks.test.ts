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
    files: {
      mutations: {
        generateUploadUrl: 'generateUploadUrl',
      },
    },
    integrations: {
      mutations: {
        updateIcon: 'updateIcon',
        deleteIntegration: 'deleteIntegration',
      },
    },
  },
}));

import { useDeleteIntegration } from '../mutations';

describe('useDeleteIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns mutateAsync from useConvexMutation', () => {
    const deleteIntegration = useDeleteIntegration();
    expect(deleteIntegration).toBe(mockMutateAsync);
  });

  it('calls mutateAsync with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const deleteIntegration = useDeleteIntegration();

    await deleteIntegration({
      integrationId: toId<'integrations'>('int-123'),
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      integrationId: 'int-123',
    });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Delete failed'));
    const deleteIntegration = useDeleteIntegration();

    await expect(
      deleteIntegration({
        integrationId: toId<'integrations'>('int-789'),
      }),
    ).rejects.toThrow('Delete failed');
  });
});
