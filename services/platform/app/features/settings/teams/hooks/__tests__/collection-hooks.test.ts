import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollection = Symbol('collection');

vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn((_builder: (q: unknown) => unknown, _deps: unknown[]) => {
    return { data: [], isLoading: false };
  }),
}));

import { useLiveQuery } from '@tanstack/react-db';

import { useTeams, useTeamMembers } from '../queries';

const mockUseLiveQuery = vi.mocked(useLiveQuery);

describe('useTeams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data when loaded', () => {
    const teams = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: teams,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useTeams(mockCollection as never);
    expect(result.teams).toBe(teams);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useTeams(mockCollection as never);
    expect(result.teams).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});

describe('useTeamMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data when loaded', () => {
    const members = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: members,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useTeamMembers(mockCollection as never);
    expect(result.teamMembers).toBe(members);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useTeamMembers(mockCollection as never);
    expect(result.teamMembers).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});
