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

import {
  useCustomAgents,
  useCustomAgentVersions,
  useCustomAgentWebhooks,
} from '../queries';

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
            select: (fn: (row: { agent: Agent }) => unknown) => {
              const agent = { _id: 'test', status: 'active' } as Agent;
              const result = fn({ agent });
              expect(result).toHaveProperty('_id', 'test');
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

describe('useCustomAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedQueryBuilder = null;
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useCustomAgents(mockCollection as never);
    expect(result.agents).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });

  it('returns data when loaded', () => {
    const agents = [{ _id: 'a1', name: 'Agent 1' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: agents,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useCustomAgents(mockCollection as never);
    expect(result.agents).toBe(agents);
    expect(result.isLoading).toBe(false);
  });

  it('passes all agents when no team filter', () => {
    mockUseTeamFilter.mockReturnValue({ selectedTeamId: null } as ReturnType<
      typeof useTeamFilter
    >);
    useCustomAgents(mockCollection as never);

    const filter = extractWhereFilter();
    expect(
      filter({ agent: { _id: 'a1', status: 'active', teamId: 'team-x' } }),
    ).toBe(true);
  });

  it('filters by teamId when team filter is active', () => {
    mockUseTeamFilter.mockReturnValue({
      selectedTeamId: 'team-1',
    } as ReturnType<typeof useTeamFilter>);
    useCustomAgents(mockCollection as never);

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
  });

  it('excludes agents with no teamId when team filter is active', () => {
    mockUseTeamFilter.mockReturnValue({
      selectedTeamId: 'team-1',
    } as ReturnType<typeof useTeamFilter>);
    useCustomAgents(mockCollection as never);

    const filter = extractWhereFilter();
    expect(
      filter({ agent: { _id: 'a1', status: 'active', teamId: undefined } }),
    ).toBe(false);
  });
});

describe('useCustomAgentVersions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data when loaded', () => {
    const versions = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: versions,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useCustomAgentVersions(mockCollection as never);
    expect(result.versions).toBe(versions);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useCustomAgentVersions(mockCollection as never);
    expect(result.versions).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});

describe('useCustomAgentWebhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data when loaded', () => {
    const webhooks = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: webhooks,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useCustomAgentWebhooks(mockCollection as never);
    expect(result.webhooks).toBe(webhooks);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useCustomAgentWebhooks(mockCollection as never);
    expect(result.webhooks).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});
