import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { MutationName } from '@/app/lib/backend/contract';

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

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
  useQueryClient: vi.fn(() => mockQueryClient),
}));

// The registry is swapped for one controllable row so these tests cover the
// WRAPPER's wiring; the real rows are covered in `app/lib/backend/*.test.ts`.
const { mockWriteRun, mockWriteInvalidate, mockQueryClient, mockOrgId } =
  vi.hoisted(() => ({
    mockWriteRun: vi.fn(),
    mockWriteInvalidate: vi.fn(),
    mockQueryClient: { invalidateQueries: vi.fn() },
    mockOrgId: { current: undefined as string | undefined },
  }));
vi.mock('@/app/lib/backend/convex-adapters', () => ({
  WRITE_ADAPTERS: {
    'fake:write': { run: mockWriteRun, invalidate: mockWriteInvalidate },
  },
  activeOrganizationId: () => mockOrgId.current,
  runAdapted: (run: () => Promise<unknown>) => run(),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: mockToast,
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { useMutation } from '@tanstack/react-query';

import { useConvexMutation } from './use-convex-mutation';

/** A row that exists only in this file's stub registry — the
 *  wrapper's own wiring is what these tests cover, not a shipped
 *  contract entry. */
const FAKE_ROW = 'fake:write' as MutationName;

const mockUseMutation = vi.mocked(useMutation);
const mutationName = 'items:update' as Parameters<typeof useConvexMutation>[0];

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
    const result = useConvexMutation(mutationName);
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('mutate');
    expect(result).toHaveProperty('isPending');
  });

  it('refuses, NAMED, when the write has no backend row', async () => {
    useConvexMutation(mutationName);
    const options = mockUseMutation.mock.calls[0]?.[0];
    await expect(
      (options.mutationFn as (a: unknown) => Promise<unknown>)({
        input: 'test',
      }),
    ).rejects.toThrow('items:update');
  });

  it('shows a destructive error toast by default on failure', () => {
    useConvexMutation(mutationName);
    getRegisteredOnError()(new Error('boom'));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('suppresses the error toast when errorToast is false', () => {
    useConvexMutation(mutationName, { errorToast: false });
    getRegisteredOnError()(new Error('boom'));
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('uses the provided title and description on error', () => {
    useConvexMutation(mutationName, {
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
    useConvexMutation(mutationName, { onError: userOnError });
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
    useConvexMutation(mutationName, {
      onSuccess: userOnSuccess,
      onSettled: userOnSettled,
    });
    const options = mockUseMutation.mock.calls[0]?.[0];
    expect(options.onSettled).toBe(userOnSettled);
    // `onSuccess` is deliberately NOT passed through by reference: the hook
    // wraps it so an adapter's invalidations fire first. The contract is that
    // the caller's handler still runs, not that it is the same function.
    expect(options.onSuccess).not.toBe(userOnSuccess);
    (options.onSuccess as (...a: unknown[]) => void)('data', { input: 'x' });
    expect(userOnSuccess).toHaveBeenCalledWith('data', { input: 'x' });
  });
});

describe('useConvexMutation adapter lane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgId.current = 'org-1';
  });

  it('routes mutationFn through the adapter with the route org', async () => {
    mockWriteRun.mockResolvedValue('p-1');

    useConvexMutation(FAKE_ROW);

    const options = mockUseMutation.mock.calls[0]?.[0];
    await expect(
      (options.mutationFn as (args: unknown) => Promise<unknown>)({
        projectId: 'p1',
      }),
    ).resolves.toBe('p-1');
    expect(mockWriteRun).toHaveBeenCalledWith(
      { projectId: 'p1' },
      { organizationId: 'org-1' },
    );
  });

  it('fires the adapter invalidations before the caller onSuccess', () => {
    const order: string[] = [];
    mockWriteInvalidate.mockImplementation(() => order.push('invalidate'));
    const userOnSuccess = vi.fn(() => order.push('caller'));

    useConvexMutation(FAKE_ROW, { onSuccess: userOnSuccess });

    const options = mockUseMutation.mock.calls[0]?.[0];
    (options.onSuccess as (...a: unknown[]) => void)(
      'data',
      { projectId: 'p1' },
      undefined,
      {},
    );
    expect(mockWriteInvalidate).toHaveBeenCalledWith(
      mockQueryClient,
      { projectId: 'p1' },
      { organizationId: 'org-1' },
    );
    expect(order).toEqual(['invalidate', 'caller']);
  });
});
