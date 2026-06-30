import { describe, expect, it } from 'vitest';

import { nextCursorOf, parsePage } from './use-bound-action-infinite-query';

describe('parsePage', () => {
  it('reads rows from the named itemsKey', () => {
    const { rows } = parsePage({ data: [{ id: 1 }, { id: 2 }] }, 'data', 30);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('unwraps the common `{ result: ... }` action envelope', () => {
    const { rows } = parsePage({ result: { data: [{ id: 1 }] } }, 'data', 30);
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('falls back to a common wrapper key when no itemsKey is given', () => {
    const { rows } = parsePage({ items: [{ id: 1 }] }, undefined, 30);
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('accepts a bare array result', () => {
    const { rows } = parsePage([{ id: 1 }], undefined, undefined);
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('drops non-record entries', () => {
    const { rows } = parsePage({ data: [{ id: 1 }, 'nope', null] }, 'data', 30);
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('returns no rows for an unparseable shape', () => {
    expect(parsePage(42, 'data', 30).rows).toEqual([]);
  });

  it('prefers the explicit pagination.hasNextPage flag', () => {
    expect(
      parsePage(
        { data: [{ id: 1 }], pagination: { hasNextPage: true } },
        'data',
        30,
      ).hasNext,
    ).toBe(true);
    expect(
      parsePage(
        {
          data: new Array(30).fill({ id: 1 }),
          pagination: { hasNextPage: false },
        },
        'data',
        30,
      ).hasNext,
    ).toBe(false);
  });

  it('falls back to "a full page came back" when no pagination flag', () => {
    expect(
      parsePage({ data: new Array(30).fill({ id: 1 }) }, 'data', 30).hasNext,
    ).toBe(true);
    expect(parsePage({ data: [{ id: 1 }] }, 'data', 30).hasNext).toBe(false);
  });

  it('counts the RAW page length for the heuristic, not post-filter rows', () => {
    // A full page of perPage=3 that carries a non-record entry is still "full":
    // the next-page heuristic must not under-count and dead-end one page early.
    const { rows, hasNext } = parsePage(
      { data: [{ id: 1 }, { id: 2 }, 'nope'] },
      'data',
      3,
    );
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(hasNext).toBe(true);
  });

  it('never reports a next page when not paginated (no perPage)', () => {
    expect(
      parsePage({ data: new Array(50).fill({ id: 1 }) }, 'data', undefined)
        .hasNext,
    ).toBe(false);
  });
});

describe('nextCursorOf', () => {
  const cursor = { sourcePage: 2, sourceOffset: 5 };

  it('reads pagination.nextCursor from a page result', () => {
    expect(
      nextCursorOf({ data: [], pagination: { nextCursor: cursor } }),
    ).toEqual(cursor);
  });

  it('unwraps the `{ result: ... }` action envelope', () => {
    expect(
      nextCursorOf({ result: { pagination: { nextCursor: cursor } } }),
    ).toEqual(cursor);
  });

  it('returns undefined at the end of the stream (null/absent cursor)', () => {
    expect(
      nextCursorOf({ data: [], pagination: { nextCursor: null } }),
    ).toBeUndefined();
    expect(nextCursorOf({ data: [] })).toBeUndefined();
    expect(nextCursorOf(42)).toBeUndefined();
  });
});
