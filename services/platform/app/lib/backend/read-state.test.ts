import { describe, expect, it } from 'vitest';

import { readStateOf } from './read-state';

const base = {
  data: undefined as unknown,
  isError: false,
  isFetching: false,
  errorUpdateCount: 0,
};

describe('readStateOf', () => {
  it('reads a first request in flight as neither failed nor stale', () => {
    expect(readStateOf({ ...base, isFetching: true })).toEqual({
      unavailable: false,
      stale: false,
      retrying: false,
      failureCount: 0,
    });
  });

  it('reads a first read the retry policy gave up on as unavailable', () => {
    expect(
      readStateOf({ ...base, isError: true, errorUpdateCount: 1 }),
    ).toMatchObject({ unavailable: true, stale: false, retrying: false });
  });

  // react-query resets a read with no data to `pending` when a retry starts:
  // the failure still stands until the retry settles.
  it('keeps a never-answered read unavailable while its retry runs', () => {
    expect(
      readStateOf({ ...base, isFetching: true, errorUpdateCount: 1 }),
    ).toMatchObject({ unavailable: true, retrying: true, failureCount: 1 });
  });

  it('reads a failed refresh of an answered read as stale, not unavailable', () => {
    expect(
      readStateOf({
        data: [],
        isError: true,
        isFetching: false,
        errorUpdateCount: 2,
      }),
    ).toEqual({
      unavailable: false,
      stale: true,
      retrying: false,
      failureCount: 2,
    });
  });

  it('counts an empty answer after earlier failures as answered', () => {
    expect(
      readStateOf({
        data: null,
        isError: false,
        isFetching: false,
        errorUpdateCount: 3,
      }),
    ).toMatchObject({ unavailable: false, stale: false, retrying: false });
  });
});
