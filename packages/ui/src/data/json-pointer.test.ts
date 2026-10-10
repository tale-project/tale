import { describe, expect, it } from 'vitest';

import { isWithin, pathOf, pointerOf } from './json-pointer';

describe('pointerOf and pathOf', () => {
  it('names the whole value with the empty pointer', () => {
    expect(pointerOf([])).toBe('');
    expect(pathOf('')).toEqual([]);
  });

  it('writes keys and list indexes as RFC 6901 segments', () => {
    expect(pointerOf(['items', 0, 'name'])).toBe('/items/0/name');
    expect(pathOf('/items/0/name')).toEqual(['items', 0, 'name']);
  });

  it('escapes "~" and "/" so a key holding either survives the round trip', () => {
    const path = ['a/b', 'c~d', '~1', ''];
    expect(pointerOf(path)).toBe('/a~1b/c~0d/~01/');
    expect(pathOf(pointerOf(path))).toEqual(path);
  });

  it('reads only canonical whole numbers as indexes', () => {
    expect(pathOf('/0/12/012/-1/1.5')).toEqual([0, 12, '012', '-1', '1.5']);
  });

  it('refuses a pointer without a leading "/" or with a stray "~"', () => {
    expect(() => pathOf('items')).toThrow(/must start with "\/"/);
    expect(() => pathOf('/a~2')).toThrow(/"~" must be written/);
  });
});

describe('isWithin', () => {
  it('holds for the pointer itself, its descendants and the root', () => {
    expect(isWithin('/a/b', '/a')).toBe(true);
    expect(isWithin('/a', '/a')).toBe(true);
    expect(isWithin('/a/b', '')).toBe(true);
  });

  it('does not take a sibling whose name starts the same', () => {
    expect(isWithin('/ab', '/a')).toBe(false);
    expect(isWithin('/a', '/a/b')).toBe(false);
  });
});
