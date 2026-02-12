import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollection = Symbol('collection');

vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn((_builder: (q: unknown) => unknown) => {
    return { data: [], isLoading: false };
  }),
}));

import { useLiveQuery } from '@tanstack/react-db';

import { useThreads } from '../queries';

const mockUseLiveQuery = vi.mocked(useLiveQuery);

describe('useThreads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data when loaded', () => {
    const threads = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: threads,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useThreads(mockCollection as never);
    expect(result.threads).toBe(threads);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useThreads(mockCollection as never);
    expect(result.threads).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});
