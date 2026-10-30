import { describe, it, expect } from 'vitest';

import {
  initialRank,
  LONG_RANK_LENGTH,
  rankBetween,
  spacedRanks,
} from './rank';

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

  it('keeps a million appends ordered, short and never ending in 0', () => {
    let key = initialRank();
    let longest = key.length;
    for (let i = 0; i < 1_000_000; i += 1) {
      const next = rankBetween(key, undefined);
      if (!(next > key) || next.endsWith('0')) {
        throw new Error(`append ${i}: ${key} -> ${next}`);
      }
      key = next;
      longest = Math.max(longest, key.length);
    }
    expect(longest).toBeLessThanOrEqual(16);
  });

  it('appends after a long key without growing it further', () => {
    // What the midpoint walk left behind in a busy column.
    const stored = `${'z'.repeat(5000)}r`;
    const next = rankBetween(stored, undefined);
    expect(next > stored).toBe(true);
    expect(next.length).toBe(stored.length);
  });

  it('extends a long legacy all-z key by at most 8 digits', () => {
    const stored = 'z'.repeat(5000);
    const next = rankBetween(stored, undefined);
    expect(next > stored).toBe(true);
    expect(next).toBe(`${stored}i0000001`);
  });

  it('counts with a carry and extends only past all-z keys', () => {
    expect(rankBetween('i', undefined)).toBe('j');
    expect(rankBetween('iz', undefined)).toBe('j1');
    expect(rankBetween('a0z', undefined)).toBe('a11');
    expect(rankBetween('z', undefined)).toBe('zi');
    expect(rankBetween('zz', undefined)).toBe('zzi1');
    expect(rankBetween('zzzz', undefined)).toBe('zzzzi001');
  });

  it('interleaves appended keys with keys placed between them', () => {
    const keys = [initialRank()];
    for (let i = 0; i < 200; i += 1) {
      keys.push(rankBetween(keys.at(-1), undefined));
    }
    for (let i = 0; i < 199; i += 7) {
      const between = rankBetween(keys[i], keys[i + 1]);
      expect(between > (keys[i] ?? '')).toBe(true);
      expect(between < (keys[i + 1] ?? '')).toBe(true);
    }
    expect([...keys].sort()).toEqual(keys);
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

/** The append #4594 replaced: past the key's leading z's, the midpoint
 * between its first other digit and the alphabet's end. */
function walkedAppend(key: string): string {
  const at = key.search(/[^z]/);
  if (at === -1) return `${key}i`;
  const digit = parseInt(key.charAt(at), 36);
  return `${key.slice(0, at)}${Math.floor((digit + 36) / 2).toString(36)}`;
}

/** A key's place among all keys of `width` digits. */
function position(key: string, width: number): number {
  return parseInt(key.padEnd(width, '0'), 36);
}

describe('spacedRanks', () => {
  it('gives no key for no task, and keys of one length otherwise', () => {
    expect(spacedRanks(0)).toEqual([]);
    expect(spacedRanks(1)).toEqual(['i1']);
    expect(spacedRanks(2)).toEqual(['c1', 'o1']);
    expect(spacedRanks(3)).toEqual(['91', 'i1', 'r1']);
    expect(() => spacedRanks(-1)).toThrow(RangeError);
    expect(() => spacedRanks(1.5)).toThrow(RangeError);
  });

  it.each([1, 2, 35, 36, 1_295, 1_296, 46_655, 44_000])(
    'spaces %i keys evenly, one digit longer than the count needs, none ending in 0 or all z',
    (count) => {
      const keys = spacedRanks(count);
      const width = count.toString(36).length + 1;
      expect(keys).toHaveLength(count);
      // The room between two keys, and before the first and after the
      // last, among all keys of that length.
      let previous = 0;
      let narrowest = Infinity;
      let widest = 0;
      const room = (next: number) => {
        narrowest = Math.min(narrowest, next - previous);
        widest = Math.max(widest, next - previous);
        previous = next;
      };
      for (const key of keys) {
        expect(key).toMatch(/^[0-9a-z]*[1-9a-z]$/);
        expect(key).toHaveLength(width);
        expect(key).not.toBe('z'.repeat(width));
        room(position(key, width));
      }
      room(36 ** width);
      expect(narrowest).toBeGreaterThanOrEqual(35);
      expect(widest - narrowest).toBeLessThanOrEqual(3);
    },
  );

  it('orders its keys as the board sorts them', () => {
    const keys = spacedRanks(5_000);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('leaves room for a drop before, between and after its keys', () => {
    for (const count of [1, 35, 36, 1_295, 1_296]) {
      const keys = spacedRanks(count);
      const width = keys[0]?.length ?? 0;
      // The midpoint walk may descend one digit past the keys' length.
      const first = rankBetween(undefined, keys[0]);
      expect(first < (keys[0] ?? '')).toBe(true);
      expect(first.length).toBeLessThanOrEqual(width + 1);
      for (let i = 1; i < keys.length; i += 1) {
        const between = rankBetween(keys[i - 1], keys[i]);
        expect(between > (keys[i - 1] ?? '')).toBe(true);
        expect(between < (keys[i] ?? '')).toBe(true);
        expect(between.length).toBeLessThanOrEqual(width + 1);
      }
      // Appends count on at that length through the room after the last.
      let last = keys.at(-1) ?? '';
      for (let i = 0; i < 33; i += 1) {
        const next = rankBetween(last, undefined);
        expect(next > last).toBe(true);
        expect(next).toHaveLength(width);
        last = next;
      }
    }
  });

  it('gives the load run’s board short keys for its long ones', () => {
    // #4713: 44k appends to one board under the old walk.
    let key = initialRank();
    for (let i = 1; i < 44_000; i += 1) key = walkedAppend(key);
    expect(key.length).toBeGreaterThan(7_000);
    expect(key.length).toBeGreaterThan(LONG_RANK_LENGTH);

    const keys = spacedRanks(44_000);
    expect(keys.every((spaced) => spaced.length === 4)).toBe(true);
  });
});
