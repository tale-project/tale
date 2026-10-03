import { describe, it, expect } from 'vitest';

import { changedKeys, structuralEqual } from './structural-equal';

describe('structuralEqual', () => {
  it('treats identical primitives as equal', () => {
    expect(structuralEqual(1, 1)).toBe(true);
    expect(structuralEqual('a', 'a')).toBe(true);
    expect(structuralEqual(true, true)).toBe(true);
    expect(structuralEqual(null, null)).toBe(true);
    expect(structuralEqual(undefined, undefined)).toBe(true);
  });

  it('treats NaN as equal to NaN (unlike ===)', () => {
    expect(structuralEqual(NaN, NaN)).toBe(true);
  });

  it('distinguishes different primitives', () => {
    expect(structuralEqual(1, 2)).toBe(false);
    expect(structuralEqual('a', 'b')).toBe(false);
    expect(structuralEqual(0, '')).toBe(false);
    expect(structuralEqual(null, undefined)).toBe(false);
    expect(structuralEqual(undefined, '')).toBe(false);
  });

  it('is key-order-insensitive for plain objects', () => {
    expect(structuralEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(structuralEqual({ x: { a: 1, b: 2 } }, { x: { b: 2, a: 1 } })).toBe(
      true,
    );
  });

  it('treats undefined-valued keys as absent', () => {
    expect(structuralEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(structuralEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(
      structuralEqual(
        { temperatureRange: { min: undefined, max: 1 } },
        { temperatureRange: { max: 1 } },
      ),
    ).toBe(true);
  });

  it('does NOT conflate undefined with null', () => {
    expect(structuralEqual({ a: null }, { a: undefined })).toBe(false);
    expect(structuralEqual({ a: null }, {})).toBe(false);
  });

  it('compares arrays order-sensitively', () => {
    expect(structuralEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(structuralEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(structuralEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(structuralEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
  });

  it('does not treat arrays and objects as interchangeable', () => {
    expect(structuralEqual([], {})).toBe(false);
    expect(structuralEqual({ 0: 'a', length: 1 }, ['a'])).toBe(false);
  });

  it('compares Date by timestamp', () => {
    expect(
      structuralEqual(new Date('2020-01-01'), new Date('2020-01-01')),
    ).toBe(true);
    expect(
      structuralEqual(new Date('2020-01-01'), new Date('2021-01-01')),
    ).toBe(false);
    expect(structuralEqual(new Date('2020-01-01'), '2020-01-01')).toBe(false);
  });

  it('handles deeply nested config-shaped objects', () => {
    const a = {
      effort: 'high',
      budgetCaps: { easy: 256, medium: 512 },
      temperatureRange: { min: 0.2, max: 0.8 },
    };
    const b = {
      temperatureRange: { max: 0.8, min: 0.2 },
      budgetCaps: { medium: 512, easy: 256 },
      effort: 'high',
    };
    expect(structuralEqual(a, b)).toBe(true);
    expect(structuralEqual(a, { ...b, effort: 'low' })).toBe(false);
  });
});

describe('changedKeys', () => {
  it('returns empty when structurally equal despite key order', () => {
    expect(changedKeys({ a: 1, b: 2 }, { b: 2, a: 1 }).size).toBe(0);
  });

  it('flags only the keys that diverge', () => {
    const result = changedKeys(
      { name: 'x', color: '#fff', tuning: { effort: 'low' } },
      { name: 'x', color: '#000', tuning: { effort: 'low' } },
    );
    expect([...result]).toEqual(['color']);
  });

  it('flags keys present on only one side with a defined value', () => {
    expect([...changedKeys({ a: 1 }, {})]).toEqual(['a']);
    expect(changedKeys({ a: undefined }, {}).size).toBe(0);
  });

  it('returns empty for null/undefined inputs', () => {
    expect(changedKeys(null, { a: 1 }).size).toBe(0);
    expect(changedKeys({ a: 1 }, undefined).size).toBe(0);
  });
});
