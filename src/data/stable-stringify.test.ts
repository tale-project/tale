import { describe, expect, it } from 'vitest';

import { jsonNormalize, stableStringify } from './stable-stringify';

describe('stableStringify', () => {
  it('writes keys in sorted order at every depth', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it('agrees with JSON.stringify on what JSON cannot hold', () => {
    const value = {
      skip: undefined,
      fn: () => 1,
      list: [undefined, Number.NaN, Infinity, 1],
    };
    expect(stableStringify(value)).toBe('{"list":[null,null,null,1]}');
    expect(JSON.parse(stableStringify(value))).toEqual(
      JSON.parse(JSON.stringify(value)),
    );
  });

  it('serializes through toJSON and writes a bigint as its digits', () => {
    expect(stableStringify({ at: new Date(Date.UTC(2026, 9, 9)) })).toBe(
      '{"at":"2026-10-09T00:00:00.000Z"}',
    );
    expect(stableStringify(12n)).toBe('"12"');
  });

  it('reads a value JSON cannot carry at all as null', () => {
    expect(stableStringify(undefined)).toBe('null');
  });
});

describe('jsonNormalize', () => {
  it('answers the value as a reader of its JSON would see it', () => {
    expect(jsonNormalize({ a: undefined, b: [Number.NaN] })).toEqual({
      b: [null],
    });
    expect(jsonNormalize(undefined)).toBeUndefined();
  });

  it('keeps keys in the order they were written', () => {
    expect(Object.keys(jsonNormalize({ b: 1, a: 2, c: 3 }) as object)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });
});
