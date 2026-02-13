import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollection = Symbol('collection');
let capturedQueryBuilder: ((q: unknown) => unknown) | null = null;

vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn((builder: (q: unknown) => unknown, _deps: unknown[]) => {
    capturedQueryBuilder = builder;
    return { data: [], isLoading: false };
  }),
}));

vi.mock('@/app/hooks/use-team-filter', () => ({
  useTeamFilter: vi.fn(() => ({ selectedTeamId: null })),
}));

import { useLiveQuery } from '@tanstack/react-db';

import { useTeamFilter } from '@/app/hooks/use-team-filter';

import { useChatAgents } from '../queries';

const mockUseLiveQuery = vi.mocked(useLiveQuery);
const mockUseTeamFilter = vi.mocked(useTeamFilter);

type Agent = {
  _id: string;
  status: string;
  teamId?: string;
  sharedWithTeamIds?: string[];
};

function extractWhereFilter(): (row: { agent: Agent }) => boolean {
  if (!capturedQueryBuilder) throw new Error('No query builder captured');

  let whereFilter: ((row: { agent: Agent }) => boolean) | null = null;

  const mockQ = {
    from: () => ({
      fn: {
        where: (fn: (row: { agent: Agent }) => boolean) => {
          whereFilter = fn;
          return {
            select: (
              _fn: (row: { agent: Agent }) => Record<string, unknown>,
            ) => {
              // select now returns an explicit field object, not the proxy reference
            },
          };
        },
      },
    }),
  };

  capturedQueryBuilder(mockQ);
  if (!whereFilter) throw new Error('No where filter captured');
  return whereFilter;
}

describe('useChatAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedQueryBuilder = null;
  });

  it('returns data even while loading', () => {
    const agents = [{ _id: 'a1', name: 'Agent 1' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: agents,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useChatAgents(mockCollection as never);
    expect(result.agents).toBe(agents);
  });

  it('returns data when loaded', () => {
    const agents = [{ _id: 'a1', name: 'Agent 1' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: agents,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useChatAgents(mockCollection as never);
    expect(result.agents).toBe(agents);
  });

  it('filters for active status only', () => {
    mockUseTeamFilter.mockReturnValue({ selectedTeamId: null } as ReturnType<
      typeof useTeamFilter
    >);
    useChatAgents(mockCollection as never);

    const filter = extractWhereFilter();

    expect(filter({ agent: { _id: 'a1', status: 'active' } })).toBe(true);
    expect(filter({ agent: { _id: 'a2', status: 'draft' } })).toBe(false);
    expect(filter({ agent: { _id: 'a3', status: 'archived' } })).toBe(false);
  });

  it('filters by team when team filter is active', () => {
    mockUseTeamFilter.mockReturnValue({
      selectedTeamId: 'team-1',
    } as ReturnType<typeof useTeamFilter>);
    useChatAgents(mockCollection as never);

    const filter = extractWhereFilter();

    expect(
      filter({ agent: { _id: 'a1', status: 'active', teamId: 'team-1' } }),
    ).toBe(true);

    expect(
      filter({
        agent: {
          _id: 'a2',
          status: 'active',
          teamId: 'team-2',
          sharedWithTeamIds: ['team-1'],
        },
      }),
    ).toBe(true);

    expect(
      filter({ agent: { _id: 'a3', status: 'active', teamId: 'team-2' } }),
    ).toBe(false);

    expect(
      filter({ agent: { _id: 'a4', status: 'draft', teamId: 'team-1' } }),
    ).toBe(false);
  });
});
