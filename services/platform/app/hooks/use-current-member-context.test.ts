import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-query', () => ({
  queryOptions: vi.fn((options: unknown) => options),
  useQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    error: null,
  })),
}));

import { useQuery } from '@tanstack/react-query';

import { useCurrentMemberContext } from './use-current-member-context';

const mockUseQuery = vi.mocked(useQuery);

type PassedOptions = { queryKey?: unknown; enabled?: boolean };

function passedOptions(): PassedOptions {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mock records exactly what the hook passed
  return (mockUseQuery.mock.calls[0]?.[0] ?? {}) as PassedOptions;
}

describe('useCurrentMemberContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the stable backend query key when skip=false', () => {
    useCurrentMemberContext('org-123', false);

    const options = passedOptions();
    expect(options.queryKey).toEqual([
      'backend',
      'org-123',
      'member',
      'context',
    ]);
    expect(options.enabled).toBe(true);
  });

  it('keeps the same key when skip=true (cached data must survive)', () => {
    useCurrentMemberContext('org-123', true);

    const options = passedOptions();
    expect(options.queryKey).toEqual([
      'backend',
      'org-123',
      'member',
      'context',
    ]);
    expect(options.enabled).toBe(false);
  });

  it('returns cached data when skip=true (enabled=false)', () => {
    const cachedData = {
      status: 'ok' as const,
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
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the hook reads only these fields
    } as ReturnType<typeof useQuery>);

    const result = useCurrentMemberContext('org-123', true);

    expect(result.data).toEqual(cachedData);
  });

  it('forces isLoading=true when skip=true regardless of query loading state', () => {
    mockUseQuery.mockReturnValueOnce({
      data: { status: 'ok', role: 'admin' },
      isLoading: false,
      error: null,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the hook reads only these fields
    } as ReturnType<typeof useQuery>);

    const result = useCurrentMemberContext('org-123', true);

    expect(result.isLoading).toBe(true);
  });

  it('forces isLoading=true when skip=true and no cached data', () => {
    mockUseQuery.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: null,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the hook reads only these fields
    } as ReturnType<typeof useQuery>);

    const result = useCurrentMemberContext('org-123', true);

    expect(result.isLoading).toBe(true);
  });

  it('passes isLoading through from useQuery when skip=false', () => {
    mockUseQuery.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the hook reads only these fields
    } as ReturnType<typeof useQuery>);

    const result = useCurrentMemberContext('org-123', false);

    expect(result.isLoading).toBe(true);
  });

  it('disables the query while the organization id is unknown', () => {
    useCurrentMemberContext(undefined, false);

    const options = passedOptions();
    expect(options.enabled).toBe(false);
  });

  it('disables the query when both the id is missing and skip=true', () => {
    useCurrentMemberContext(undefined, true);

    const options = passedOptions();
    expect(options.enabled).toBe(false);

    const result = useCurrentMemberContext(undefined, true);
    expect(result.isLoading).toBe(true);
  });
});
