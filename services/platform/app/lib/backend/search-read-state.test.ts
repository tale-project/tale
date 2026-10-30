import { describe, expect, it, vi } from 'vitest';

import { searchStateOf } from './search-read-state';

const ROWS = [{ id: 'p1', title: 'Project' }];
const NONE: typeof ROWS = [];

function query(overrides: Partial<Parameters<typeof searchStateOf>[0]> = {}) {
  return {
    data: undefined as unknown,
    isLoading: false,
    isFetching: false,
    isError: false,
    errorUpdateCount: 0,
    error: null,
    refetch: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('searchStateOf', () => {
  it('reads a search in flight as loading', () => {
    expect(
      searchStateOf(query({ isLoading: true, isFetching: true }), NONE),
    ).toEqual({ results: NONE, status: 'loading' });
  });

  it('reads an answered search as ready with its rows', () => {
    expect(searchStateOf(query({ data: [{}] }), ROWS)).toEqual({
      results: ROWS,
      status: 'ready',
    });
  });

  // #4890: a search that never answered read as "no results".
  it('reads a search the retry policy gave up on as an error with a retry', () => {
    const error = new Error('unreachable');
    const failed = query({ isError: true, errorUpdateCount: 1, error });
    const state = searchStateOf(failed, NONE);
    expect(state).toMatchObject({
      results: NONE,
      status: 'error',
      error,
      retrying: false,
    });
    state.retry?.();
    expect(failed.refetch).toHaveBeenCalledTimes(1);
  });

  // react-query starts a retry of a never-answered read from `pending`.
  it('holds the error, busy, while its retry runs', () => {
    expect(
      searchStateOf(
        query({ isLoading: true, isFetching: true, errorUpdateCount: 1 }),
        NONE,
      ),
    ).toMatchObject({ status: 'error', retrying: true });
  });

  it('keeps the rows of an answered search whose refresh failed', () => {
    expect(
      searchStateOf(
        query({ data: [{}], isError: true, errorUpdateCount: 1 }),
        ROWS,
      ),
    ).toEqual({ results: ROWS, status: 'ready' });
  });
});
