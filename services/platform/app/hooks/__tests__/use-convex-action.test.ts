import type { FunctionReference } from 'convex/server';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: vi.fn((func: { _name: string }) => ({
    queryKey: ['convexQuery', func._name, {}],
    queryFn: vi.fn(),
  })),
}));

vi.mock('convex/server', () => ({
  getFunctionName: (ref: { _name?: string }) => ref._name ?? 'unknown',
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
    action: vi.fn(),
  }),
}));

vi.mock('../use-react-query-client', () => ({
  useReactQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

import { useMutation } from '@tanstack/react-query';

import { useConvexAction } from '../use-convex-action';

const mockUseMutation = vi.mocked(useMutation);
const mockActionRef = {
  _name: 'items:process',
} as unknown as Parameters<typeof useConvexAction>[0];
const mockQueryRef = {
  _name: 'items:list',
} as unknown as FunctionReference<'query'>;

describe('useConvexAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object with mutateAsync', () => {
    const result = useConvexAction(mockActionRef);
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('mutate');
    expect(result).toHaveProperty('isPending');
  });

  it('returns isPending as false initially', () => {
    const result = useConvexAction(mockActionRef);
    expect(result.isPending).toBe(false);
  });

  it('invalidates own key when no invalidates option is provided', async () => {
    useConvexAction(mockActionRef);

    const options = mockUseMutation.mock.calls[0]?.[0];
    // @ts-expect-error -- calling mock onSettled directly for testing
    await options.onSettled?.();

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['convexQuery', 'items:process'],
    });
  });

  it('invalidates own key and specified query functions on settled', async () => {
    useConvexAction(mockActionRef, {
      invalidates: [mockQueryRef],
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    // @ts-expect-error -- calling mock onSettled directly for testing
    await options.onSettled?.();

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['convexQuery', 'items:process'],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['convexQuery', 'items:list'],
    });
  });

  it('calls user-provided onSettled after invalidation', async () => {
    const userOnSettled = vi.fn();
    useConvexAction(mockActionRef, {
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

    useConvexAction(mockActionRef, {
      invalidates: [mockQueryRef],
      onSettled: userOnSettled,
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    // @ts-expect-error -- calling mock onSettled directly for testing
    await options.onSettled?.();

    expect(callOrder).toEqual(['invalidate', 'invalidate', 'userOnSettled']);
  });

  it('preserves other user options', () => {
    const userOnSuccess = vi.fn();
    const userOnError = vi.fn();
    useConvexAction(mockActionRef, {
      onSuccess: userOnSuccess,
      onError: userOnError,
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    expect(options.onSuccess).toBe(userOnSuccess);
    expect(options.onError).toBe(userOnError);
  });

  it('does not pass invalidates to useMutation options', () => {
    useConvexAction(mockActionRef, {
      invalidates: [mockQueryRef],
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    expect(options).not.toHaveProperty('invalidates');
  });
});
