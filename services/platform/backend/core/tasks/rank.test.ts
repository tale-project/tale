import { describe, it, expect } from 'vitest';

import { initialRank, rankBetween } from './rank';

describe('initialRank', () => {
  it('returns a stable mid-alphabet key', () => {
    expect(initialRank()).toBe('i');
    expect(initialRank()).toBe(initialRank());
  });
});

describe('rankBetween', () => {
  it('returns the initial rank when both bounds are absent', () => {
    expect(rankBetween()).toBe(initialRank());
    expect(rankBetween(undefined, undefined)).toBe(initialRank());
  });

  it('produces a key after `before` when appending to the end', () => {
    const a = initialRank();
    const r = rankBetween(a, undefined);
    expect(r > a).toBe(true);
  });

  it('produces a key before `after` when prepending to the start', () => {
    const b = initialRank();
    const r = rankBetween(undefined, b);
    expect(r < b).toBe(true);
  });

  it('produces a key strictly between two neighbours', () => {
    const r = rankBetween('i', 'r');
    expect(r > 'i').toBe(true);
    expect(r < 'r').toBe(true);
  });

  it('handles adjacent single-char neighbours by descending a level', () => {
    const r = rankBetween('a', 'b');
    expect(r > 'a').toBe(true);
    expect(r < 'b').toBe(true);
  });

  it('handles a prefix relationship (before is a prefix of after)', () => {
    const r = rankBetween('a', 'ai');
    expect(r > 'a').toBe(true);
    expect(r < 'ai').toBe(true);
  });

  it('keeps strict ordering across many sequential inserts at the head', () => {
    let after = initialRank();
    const keys = [after];
    for (let i = 0; i < 50; i += 1) {
      const next = rankBetween(undefined, after);
      expect(next < after).toBe(true);
      keys.unshift(next);
      after = next;
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it('keeps strict ordering when repeatedly bisecting the same gap', () => {
    let lo = 'a';
    const hi = 'b';
    for (let i = 0; i < 50; i += 1) {
      const mid = rankBetween(lo, hi);
      expect(mid > lo).toBe(true);
      expect(mid < hi).toBe(true);
      lo = mid;
    }
  });

  it('throws when before >= after', () => {
    expect(() => rankBetween('r', 'i')).toThrow();
    expect(() => rankBetween('i', 'i')).toThrow();
  });

  it('still descends below `after` when room exists past a 0 digit', () => {
    const r = rankBetween('a', 'a05');
    expect(r > 'a').toBe(true);
    expect(r < 'a05').toBe(true);
  });

  it('never returns a key outside the open interval (no out-of-order keys)', () => {
    // `after` ending in the minimum digit leaves no key strictly between the
    // two — the walk must throw, not return a key that sorts past `after`.
    for (const [a, b] of [
      ['a', 'a0'],
      [undefined, '0'],
      ['1', '10'],
      ['ab', 'ab0'],
    ] as const) {
      expect(() => rankBetween(a, b)).toThrow();
    }
  });
});
