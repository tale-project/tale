import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toId } from '@/convex/lib/type_cast_helpers';

const mockMutationFn = vi.fn();

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => mockMutationFn,
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

  it('returns the mutation function from useConvexMutation', () => {
    const deleteIntegration = useDeleteIntegration();
    expect(deleteIntegration).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(null);
    const deleteIntegration = useDeleteIntegration();

    await deleteIntegration({
      integrationId: toId<'integrations'>('int-123'),
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      integrationId: 'int-123',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Delete failed'));
    const deleteIntegration = useDeleteIntegration();

    await expect(
      deleteIntegration({
        integrationId: toId<'integrations'>('int-789'),
      }),
    ).rejects.toThrow('Delete failed');
  });
});
