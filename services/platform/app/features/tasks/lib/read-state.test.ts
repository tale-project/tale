import { describe, expect, it } from 'vitest';

import {
  boardReadState,
  type ReadResultLike,
  readFailed,
  readRetrying,
} from './read-state';

const read = (overrides: Partial<ReadResultLike>): ReadResultLike => ({
  status: 'pending',
  data: undefined,
  isPlaceholderData: false,
  isFetching: true,
  errorUpdateCount: 0,
  ...overrides,
});

describe('boardReadState', () => {
  it('is loading while the first answer is on the way', () => {
    expect(boardReadState(read({}))).toEqual({ kind: 'loading' });
  });

  it('is ready once the read answered, even while it refreshes', () => {
    expect(
      boardReadState(read({ status: 'success', data: { tasks: [] } })),
    ).toEqual({ kind: 'ready', updating: false });
  });

  it('marks the previous rows of the same board as updating', () => {
    expect(
      boardReadState(
        read({
          status: 'success',
          data: { tasks: [] },
          isPlaceholderData: true,
        }),
      ),
    ).toEqual({ kind: 'ready', updating: true });
  });

  it('keeps the last answer through a failed refresh, and its retry', () => {
    const failed = read({
      status: 'error',
      data: { tasks: [] },
      isFetching: false,
      errorUpdateCount: 1,
    });
    expect(boardReadState(failed)).toEqual({ kind: 'stale', retrying: false });
    expect(boardReadState({ ...failed, isFetching: true })).toEqual({
      kind: 'stale',
      retrying: true,
    });
  });

  it('fails with nothing to show, and stays failed while it retries', () => {
    expect(
      boardReadState(
        read({ status: 'error', isFetching: false, errorUpdateCount: 1 }),
      ),
    ).toEqual({ kind: 'failed', retrying: false });
    // A retry of a read that never answered starts over as pending with its
    // error cleared — and may even show another search's rows as a
    // placeholder: it is still the failure, not a first load.
    expect(boardReadState(read({ errorUpdateCount: 1 }))).toEqual({
      kind: 'failed',
      retrying: true,
    });
    expect(
      boardReadState(
        read({
          status: 'success',
          data: { tasks: [] },
          isPlaceholderData: true,
          errorUpdateCount: 1,
        }),
      ),
    ).toEqual({ kind: 'failed', retrying: true });
  });

  it('answers the helpers the alerts read', () => {
    expect(readFailed({ kind: 'failed', retrying: false })).toBe(true);
    expect(readFailed({ kind: 'stale', retrying: true })).toBe(true);
    expect(readFailed({ kind: 'ready', updating: true })).toBe(false);
    expect(readFailed({ kind: 'loading' })).toBe(false);
    expect(readRetrying({ kind: 'stale', retrying: true })).toBe(true);
    expect(readRetrying({ kind: 'failed', retrying: false })).toBe(false);
    expect(readRetrying({ kind: 'loading' })).toBe(false);
  });
});
