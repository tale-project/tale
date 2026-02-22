import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: vi.fn((func: unknown, args: unknown) => ({
    queryKey: ['convexQuery', func, args],
    queryFn: vi.fn(),
  })),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    members: {
      queries: {
        getCurrentMemberContext: {},
      },
    },
  },
}));

import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';

import { useCurrentMemberContext } from '../use-current-member-context';

const mockConvexQuery = vi.mocked(convexQuery);
const mockUseQuery = vi.mocked(useQuery);

describe('useCurrentMemberContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses stable { organizationId } query key when skip=false', () => {
    useCurrentMemberContext('org-123', false);

    expect(mockConvexQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-123',
    });
    const options = mockUseQuery.mock.calls[0]?.[0] as { enabled?: boolean };
    expect(options?.enabled).toBe(true);
  });

  it('uses stable { organizationId } query key when skip=true (not "skip" string)', () => {
    useCurrentMemberContext('org-123', true);

    // Must use { organizationId } key, NOT 'skip' string, to preserve cached data
    expect(mockConvexQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-123',
    });
    const options = mockUseQuery.mock.calls[0]?.[0] as { enabled?: boolean };
    expect(options?.enabled).toBe(false);
  });

  it('returns cached data when skip=true (enabled=false)', () => {
    const cachedData = {
      role: 'admin' as const,
      memberId: 'm1',
      organizationId: 'org-123',
      userId: 'u1',
      isAdmin: true,
      createdAt: 0,
    };
    mockUseQuery.mockReturnValueOnce({
      data: cachedData,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useQuery>);

    const result = useCurrentMemberContext('org-123', true);

    // Data from cache should be returned even when skip=true
    expect(result.data).toEqual(cachedData);
  });

  it('forces isLoading=true when skip=true regardless of query loading state', () => {
    // Simulates disabled query with cached data: isLoading=false from useQuery
    mockUseQuery.mockReturnValueOnce({
      data: { role: 'admin' },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useQuery>);

    const result = useCurrentMemberContext('org-123', true);

    expect(result.isLoading).toBe(true);
  });

  it('forces isLoading=true when skip=true and no cached data', () => {
    mockUseQuery.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useQuery>);

    const result = useCurrentMemberContext('org-123', true);

    expect(result.isLoading).toBe(true);
  });

  it('passes isLoading through from useQuery when skip=false', () => {
    mockUseQuery.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useQuery>);

    const result = useCurrentMemberContext('org-123', false);

    expect(result.isLoading).toBe(true);
  });

  it('falls back to "skip" key when organizationId is undefined', () => {
    useCurrentMemberContext(undefined, false);

    expect(mockConvexQuery).toHaveBeenCalledWith(expect.anything(), 'skip');
    const options = mockUseQuery.mock.calls[0]?.[0] as { enabled?: boolean };
    expect(options?.enabled).toBe(false);
  });

  it('uses default skip=false when not provided', () => {
    useCurrentMemberContext('org-123');

    const options = mockUseQuery.mock.calls[0]?.[0] as { enabled?: boolean };
    expect(options?.enabled).toBe(true);
  });
});
