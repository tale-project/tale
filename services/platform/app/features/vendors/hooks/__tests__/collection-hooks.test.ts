import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollection = Symbol('collection');

vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn((_builder: (q: unknown) => unknown) => {
    return { data: [], isLoading: false };
  }),
}));

vi.mock('@/lib/collections/entities/vendors', () => ({
  createVendorsCollection: vi.fn(),
}));

vi.mock('@/lib/collections/use-collection', () => ({
  useCollection: vi.fn(() => mockCollection),
}));

import { useLiveQuery } from '@tanstack/react-db';

import { useCollection } from '@/lib/collections/use-collection';

import { useVendorCollection, useVendors } from '../collections';

const mockUseLiveQuery = vi.mocked(useLiveQuery);

describe('useVendorCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection with correct params', () => {
    useVendorCollection('org-123');
    expect(useCollection).toHaveBeenCalledWith(
      'vendors',
      expect.any(Function),
      'org-123',
    );
  });
});

describe('useVendors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data from live query', () => {
    const items = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: items,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useVendors(mockCollection as never);
    expect(result.vendors).toBe(items);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useVendors(mockCollection as never);
    expect(result.vendors).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});
