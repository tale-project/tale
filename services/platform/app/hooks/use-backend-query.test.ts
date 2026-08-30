import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { QueryName } from '@/app/lib/backend/contract';

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((options: unknown) => ({
    data: undefined,
    isLoading: true,
    error: null,
    _options: options,
  })),
}));

const mockUseConvexAuth = vi.fn(() => ({
  isAuthenticated: true,
  isLoading: false,
}));
vi.mock('./use-session-user', () => ({
  useSessionUser: () => mockUseConvexAuth(),
}));

// The adapter seam resolves the function name on every call; the plain mock
// ref carries no name.
// The registry is swapped for one controllable row so these tests cover the
// WRAPPER's wiring; the real rows are covered in `app/lib/backend/*.test.ts`.
const { mockAdapterRow, mockOrgId } = vi.hoisted(() => ({
  mockAdapterRow: vi.fn(),
  mockOrgId: { current: undefined as string | undefined },
}));
vi.mock('@/app/lib/backend/adapters', () => ({
  READ_ADAPTERS: { 'fake:adapted': mockAdapterRow },
  activeOrganizationId: () => mockOrgId.current,
  runAdapted: (run: () => Promise<unknown>) => run(),
  retryAdaptedRead: () => false,
}));

import { useQuery } from '@tanstack/react-query';

import { useBackendQuery } from './use-backend-query';

/** A row that exists only in this file's stub registry — the
 *  wrapper's own wiring is what these tests cover, not a shipped
 *  contract entry. */
const FAKE_ROW = 'fake:adapted' as QueryName;

const mockUseQuery = vi.mocked(useQuery);

/** A read with no row in the stub registry — the refusal path. */
const queryName = 'items:list' as Parameters<typeof useBackendQuery>[0];

function lastEnabled(): boolean | undefined {
  const passed = mockUseQuery.mock.calls[0]?.[0] as { enabled?: boolean };
  return passed?.enabled;
}

describe('useBackendQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it('refuses, NAMED, when the read has no backend row', async () => {
    useBackendQuery(queryName, { organizationId: 'org-123' });

    const passed = mockUseQuery.mock.calls[0]?.[0] as {
      queryKey: unknown[];
      queryFn: () => Promise<unknown>;
    };
    expect(passed.queryKey).toEqual(['convex-retired', 'items:list']);
    await expect(passed.queryFn()).rejects.toThrow('items:list');
    expect(mockUseQuery).toHaveBeenCalledTimes(1);
  });

  it('a skipped read never fires the refusal', () => {
    useBackendQuery(queryName, 'skip');

    expect(lastEnabled()).toBe(false);
    expect(mockUseQuery).toHaveBeenCalledTimes(1);
  });

  it('returns useQuery result', () => {
    const mockResult = { data: [1, 2, 3], isLoading: false, error: null };
    mockUseQuery.mockReturnValueOnce(mockResult as ReturnType<typeof useQuery>);

    const result = useBackendQuery(queryName, {});

    expect(result.data).toEqual([1, 2, 3]);
    expect(result.isLoading).toBe(false);
  });

  it('merges cache options into useQuery call', () => {
    const args = { organizationId: 'org-123' };
    const options = { staleTime: 10_000, gcTime: 60_000 };

    useBackendQuery(queryName, args, options);

    const passedOptions = mockUseQuery.mock.calls[0]?.[0];
    expect(passedOptions).toMatchObject(options);
  });

  it('does not include undefined options when omitted', () => {
    const args = { organizationId: 'org-123' };

    useBackendQuery(queryName, args);

    const passedOptions = mockUseQuery.mock.calls[0]?.[0];
    expect(passedOptions).not.toHaveProperty('staleTime');
    expect(passedOptions).not.toHaveProperty('gcTime');
  });

  it('merges enabled option into useQuery call', () => {
    const args = { organizationId: 'org-123' };

    useBackendQuery(queryName, args, { enabled: false });

    const passedOptions = mockUseQuery.mock.calls[0]?.[0] as {
      enabled?: boolean;
    };
    expect(passedOptions?.enabled).toBe(false);
  });

  it('a caller enabled:false disables the query while keeping its key', () => {
    useBackendQuery(
      queryName,
      { organizationId: 'org-123' },
      { enabled: false },
    );

    const passedOptions = mockUseQuery.mock.calls[0]?.[0] as {
      enabled?: boolean;
      queryKey: unknown[];
    };
    expect(passedOptions?.enabled).toBe(false);
    expect(passedOptions.queryKey).toEqual(['convex-retired', 'items:list']);
  });

  it('gates on auth by default: disabled while unauthenticated', () => {
    mockUseConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });

    useBackendQuery(queryName, { organizationId: 'org-123' });

    expect(lastEnabled()).toBe(false);
  });

  it('enabled once authenticated by default', () => {
    useBackendQuery(queryName, { organizationId: 'org-123' });

    expect(lastEnabled()).toBe(true);
  });

  it('requireAuth:false runs even when unauthenticated', () => {
    mockUseConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });

    useBackendQuery(
      queryName,
      { organizationId: 'org-123' },
      {
        requireAuth: false,
      },
    );

    expect(lastEnabled()).toBe(true);
  });

  it('caller enabled:false still wins when authenticated', () => {
    useBackendQuery(
      queryName,
      { organizationId: 'org-123' },
      {
        enabled: false,
      },
    );

    expect(lastEnabled()).toBe(false);
  });

  it('does not leak requireAuth into useQuery options', () => {
    useBackendQuery(
      queryName,
      { organizationId: 'org-123' },
      {
        requireAuth: false,
      },
    );

    const passedOptions = mockUseQuery.mock.calls[0]?.[0];
    expect(passedOptions).not.toHaveProperty('requireAuth');
  });
});

