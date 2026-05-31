import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOptimisticFn, mockMutationFn, mockToast } = vi.hoisted(() => {
  const optimisticFn = vi.fn();
  return {
    mockOptimisticFn: optimisticFn,
    mockMutationFn: Object.assign(vi.fn(), {
      withOptimisticUpdate: vi.fn(() => optimisticFn),
    }),
    mockToast: vi.fn(),
  };
});

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

vi.mock('convex/server', () => ({
  getFunctionName: vi.fn(() => 'items:update'),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: mockToast,
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { useConvexMutation as useMutationFn } from '@convex-dev/react-query';
import { useMutation } from '@tanstack/react-query';

import { useConvexMutation } from './use-convex-mutation';

const mockUseMutationFn = vi.mocked(useMutationFn);
const mockUseMutation = vi.mocked(useMutation);
const mockMutationRef = {
  _name: 'items:update',
} as unknown as Parameters<typeof useConvexMutation>[0];

// Pull the `onError` handler the hook registered with useMutation.
function getRegisteredOnError() {
  const options = mockUseMutation.mock.calls[0]?.[0] as {
    onError: (error: Error, ...rest: unknown[]) => void;
  };
  return options.onError;
}

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

  it('passes the function reference to useConvexMutation from @convex-dev/react-query', () => {
    useConvexMutation(mockMutationRef);
    expect(mockUseMutationFn).toHaveBeenCalledWith(mockMutationRef);
  });

  it('uses the returned function as mutationFn when no optimistic update', () => {
    useConvexMutation(mockMutationRef);
    const options = mockUseMutation.mock.calls[0]?.[0];
    const args = { input: 'test' };
    (options.mutationFn as (a: unknown) => unknown)(args);
    expect(mockMutationFn).toHaveBeenCalledWith(args);
    expect(mockMutationFn.withOptimisticUpdate).not.toHaveBeenCalled();
  });

  it('wires the optimistic update through withOptimisticUpdate', () => {
    const optimisticUpdate = vi.fn();
    useConvexMutation(mockMutationRef, { optimisticUpdate });
    expect(mockMutationFn.withOptimisticUpdate).toHaveBeenCalledWith(
      optimisticUpdate,
    );
    const options = mockUseMutation.mock.calls[0]?.[0];
    const args = { input: 'test' };
    (options.mutationFn as (a: unknown) => unknown)(args);
    expect(mockOptimisticFn).toHaveBeenCalledWith(args);
  });

  it('shows a destructive error toast by default on failure', () => {
    useConvexMutation(mockMutationRef);
    getRegisteredOnError()(new Error('boom'));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('suppresses the error toast when errorToast is false', () => {
    useConvexMutation(mockMutationRef, { errorToast: false });
    getRegisteredOnError()(new Error('boom'));
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('uses the provided title and description on error', () => {
    useConvexMutation(mockMutationRef, {
      errorToast: { title: 'Save failed', description: (e) => e.message },
    });
    getRegisteredOnError()(new Error('disk full'));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Save failed',
        description: 'disk full',
        variant: 'destructive',
      }),
    );
  });

  it('still calls a caller-provided onError', () => {
    const userOnError = vi.fn();
    useConvexMutation(mockMutationRef, { onError: userOnError });
    const error = new Error('boom');
    getRegisteredOnError()(error, { input: 'x' }, undefined, {});
    expect(userOnError).toHaveBeenCalledWith(
      error,
      { input: 'x' },
      undefined,
      {},
    );
  });

  it('preserves user options', () => {
    const userOnSuccess = vi.fn();
    const userOnSettled = vi.fn();
    useConvexMutation(mockMutationRef, {
      onSuccess: userOnSuccess,
      onSettled: userOnSettled,
    });
    const options = mockUseMutation.mock.calls[0]?.[0];
    expect(options.onSuccess).toBe(userOnSuccess);
    expect(options.onSettled).toBe(userOnSettled);
  });
});
