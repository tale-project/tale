import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollection = Symbol('collection');

vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn((_builder: (q: unknown) => unknown) => {
    return { data: [], isLoading: false };
  }),
}));

import { useLiveQuery } from '@tanstack/react-db';

import { useMembers } from '../queries';

const mockUseLiveQuery = vi.mocked(useLiveQuery);

describe('useMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data from live query', () => {
    const items = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: items,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useMembers(mockCollection as never);
    expect(result.members).toBe(items);
    expect(result.isLoading).toBe(false);
  });

  it('returns empty array when loading', () => {
    mockUseLiveQuery.mockReturnValueOnce({
      data: [],
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useMembers(mockCollection as never);
    expect(result.members).toEqual([]);
    expect(result.isLoading).toBe(true);
  });
});
