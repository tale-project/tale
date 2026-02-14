import type { FunctionReference } from 'convex/server';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: vi.fn((func: { _name: string }) => ({
    queryKey: ['convexQuery', func._name, {}],
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
  }),
}));

import { useMutation } from '@tanstack/react-query';

import { useConvexMutation } from '../use-convex-mutation';

const mockUseMutation = vi.mocked(useMutation);
const mockMutationRef = {} as Parameters<typeof useConvexMutation>[0];
const mockQueryRef = {
  _name: 'items:list',
} as unknown as FunctionReference<'query'>;

describe('useConvexMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useConvexMutation(mockMutationRef);
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('mutate');
    expect(result).toHaveProperty('isPending');
  });

  it('returns isPending as false initially', () => {
    const result = useConvexMutation(mockMutationRef);
    expect(result.isPending).toBe(false);
  });

  it('does not invalidate when no invalidates option is provided', async () => {
    useConvexMutation(mockMutationRef);

    const options = mockUseMutation.mock.calls[0]?.[0];
    // @ts-expect-error -- calling mock onSettled directly for testing
    await options.onSettled?.();

    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it('invalidates specified query functions on settled', async () => {
    useConvexMutation(mockMutationRef, {
      invalidates: [mockQueryRef],
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    // @ts-expect-error -- calling mock onSettled directly for testing
    await options.onSettled?.();

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['convexQuery', 'items:list'],
    });
  });

  it('invalidates multiple query functions', async () => {
    const secondQueryRef = {
      _name: 'items:get',
    } as unknown as FunctionReference<'query'>;
    useConvexMutation(mockMutationRef, {
      invalidates: [mockQueryRef, secondQueryRef],
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    // @ts-expect-error -- calling mock onSettled directly for testing
    await options.onSettled?.();

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['convexQuery', 'items:list'],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['convexQuery', 'items:get'],
    });
  });

  it('calls user-provided onSettled after invalidation', async () => {
    const userOnSettled = vi.fn();
    useConvexMutation(mockMutationRef, {
      invalidates: [mockQueryRef],
      onSettled: userOnSettled,
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    // @ts-expect-error -- calling mock onSettled directly for testing
    await options.onSettled?.();

    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(userOnSettled).toHaveBeenCalled();
  });

  it('invalidates before calling user onSettled', async () => {
    const callOrder: string[] = [];
    mockInvalidateQueries.mockImplementation(async () => {
      callOrder.push('invalidate');
    });
    const userOnSettled = vi.fn(() => {
      callOrder.push('userOnSettled');
    });

    useConvexMutation(mockMutationRef, {
      invalidates: [mockQueryRef],
      onSettled: userOnSettled,
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    // @ts-expect-error -- calling mock onSettled directly for testing
    await options.onSettled?.();

    expect(callOrder).toEqual(['invalidate', 'userOnSettled']);
  });

  it('preserves other user options', () => {
    const userOnSuccess = vi.fn();
    const userOnError = vi.fn();
    useConvexMutation(mockMutationRef, {
      onSuccess: userOnSuccess,
      onError: userOnError,
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    expect(options.onSuccess).toBe(userOnSuccess);
    expect(options.onError).toBe(userOnError);
  });

  it('does not pass invalidates to useMutation options', () => {
    useConvexMutation(mockMutationRef, {
      invalidates: [mockQueryRef],
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    expect(options).not.toHaveProperty('invalidates');
  });
});
