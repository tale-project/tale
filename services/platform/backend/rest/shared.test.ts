// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { formatKeysetCursor, pageLimit, parseKeysetCursor } from './shared.ts';

/**
 * The one cursor codec every keyset-paginated /api/v1 list shares, and the
 * page-size clamp: a consumer passes `continueCursor` straight back as
 * `cursor`, and no `limit` a client can send turns into a Postgres error
 * (negative LIMIT) or a dead page (LIMIT 0 answering nothing forever).
 */

describe('keyset cursor codec', () => {
  it("round-trips the previous page's last row", () => {
    const token = formatKeysetCursor(1_725_000_000_000, 'row-42');
    expect(token).toBe('1725000000000:row-42');
    expect(parseKeysetCursor(token)).toEqual({
      at: 1_725_000_000_000,
      id: 'row-42',
    });
  });

  it('keeps an id that itself contains the separator intact', () => {
    expect(parseKeysetCursor('17:a:b:c')).toEqual({ at: 17, id: 'a:b:c' });
  });

  it('reads an absent or empty cursor as the first page', () => {
    expect(parseKeysetCursor(undefined)).toBeNull();
    expect(parseKeysetCursor(null)).toBeNull();
    expect(parseKeysetCursor('')).toBeNull();
  });

  it('reads an unparseable token as the first page, never a crash', () => {
    for (const garbage of [
      'nope',
      ':row',
      '17:',
      'NaN:row',
      '{"updatedAt":1,"id":"x"}',
    ]) {
      expect(parseKeysetCursor(garbage)).toBeNull();
    }
  });
});

describe('pageLimit', () => {
  it('honours a sane value and defaults when absent', () => {
    expect(pageLimit('40', { fallback: 25, max: 200 })).toBe(40);
    expect(pageLimit(undefined, { fallback: 25, max: 200 })).toBe(25);
  });

  it('floors at one row and caps at the family maximum', () => {
    expect(pageLimit('0', { fallback: 25, max: 200 })).toBe(1);
    expect(pageLimit('-5', { fallback: 25, max: 200 })).toBe(1);
    expect(pageLimit('1000', { fallback: 25, max: 200 })).toBe(200);
  });

  it('falls back on non-numeric input and truncates fractions', () => {
    expect(pageLimit('abc', { fallback: 25, max: 200 })).toBe(25);
    expect(pageLimit('2.9', { fallback: 25, max: 200 })).toBe(2);
  });
});
