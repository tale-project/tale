import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollection = Symbol('collection');

vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn((_builder: (q: unknown) => unknown) => {
    return { data: [], isLoading: false };
  }),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useMemo: (fn: () => unknown) => fn(),
  };
});

import { useLiveQuery } from '@tanstack/react-db';

import { useThreads } from '../queries';

const mockUseLiveQuery = vi.mocked(useLiveQuery);

describe('useThreads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data sorted by creation time descending', () => {
    const threads = [
      { _id: '1', _creationTime: 100 },
      { _id: '2', _creationTime: 200 },
    ];
    mockUseLiveQuery.mockReturnValueOnce({
      data: threads,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useThreads(mockCollection as never);
    expect(result.threads).toStrictEqual([
      { _id: '2', _creationTime: 200 },
      { _id: '1', _creationTime: 100 },
    ]);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', _creationTime: 100 }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useThreads(mockCollection as never);
    expect(result.threads).toStrictEqual(mockData);
    expect(result.isLoading).toBe(true);
  });
});
