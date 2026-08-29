import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: vi.fn((...args: unknown[]) => ({
    queryKey: ['convexQuery', ...args],
    queryFn: vi.fn(),
  })),
}));

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
vi.mock('convex/react', () => ({
  useConvexAuth: () => mockUseConvexAuth(),
}));

// The adapter seam resolves the function name on every call; the plain mock
// ref carries no name.
vi.mock('convex/server', () => ({
  getFunctionName: vi.fn(() => 'items:list'),
}));

// The registry is swapped for one controllable row so these tests cover the
// WRAPPER's wiring; the real rows are covered in `app/lib/backend/*.test.ts`.
const { mockAdapterRow, mockOrgId } = vi.hoisted(() => ({
  mockAdapterRow: vi.fn(),
  mockOrgId: { current: undefined as string | undefined },
}));
vi.mock('@/app/lib/backend/convex-adapters', () => ({
  READ_ADAPTERS: { 'fake:adapted': mockAdapterRow },
  activeOrganizationId: () => mockOrgId.current,
  runAdapted: (run: () => Promise<unknown>) => run(),
  retryAdaptedRead: () => false,
}));

import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { getFunctionName } from 'convex/server';

import { useConvexQuery } from './use-convex-query';

const mockConvexQuery = vi.mocked(convexQuery);
const mockUseQuery = vi.mocked(useQuery);

const mockQueryRef = {} as Parameters<typeof useConvexQuery>[0];

function lastEnabled(): boolean | undefined {
  const passed = mockUseQuery.mock.calls[0]?.[0] as { enabled?: boolean };
  return passed?.enabled;
}

describe('useConvexQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it('passes query function and args to convexQuery', () => {
    const args = { organizationId: 'org-123' };

    useConvexQuery(mockQueryRef, args);

    expect(mockConvexQuery).toHaveBeenCalledWith(mockQueryRef, args);
    expect(mockUseQuery).toHaveBeenCalledTimes(1);
  });

  it('passes empty object when no args provided', () => {
    useConvexQuery(mockQueryRef);

    expect(mockConvexQuery).toHaveBeenCalledWith(mockQueryRef, {});
    expect(mockUseQuery).toHaveBeenCalledTimes(1);
  });

  it('passes skip string to convexQuery', () => {
    useConvexQuery(mockQueryRef, 'skip');

    expect(mockConvexQuery).toHaveBeenCalledWith(mockQueryRef, 'skip');
    expect(mockUseQuery).toHaveBeenCalledTimes(1);
  });

  it('returns useQuery result', () => {
    const mockResult = { data: [1, 2, 3], isLoading: false, error: null };
    mockUseQuery.mockReturnValueOnce(mockResult as ReturnType<typeof useQuery>);

    const result = useConvexQuery(mockQueryRef, {});

    expect(result.data).toEqual([1, 2, 3]);
    expect(result.isLoading).toBe(false);
  });

  it('merges cache options into useQuery call', () => {
    const args = { organizationId: 'org-123' };
    const options = { staleTime: 10_000, gcTime: 60_000 };

    useConvexQuery(mockQueryRef, args, options);

    const passedOptions = mockUseQuery.mock.calls[0]?.[0];
    expect(passedOptions).toMatchObject(options);
  });

  it('does not include undefined options when omitted', () => {
    const args = { organizationId: 'org-123' };

    useConvexQuery(mockQueryRef, args);

    const passedOptions = mockUseQuery.mock.calls[0]?.[0];
    expect(passedOptions).not.toHaveProperty('staleTime');
    expect(passedOptions).not.toHaveProperty('gcTime');
  });

  it('merges enabled option into useQuery call', () => {
    const args = { organizationId: 'org-123' };

    useConvexQuery(mockQueryRef, args, { enabled: false });

    const passedOptions = mockUseQuery.mock.calls[0]?.[0] as {
      enabled?: boolean;
    };
    expect(passedOptions?.enabled).toBe(false);
  });

  it('enabled option overrides convexQuery enabled when provided', () => {
    // Even with normal args (which would produce enabled:true from convexQuery),
    // passing enabled:false disables the query while keeping the stable query key.
    useConvexQuery(
      mockQueryRef,
      { organizationId: 'org-123' },
      { enabled: false },
    );

    expect(mockConvexQuery).toHaveBeenCalledWith(mockQueryRef, {
      organizationId: 'org-123',
    });
    const passedOptions = mockUseQuery.mock.calls[0]?.[0] as {
      enabled?: boolean;
    };
    expect(passedOptions?.enabled).toBe(false);
  });

  it('gates on auth by default: disabled while unauthenticated', () => {
    mockUseConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });

    useConvexQuery(mockQueryRef, { organizationId: 'org-123' });

    expect(lastEnabled()).toBe(false);
  });

  it('enabled once authenticated by default', () => {
    useConvexQuery(mockQueryRef, { organizationId: 'org-123' });

    expect(lastEnabled()).toBe(true);
  });

  it('requireAuth:false runs even when unauthenticated', () => {
    mockUseConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });

    useConvexQuery(
      mockQueryRef,
      { organizationId: 'org-123' },
      {
        requireAuth: false,
      },
    );

    expect(lastEnabled()).toBe(true);
  });

  it('caller enabled:false still wins when authenticated', () => {
    useConvexQuery(
      mockQueryRef,
      { organizationId: 'org-123' },
      {
        enabled: false,
      },
    );

    expect(lastEnabled()).toBe(false);
  });

  it('does not leak requireAuth into useQuery options', () => {
    useConvexQuery(
      mockQueryRef,
      { organizationId: 'org-123' },
      {
        requireAuth: false,
      },
    );

    const passedOptions = mockUseQuery.mock.calls[0]?.[0];
    expect(passedOptions).not.toHaveProperty('requireAuth');
  });
});

describe('useConvexQuery adapter lane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFunctionName).mockReturnValue('fake:adapted');
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

    useConvexQuery(mockQueryRef, { organizationId: 'org-1' });

    expect(mockAdapterRow).toHaveBeenCalledWith(
      { organizationId: 'org-1' },
      {},
    );
    expect(mockConvexQuery).not.toHaveBeenCalled();
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

    useConvexQuery(mockQueryRef, {});

    expect(mockAdapterRow).toHaveBeenCalledWith(
      {},
      { organizationId: 'org-route' },
    );
  });

  it("'skip' keeps the adapted read disabled without building options", () => {
    useConvexQuery(mockQueryRef, 'skip');

    expect(mockAdapterRow).not.toHaveBeenCalled();
    expect(mockConvexQuery).not.toHaveBeenCalled();
    expect(lastEnabled()).toBe(false);
  });

  it('an unservable row (adapter answers null) stays disabled', () => {
    mockAdapterRow.mockReturnValue(null);

    useConvexQuery(mockQueryRef, {});

    expect(lastEnabled()).toBe(false);
  });

  it('caller options still merge on the adapted lane', () => {
    mockAdapterRow.mockReturnValue({
      queryKey: ['k'],
      queryFn: () => Promise.resolve(null),
    });

    useConvexQuery(
      mockQueryRef,
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
