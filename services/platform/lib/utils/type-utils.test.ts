import { describe, expect, it } from 'vitest';

import { primitiveString } from './type-utils';

describe('primitiveString', () => {
  it('returns strings as-is and stringifies number/boolean/bigint', () => {
    expect(primitiveString('open')).toBe('open');
    expect(primitiveString('')).toBe('');
    expect(primitiveString(42)).toBe('42');
    expect(primitiveString(false)).toBe('false');
    expect(primitiveString(7n)).toBe('7');
  });

  it('returns undefined for objects, arrays, null, and undefined (never "[object Object]")', () => {
    expect(primitiveString({ a: 1 })).toBeUndefined();
    expect(primitiveString(['x'])).toBeUndefined();
    expect(primitiveString(null)).toBeUndefined();
    expect(primitiveString(undefined)).toBeUndefined();
  });
});
