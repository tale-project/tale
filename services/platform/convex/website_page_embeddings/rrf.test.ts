import { describe, expect, it } from 'vitest';

import { mergeWithRRF } from './rrf';

describe('mergeWithRRF', () => {
  it('merges two ranked lists and boosts items appearing in both', () => {
    const vectorResults = [
      { id: 'a', content: 'alpha' },
      { id: 'b', content: 'beta' },
      { id: 'c', content: 'gamma' },
    ];
    const textResults = [
      { id: 'b', content: 'beta' },
      { id: 'd', content: 'delta' },
      { id: 'a', content: 'alpha' },
    ];

    const merged = mergeWithRRF([vectorResults, textResults], 10);

    // 'b' appears in both lists (rank 1 in vector, rank 0 in text) → highest combined score
    // 'a' appears in both lists (rank 0 in vector, rank 2 in text) → second highest
    expect(merged[0].id).toBe('b');
    expect(merged[1].id).toBe('a');
    expect(merged.length).toBe(4);
  });

  it('respects the limit parameter', () => {
    const list1 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const list2 = [{ id: 'd' }, { id: 'e' }];

    const merged = mergeWithRRF([list1, list2], 3);

    expect(merged.length).toBe(3);
  });

  it('handles empty lists', () => {
    const merged = mergeWithRRF([[], []], 10);
    expect(merged).toEqual([]);
  });

  it('handles single list', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    const merged = mergeWithRRF([list], 10);

    expect(merged.length).toBe(2);
    expect(merged[0].id).toBe('a');
    expect(merged[1].id).toBe('b');
  });

  it('preserves item properties from first occurrence', () => {
    const list1 = [{ id: 'a', source: 'vector' }];
    const list2 = [{ id: 'a', source: 'text' }];

    const merged = mergeWithRRF([list1, list2], 10);

    expect(merged[0].id).toBe('a');
    expect(merged[0].source).toBe('vector');
  });

  it('assigns RRF scores to results', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    const merged = mergeWithRRF([list], 10);

    // rank 0: 1/(60+1) ≈ 0.01639
    // rank 1: 1/(60+2) ≈ 0.01613
    expect(merged[0].score).toBeCloseTo(1 / 61, 5);
    expect(merged[1].score).toBeCloseTo(1 / 62, 5);
  });
});
