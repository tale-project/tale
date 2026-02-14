import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toId } from '@/convex/lib/type_cast_helpers';

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
      queries: {
        list: 'list',
      },
    },
  },
}));

import { useDeleteIntegration } from '../mutations';

describe('useDeleteIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useDeleteIntegration();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: deleteIntegration } = useDeleteIntegration();

    await deleteIntegration({
      integrationId: toId<'integrations'>('int-123'),
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      integrationId: 'int-123',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Delete failed'));
    const { mutateAsync: deleteIntegration } = useDeleteIntegration();

    await expect(
      deleteIntegration({
        integrationId: toId<'integrations'>('int-789'),
      }),
    ).rejects.toThrow('Delete failed');
  });
});