describe('useBackendQuery adapter lane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The whole point of the lane: the WebSocket never authenticates in
    // hybrid dev, and adapted reads must not care.
    mockUseConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mockOrgId.current = undefined;
  });

  it('serves an adapted read over HTTP with no WebSocket-auth gate', () => {
    const queryFn = () => Promise.resolve(['row']);
    mockAdapterRow.mockReturnValue({
      queryKey: ['backend', 'org-1', 'project', 'list'],
      queryFn,
    });

    useBackendQuery(FAKE_ROW, { organizationId: 'org-1' });

    expect(mockAdapterRow).toHaveBeenCalledWith(
      { organizationId: 'org-1' },
      {},
    );
    const passed = mockUseQuery.mock.calls[0]?.[0] as {
      queryKey?: unknown;
      enabled?: boolean;
    };
    expect(passed.queryKey).toEqual(['backend', 'org-1', 'project', 'list']);
    expect(passed.enabled).toBe(true);
  });

  it('hands the route org to the adapter when args carry none', () => {
    mockOrgId.current = 'org-route';
    mockAdapterRow.mockReturnValue({
      queryKey: ['k'],
      queryFn: () => Promise.resolve(null),
    });

    useBackendQuery(FAKE_ROW, {});

    expect(mockAdapterRow).toHaveBeenCalledWith(
      {},
      { organizationId: 'org-route' },
    );
  });

  it("'skip' keeps the adapted read disabled without building options", () => {
    useBackendQuery(FAKE_ROW, 'skip');

    expect(mockAdapterRow).not.toHaveBeenCalled();
    expect(lastEnabled()).toBe(false);
  });

  it('an unservable row (adapter answers null) stays disabled', () => {
    mockAdapterRow.mockReturnValue(null);

    useBackendQuery(FAKE_ROW, {});

    expect(lastEnabled()).toBe(false);
  });

  it('caller options still merge on the adapted lane', () => {
    mockAdapterRow.mockReturnValue({
      queryKey: ['k'],
      queryFn: () => Promise.resolve(null),
    });

    useBackendQuery(
      queryName,
      { organizationId: 'org-1' },
      { enabled: false, staleTime: 5 },
    );

    const passed = mockUseQuery.mock.calls[0]?.[0] as {
      enabled?: boolean;
      staleTime?: number;
    };
    expect(passed.enabled).toBe(false);
    expect(passed.staleTime).toBe(5);
  });
});
