import { describe, expect, it } from 'vitest';

import { sanitizeConvexValue } from './sanitize_convex_value';

describe('sanitizeConvexValue', () => {
  it('converts undefined to null', () => {
    expect(sanitizeConvexValue(undefined)).toBe(null);
  });

  it('preserves null', () => {
    expect(sanitizeConvexValue(null)).toBe(null);
  });

  it('preserves primitives', () => {
    expect(sanitizeConvexValue('hello')).toBe('hello');
    expect(sanitizeConvexValue(42)).toBe(42);
    expect(sanitizeConvexValue(true)).toBe(true);
    expect(sanitizeConvexValue(0)).toBe(0);
    expect(sanitizeConvexValue('')).toBe('');
  });

  it('converts undefined elements in arrays to null', () => {
    expect(sanitizeConvexValue([undefined, 'a', undefined])).toEqual([
      null,
      'a',
      null,
    ]);
  });

  it('preserves valid arrays', () => {
    expect(sanitizeConvexValue([1, 'two', null])).toEqual([1, 'two', null]);
  });

  it('converts undefined values in objects to null', () => {
    expect(sanitizeConvexValue({ a: undefined, b: 1 })).toEqual({
      a: null,
      b: 1,
    });
  });

  it('handles nested structures', () => {
    const input = {
      arr: [undefined, { nested: undefined, ok: 'yes' }],
      deep: { level2: { val: undefined } },
      valid: 'kept',
    };
    expect(sanitizeConvexValue(input)).toEqual({
      arr: [null, { nested: null, ok: 'yes' }],
      deep: { level2: { val: null } },
      valid: 'kept',
    });
  });

  it('handles empty arrays and objects', () => {
    expect(sanitizeConvexValue([])).toEqual([]);
    expect(sanitizeConvexValue({})).toEqual({});
  });
});
