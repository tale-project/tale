import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollection = Symbol('collection');

vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn((_builder: (q: unknown) => unknown) => {
    return { data: [], isLoading: false };
  }),
}));

vi.mock('@/lib/collections/entities/email-providers', () => ({
  createEmailProvidersCollection: vi.fn(),
}));

vi.mock('@/lib/collections/entities/integrations', () => ({
  createIntegrationsCollection: vi.fn(),
}));

vi.mock('@/lib/collections/use-collection', () => ({
  useCollection: vi.fn(() => mockCollection),
}));

import { useLiveQuery } from '@tanstack/react-db';

import { useEmailProviders, useIntegrations } from '../collections';

const mockUseLiveQuery = vi.mocked(useLiveQuery);

describe('useIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data from live query', () => {
    const items = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: items,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useIntegrations(mockCollection as never);
    expect(result.integrations).toBe(items);
    expect(result.isLoading).toBe(false);
  });

  it('returns empty array when loading', () => {
    mockUseLiveQuery.mockReturnValueOnce({
      data: [],
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useIntegrations(mockCollection as never);
    expect(result.integrations).toEqual([]);
    expect(result.isLoading).toBe(true);
  });
});

describe('useEmailProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data from live query', () => {
    const items = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: items,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useEmailProviders(mockCollection as never);
    expect(result.providers).toBe(items);
    expect(result.isLoading).toBe(false);
  });

  it('returns empty array when loading', () => {
    mockUseLiveQuery.mockReturnValueOnce({
      data: [],
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useEmailProviders(mockCollection as never);
    expect(result.providers).toEqual([]);
    expect(result.isLoading).toBe(true);
  });
});
