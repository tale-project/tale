import { describe, expect, it } from 'vitest';

import { compareRank } from './task-rank-order';

describe('compareRank', () => {
  it('orders by code unit where a collation would join letter pairs', () => {
    // Each pair sorts differently under some locale's collation.
    const ranks = [
      'zr',
      'zs',
      'zt',
      'zzi1',
      'zzlj',
      'zzlk',
      'zzzzi0aa',
      'zzzzi0ab',
      'zzzzi0ch',
      'zzzzi0ci',
    ];
    expect([...ranks].reverse().sort(compareRank)).toEqual(ranks);
    expect(compareRank('a', 'a')).toBe(0);
    expect(compareRank('a1', 'a')).toBe(1);
  });
});
