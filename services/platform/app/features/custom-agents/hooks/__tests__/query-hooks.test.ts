import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollection = Symbol('collection');

vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn((_builder: (q: unknown) => unknown, _deps: unknown[]) => {
    return { data: [], isLoading: false };
  }),
}));

vi.mock('@/lib/collections/entities/available-integrations', () => ({
  createAvailableIntegrationsCollection: vi.fn(),
}));

vi.mock('@/lib/collections/use-collection', () => ({
  useCollection: vi.fn(() => mockCollection),
}));

import { useLiveQuery } from '@tanstack/react-db';

import { useCollection } from '@/lib/collections/use-collection';

import { useAvailableIntegrations } from '../queries';

const mockUseLiveQuery = vi.mocked(useLiveQuery);

describe('useAvailableIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection with correct params', () => {
    useAvailableIntegrations('org-123');

    expect(useCollection).toHaveBeenCalledWith(
      'available-integrations',
      expect.any(Function),
      'org-123',
    );
  });

  it('returns data when loaded', () => {
    const integrations = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: integrations,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useAvailableIntegrations('org-123');
    expect(result.integrations).toBe(integrations);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useAvailableIntegrations('org-123');
    expect(result.integrations).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});
