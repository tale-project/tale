import { describe, expect, it } from 'vitest';

import { cyrb53, valueHash } from './hash';

describe('cyrb53', () => {
  it('answers the same name for the same text, and a different one otherwise', () => {
    expect(cyrb53('automation')).toBe(cyrb53('automation'));
    expect(cyrb53('automation')).not.toBe(cyrb53('automations'));
    expect(cyrb53('')).toMatch(/^[0-9a-z]+$/);
  });

  it('keeps the value it always had, so stored hashes stay comparable', () => {
    expect(cyrb53('')).toBe('wvjl67o803');
    expect(cyrb53('automation')).toBe('8nv8byoq1q');
  });
});

describe('valueHash', () => {
  it('ignores the order keys were written in', () => {
    expect(valueHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      valueHash({ b: [1, { d: 3, c: 2 }], a: 1 }),
    );
  });

  it('tells a list from its reordering', () => {
    expect(valueHash([1, 2])).not.toBe(valueHash([2, 1]));
  });
});
