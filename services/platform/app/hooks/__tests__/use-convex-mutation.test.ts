import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMutationFn = vi.fn();

vi.mock('@convex-dev/react-query', () => ({
  useConvexMutation: vi.fn(() => mockMutationFn),
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

import { useConvexMutation as useMutationFn } from '@convex-dev/react-query';
import { useMutation } from '@tanstack/react-query';

import { useConvexMutation } from '../use-convex-mutation';

const mockUseMutationFn = vi.mocked(useMutationFn);
const mockUseMutation = vi.mocked(useMutation);
const mockMutationRef = {
  _name: 'items:update',
} as unknown as Parameters<typeof useConvexMutation>[0];

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

  it('passes the function reference to useConvexMutation from @convex-dev/react-query', () => {
    useConvexMutation(mockMutationRef);
    expect(mockUseMutationFn).toHaveBeenCalledWith(mockMutationRef);
  });

  it('uses the returned function as mutationFn', () => {
    useConvexMutation(mockMutationRef);
    const options = mockUseMutation.mock.calls[0]?.[0];
    expect(options).toHaveProperty('mutationFn', mockMutationFn);
  });

  it('preserves user options', () => {
    const userOnSuccess = vi.fn();
    const userOnError = vi.fn();
    const userOnSettled = vi.fn();
    useConvexMutation(mockMutationRef, {
      onSuccess: userOnSuccess,
      onError: userOnError,
      onSettled: userOnSettled,
    });

    const options = mockUseMutation.mock.calls[0]?.[0];
    expect(options.onSuccess).toBe(userOnSuccess);
    expect(options.onError).toBe(userOnError);
    expect(options.onSettled).toBe(userOnSettled);
  });
});
