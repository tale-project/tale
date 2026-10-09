import { describe, expect, it } from 'vitest';

import { cutText, storableJson, storableText } from './storable-text';

describe('cutText', () => {
  it('never splits a character that takes two', () => {
    expect(cutText('ab😀', 3)).toBe('ab');
    expect(cutText('ab😀', 4)).toBe('ab😀');
    expect(cutText('abc', 2)).toBe('ab');
    expect(cutText('abc', 9)).toBe('abc');
  });
});

describe('storableText', () => {
  it('replaces what jsonb refuses and keeps everything else', () => {
    expect(storableText('half \ud83d here')).toBe('half � here');
    expect(storableText('nul \u0000 here')).toBe('nul � here');
    expect(storableText('whole 😀 and ü')).toBe('whole 😀 and ü');
  });
});

describe('storableJson', () => {
  it('fixes strings and member names at any depth', () => {
    expect(
      storableJson({ a: ['ok', { 'k\u0000': 'x\ud800' }], n: 1, b: true }),
    ).toEqual({ a: ['ok', { 'k�': 'x�' }], n: 1, b: true });
  });

  it('returns a value that needs nothing as it is', () => {
    const value = { a: ['ok', { b: 'fine 😀' }], n: null };
    expect(storableJson(value)).toBe(value);
  });

  it('keeps a member named __proto__ as data', () => {
    const value = JSON.parse('{"__proto__": "\\u0000"}') as Record<
      string,
      unknown
    >;
    const fixed = storableJson(value);
    expect(Object.getPrototypeOf(fixed)).toBe(Object.prototype);
    expect(Object.hasOwn(fixed, '__proto__')).toBe(true);
    expect(fixed.__proto__).toBe('�');
  });
});
