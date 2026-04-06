import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toId } from '@/convex/lib/type_cast_helpers';

const mockMutateAsync = vi.fn();
const mockInvalidateQueries = vi.fn();

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

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
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
      },
      credential_mutations: {
        deleteCredentials: 'deleteCredentials',
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
    const { result } = renderHook(() => useDeleteIntegration());
    expect(result.current).toHaveProperty('mutateAsync');
    expect(result.current).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args and invalidates queries', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useDeleteIntegration());

    await act(async () => {
      await result.current.mutateAsync({
        credentialId: toId<'integrationCredentials'>('cred-123'),
      });
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      credentialId: 'cred-123',
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['config', 'integrations'],
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Delete failed'));

    const { result } = renderHook(() => useDeleteIntegration());

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          credentialId: toId<'integrationCredentials'>('cred-789'),
        });
      }),
    ).rejects.toThrow('Delete failed');
  });
});
