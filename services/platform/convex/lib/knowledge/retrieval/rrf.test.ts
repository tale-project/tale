import { describe, expect, it } from 'vitest';

import { mergeRrf } from './rrf';

describe('mergeRrf', () => {
  it('handles a single list', () => {
    const merged = mergeRrf(
      [
        [
          { id: 1, text: 'a' },
          { id: 2, text: 'b' },
        ],
      ],
      2,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe(1);
    expect(merged[1].id).toBe(2);
  });

  it('ranks overlapping items highest across two lists', () => {
    const list1 = [
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ];
    const list2 = [
      { id: 2, text: 'b' },
      { id: 3, text: 'c' },
    ];
    const merged = mergeRrf([list1, list2], 3);
    expect(merged[0].id).toBe(2);
  });

  it('respects the limit', () => {
    const results = [
      Array.from({ length: 10 }, (_, i) => ({ id: i, text: `item-${i}` })),
    ];
    expect(mergeRrf(results, 3)).toHaveLength(3);
  });

  it('returns empty for empty inner lists', () => {
    expect(mergeRrf([[], []], 5)).toEqual([]);
  });

  it('returns empty for empty input', () => {
    expect(mergeRrf([], 5)).toEqual([]);
  });

  it('supports a custom id key', () => {
    const results = [
      [
        { doc_id: 'a', text: 'hello' },
        { doc_id: 'b', text: 'world' },
      ],
    ];
    const merged = mergeRrf(results, 2, { idKey: 'doc_id' });
    expect(merged[0].doc_id).toBe('a');
  });

  it('normalizes the top score to 1.0', () => {
    const results = [
      [
        { id: 1, text: 'a' },
        { id: 2, text: 'b' },
      ],
    ];
    const merged = mergeRrf(results, 2);
    expect(merged[0].rrf_score).toBe(1.0);
    expect(merged[1].rrf_score).toBeGreaterThan(0);
    expect(merged[1].rrf_score).toBeLessThan(1.0);
  });

  it('scores disjoint single-list items below 1.0', () => {
    const merged = mergeRrf(
      [[{ id: 1, text: 'a' }], [{ id: 2, text: 'b' }]],
      2,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].rrf_score).toBe(0.5);
    expect(merged[1].rrf_score).toBe(0.5);
  });

  it('scores a rank-0-in-both item at the theoretical max of 1.0', () => {
    const list1 = [
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ];
    const list2 = [
      { id: 1, text: 'a' },
      { id: 3, text: 'c' },
    ];
    const merged = mergeRrf([list1, list2], 3);
    expect(merged[0].id).toBe(1);
    expect(merged[0].rrf_score).toBe(1.0);
    expect(merged[1].rrf_score).toBeLessThan(1.0);
  });

  it('accepts a custom k', () => {
    const list1 = [{ id: 1 }, { id: 2 }];
    const list2 = [{ id: 2 }, { id: 1 }];
    expect(mergeRrf([list1, list2], 2, { k: 10 })).toHaveLength(2);
    expect(mergeRrf([list1, list2], 2, { k: 100 })).toHaveLength(2);
  });

  it('rejects k < 1', () => {
    expect(() => mergeRrf([[{ id: 1 }]], 1, { k: 0 })).toThrow(
      'k must be >= 1',
    );
  });

  it('rejects a negative limit', () => {
    expect(() => mergeRrf([[{ id: 1 }]], -1)).toThrow('limit must be >= 0');
  });
});
