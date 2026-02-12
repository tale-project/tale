import type { Collection } from '@tanstack/db';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AvailableIntegration } from '@/lib/collections/entities/available-integrations';

vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn((_builder: (q: unknown) => unknown, _deps: unknown[]) => {
    return { data: [], isLoading: false };
  }),
}));

import { useLiveQuery } from '@tanstack/react-db';

import { useAvailableIntegrations } from '../queries';

const mockUseLiveQuery = vi.mocked(useLiveQuery);
const mockCollection = Symbol('collection') as unknown as Collection<
  AvailableIntegration,
  string
>;

describe('useAvailableIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls useLiveQuery with the provided collection', () => {
    useAvailableIntegrations(mockCollection);

    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.any(Function), []);
  });

  it('returns data when loaded', () => {
    const integrations = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: integrations,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useAvailableIntegrations(mockCollection);
    expect(result.integrations).toBe(integrations);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useAvailableIntegrations(mockCollection);
    expect(result.integrations).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});
