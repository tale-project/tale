import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockActionFn = vi.fn();

vi.mock('@convex-dev/react-query', () => ({
  useConvexAction: vi.fn(() => mockActionFn),
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

import { useConvexAction as useActionFn } from '@convex-dev/react-query';
import { useMutation } from '@tanstack/react-query';

import { useConvexAction } from '../use-convex-action';

const mockUseActionFn = vi.mocked(useActionFn);
const mockUseMutation = vi.mocked(useMutation);
const mockActionRef = {
  _name: 'items:process',
} as unknown as Parameters<typeof useConvexAction>[0];

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

  it('passes the function reference to useConvexAction from @convex-dev/react-query', () => {
    useConvexAction(mockActionRef);
    expect(mockUseActionFn).toHaveBeenCalledWith(mockActionRef);
  });

  it('uses the returned function as mutationFn', () => {
    useConvexAction(mockActionRef);
    const options = mockUseMutation.mock.calls[0]?.[0];
    expect(options).toHaveProperty('mutationFn', mockActionFn);
  });

  it('preserves user options', () => {
    const userOnSuccess = vi.fn();
    const userOnError = vi.fn();
    const userOnSettled = vi.fn();
    useConvexAction(mockActionRef, {
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
