import { describe, expect, it } from 'vitest';

import { sortObjectKeysDeep } from './canonicalize-config';

describe('sortObjectKeysDeep', () => {
  it('sorts keys of nested objects', () => {
    const input = { b: 1, a: { d: 2, c: 3 } };
    expect(JSON.stringify(sortObjectKeysDeep(input))).toBe(
      JSON.stringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('preserves array element order but sorts objects inside arrays', () => {
    const input = { list: [{ z: 1, a: 2 }, { y: 3 }] };
    const out = sortObjectKeysDeep(input);
    expect(JSON.stringify(out)).toBe(
      JSON.stringify({ list: [{ a: 2, z: 1 }, { y: 3 }] }),
    );
  });

  it('leaves primitives untouched', () => {
    expect(sortObjectKeysDeep(42)).toBe(42);
    expect(sortObjectKeysDeep('x')).toBe('x');
    expect(sortObjectKeysDeep(null)).toBe(null);
  });
});
