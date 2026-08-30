import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ActionName } from '@/app/lib/backend/contract';

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

// The hook now resolves toast copy through i18n and reports the failing
// function by name, so those collaborators are mocked exactly like the sibling
// `use-backend-mutation` suite. Without them the hook cannot be called outside a
// React render: `useTranslation` reaches for a context that does not exist.
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
vi.mock('@/app/lib/backend/adapters', () => ({
  WRITE_ADAPTERS: { 'fake:write': { run: mockWriteRun } },
  activeOrganizationId: () => mockOrgId.current,
  runAdapted: (run: () => Promise<unknown>) => run(),
}));

import { useMutation } from '@tanstack/react-query';

import { useBackendAction } from './use-backend-action';

/** A row that exists only in this file's stub registry — the
 *  wrapper's own wiring is what these tests cover, not a shipped
 *  contract entry. */
const FAKE_ROW = 'fake:write' as ActionName;

const mockUseMutation = vi.mocked(useMutation);
const actionName = 'items:process' as Parameters<typeof useBackendAction>[0];

describe('useBackendAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object with mutateAsync', () => {
    const result = useBackendAction(actionName);
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('mutate');
    expect(result).toHaveProperty('isPending');
  });

  it('returns isPending as false initially', () => {
    const result = useBackendAction(actionName);
    expect(result.isPending).toBe(false);
  });

  it('refuses, NAMED, when the action has no backend row', async () => {
    useBackendAction(actionName);
    const options = mockUseMutation.mock.calls[0]?.[0];
    expect(options).toHaveProperty('mutationFn');
    await expect(
      (options.mutationFn as (a: unknown) => Promise<unknown>)({
        input: 'test',
      }),
    ).rejects.toThrow('items:process');
  });

  it('preserves user options', () => {
    const userOnSuccess = vi.fn();
    const userOnError = vi.fn();
    const userOnSettled = vi.fn();
    useBackendAction(actionName, {
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

// #2935 gave `useBackendAction` the same error-toast machinery
// `useBackendMutation` already had, but none of it was covered. These mirror
// the sibling suite so the two hooks cannot drift apart silently.
describe('useBackendAction error toast', () => {
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
    useBackendAction(actionName);
    getRegisteredOnError()(new Error('boom'));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('suppresses the toast when errorToast is false', () => {
    useBackendAction(actionName, { errorToast: false });
    getRegisteredOnError()(new Error('boom'));
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('uses the provided title and description', () => {
    useBackendAction(actionName, {
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

describe('useBackendAction adapter lane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgId.current = 'org-1';
  });

  it('routes mutationFn through the adapter with the route org', async () => {
    mockWriteRun.mockResolvedValue({ created: true });

    useBackendAction(FAKE_ROW);

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
  });
});
