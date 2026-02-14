import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);
const mockCancelQueries = vi.fn().mockResolvedValue(undefined);
const mockSetQueryData = vi.fn();
const mockGetQueryData = vi.fn();

const MOCK_QUERY_KEY = [
  'convexQuery',
  'listItems',
  { organizationId: 'org-1' },
];

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: vi.fn(() => ({
    queryKey: MOCK_QUERY_KEY,
    queryFn: vi.fn(),
  })),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn((options: Record<string, unknown>) => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
    _options: options,
  })),
}));

vi.mock('../use-convex-client', () => ({
  useConvexClient: () => ({
    mutation: vi.fn(),
  }),
}));

vi.mock('../use-react-query-client', () => ({
  useReactQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    cancelQueries: mockCancelQueries,
    setQueryData: mockSetQueryData,
    getQueryData: mockGetQueryData,
  }),
}));

vi.mock('../use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const mockInvalidateConvexQueries = vi.fn().mockResolvedValue(undefined);

vi.mock('../invalidate', () => ({
  invalidateConvexQueries: (...args: unknown[]) =>
    mockInvalidateConvexQueries(...args),
}));

import type { FunctionReference } from 'convex/server';

import { useMutation } from '@tanstack/react-query';

import { useConvexOptimisticMutation } from '../use-convex-optimistic-mutation';

const mockUseMutation = vi.mocked(useMutation);

const mockMutationRef = {} as FunctionReference<'mutation'>;
const mockQueryRef = {} as FunctionReference<'query'>;

describe('useConvexOptimisticMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provides onSettled that invalidates the target query', async () => {
    useConvexOptimisticMutation(mockMutationRef, mockQueryRef, {
      queryArgs: { organizationId: 'org-1' },
      onMutate: async () => undefined,
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    expect(options).toHaveProperty('onSettled');

    // @ts-expect-error -- calling mock onSettled directly for testing
    await options.onSettled?.();

    expect(mockInvalidateConvexQueries).toHaveBeenCalledWith(
      expect.objectContaining({ invalidateQueries: mockInvalidateQueries }),
      [mockQueryRef],
    );
  });

  it('invalidates even when queryArgs is undefined', async () => {
    useConvexOptimisticMutation(mockMutationRef, mockQueryRef, {
      queryArgs: undefined,
      onMutate: async () => undefined,
    });

    const options = mockUseMutation.mock.calls[0]?.[0];

    // @ts-expect-error -- calling mock onSettled directly for testing
    await options.onSettled?.();

    expect(mockInvalidateConvexQueries).toHaveBeenCalledWith(
      expect.objectContaining({ invalidateQueries: mockInvalidateQueries }),
      [mockQueryRef],
    );
  });

  it('supports queryArgs as a function', async () => {
    useConvexOptimisticMutation(mockMutationRef, mockQueryRef, {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: async () => undefined,
    });

    const options = mockUseMutation.mock.calls[0]?.[0];

    // @ts-expect-error -- calling mock onSettled directly for testing
    await options.onSettled?.();

    expect(mockInvalidateConvexQueries).toHaveBeenCalledWith(
      expect.objectContaining({ invalidateQueries: mockInvalidateQueries }),
      [mockQueryRef],
    );
  });

  it('provides onError that rolls back optimistic update', () => {
    useConvexOptimisticMutation(mockMutationRef, mockQueryRef, {
      queryArgs: { organizationId: 'org-1' },
      onMutate: async () => undefined,
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    const previousData = [{ _id: 'a', name: 'Alice' }];
    const ctx = { previous: previousData, queryKey: MOCK_QUERY_KEY };

    // @ts-expect-error -- calling mock onError directly for testing
    options.onError?.(new Error('fail'), {}, ctx);

    expect(mockSetQueryData).toHaveBeenCalledWith(MOCK_QUERY_KEY, previousData);
  });

  it('does not roll back when context is not OptimisticContext', () => {
    useConvexOptimisticMutation(mockMutationRef, mockQueryRef, {
      queryArgs: { organizationId: 'org-1' },
      onMutate: async () => undefined,
    });

    const options = mockUseMutation.mock.calls[0]?.[0];

    // @ts-expect-error -- calling mock onError directly for testing
    options.onError?.(new Error('fail'), {}, undefined);

    expect(mockSetQueryData).not.toHaveBeenCalled();
  });
});
