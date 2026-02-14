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

import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';

import { useConvexQuery } from '../use-convex-query';

const mockConvexQuery = vi.mocked(convexQuery);
const mockUseQuery = vi.mocked(useQuery);

const mockQueryRef = {} as Parameters<typeof useConvexQuery>[0];

describe('useConvexQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(result).toBe(mockResult);
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
});
