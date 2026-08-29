import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockActionFn, mockToast } = vi.hoisted(() => ({
  mockActionFn: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock('@convex-dev/react-query', () => ({
  useConvexAction: vi.fn(() => mockActionFn),
}));

// The hook now resolves toast copy through i18n and reports the failing
// function by name, so those collaborators are mocked exactly like the sibling
// `use-convex-mutation` suite. Without them the hook cannot be called outside a
// React render: `useTranslation` reaches for a context that does not exist.
vi.mock('convex/server', () => ({
  getFunctionName: vi.fn(() => 'items:process'),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: mockToast,
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
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
  useQueryClient: vi.fn(() => mockQueryClient),
}));

// The registry is swapped for one controllable row so these tests cover the
// WRAPPER's wiring; the real rows are covered in `app/lib/backend/*.test.ts`.
const { mockWriteRun, mockQueryClient, mockOrgId } = vi.hoisted(() => ({
  mockWriteRun: vi.fn(),
  mockQueryClient: { invalidateQueries: vi.fn() },
  mockOrgId: { current: undefined as string | undefined },
}));
vi.mock('@/app/lib/backend/convex-adapters', () => ({
  WRITE_ADAPTERS: { 'fake:write': { run: mockWriteRun } },
  activeOrganizationId: () => mockOrgId.current,
  runAdapted: (run: () => Promise<unknown>) => run(),
}));

import { useConvexAction as useActionFn } from '@convex-dev/react-query';
import { useMutation } from '@tanstack/react-query';
import { getFunctionName } from 'convex/server';

import { useConvexAction } from './use-convex-action';

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
    expect(options).toHaveProperty('mutationFn');
    const args = { input: 'test' };
    (options.mutationFn as Function)(args);
    expect(mockActionFn).toHaveBeenCalledWith(args);
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
    expect(options.onSettled).toBe(userOnSettled);
    // `onSuccess` and `onError` are deliberately NOT passed through by
    // reference: the hook wraps them (adapter invalidation first, error toast
    // first). The contract is that the caller's handler still runs, not that
    // it is the same function.
    expect(options.onSuccess).not.toBe(userOnSuccess);
    (options.onSuccess as (...a: unknown[]) => void)('data', { input: 'x' });
    expect(userOnSuccess).toHaveBeenCalledWith('data', { input: 'x' });
    expect(options.onError).not.toBe(userOnError);
    (options.onError as (e: Error) => void)(new Error('boom'));
    expect(userOnError).toHaveBeenCalled();
  });
});

// #2935 gave `useConvexAction` the same error-toast machinery
// `useConvexMutation` already had, but none of it was covered. These mirror
// the sibling suite so the two hooks cannot drift apart silently.
describe('useConvexAction error toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Pull the `onError` handler the hook registered with useMutation. */
  function getRegisteredOnError() {
    const options = mockUseMutation.mock.calls[0]?.[0] as {
      onError: (error: Error, ...rest: unknown[]) => void;
    };
    return options.onError;
  }

  it('shows a destructive toast by default so a failed action never lingers silently', () => {
    useConvexAction(mockActionRef);
    getRegisteredOnError()(new Error('boom'));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('suppresses the toast when errorToast is false', () => {
    useConvexAction(mockActionRef, { errorToast: false });
    getRegisteredOnError()(new Error('boom'));
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('uses the provided title and description', () => {
    useConvexAction(mockActionRef, {
      errorToast: { title: 'Run failed', description: (e) => e.message },
    });
    getRegisteredOnError()(new Error('disk full'));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Run failed',
        description: 'disk full',
        variant: 'destructive',
      }),
    );
  });
});

describe('useConvexAction adapter lane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFunctionName).mockReturnValue('fake:write');
    mockOrgId.current = 'org-1';
  });

  it('routes mutationFn through the adapter with the route org', async () => {
    mockWriteRun.mockResolvedValue({ created: true });

    useConvexAction(mockActionRef);

    const options = mockUseMutation.mock.calls[0]?.[0];
    await expect(
      (options.mutationFn as (args: unknown) => Promise<unknown>)({
        name: 'API_KEY',
      }),
    ).resolves.toEqual({ created: true });
    expect(mockWriteRun).toHaveBeenCalledWith(
      { name: 'API_KEY' },
      { organizationId: 'org-1' },
    );
    expect(mockActionFn).not.toHaveBeenCalled();
  });
});
