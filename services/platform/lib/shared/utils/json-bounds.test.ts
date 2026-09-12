import { describe, expect, it } from 'vitest';

import {
  boundedJsonObject,
  findJsonBoundsBreach,
  FREE_FORM_JSON_BOUNDS,
  type JsonBounds,
} from './json-bounds';

/**
 * The bound every free-form object field on the REST door shares. The
 * regression under test: `metadata` and `address` were `record<string,
 * unknown>` with no cap, so a 5 MB blob and a hundred-level nesting were
 * stored with a 201 — and a nesting deep enough to break `JSON.stringify`
 * would have broken any measure that serialised first.
 */

/** `levels` nested objects under one key: `nest(2)` is `{a: {a: {}}}`. */
function nest(levels: number): Record<string, unknown> {
  let value: Record<string, unknown> = {};
  for (let index = 0; index < levels; index += 1) value = { a: value };
  return value;
}

function keyed(count: number, prefix = 'k'): Record<string, number> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`${prefix}${index}`, index]),
  );
}

const TIGHT: JsonBounds = { maxBytes: 18, maxDepth: 2, maxKeys: 3 };

describe('findJsonBoundsBreach', () => {
  it('passes scalars, null and a small object', () => {
    expect(findJsonBoundsBreach(null)).toBeNull();
    expect(findJsonBoundsBreach('x')).toBeNull();
    expect(findJsonBoundsBreach({ a: 1, b: [1, 2, { c: 'd' }] })).toBeNull();
  });

  it('allows containers down to maxDepth levels and refuses the next, naming its path', () => {
    expect(findJsonBoundsBreach(nest(8))).toBeNull();
    expect(findJsonBoundsBreach(nest(9))).toEqual({
      path: Array.from({ length: 9 }, () => 'a'),
      message: 'is nested deeper than 8 levels',
    });
  });

  it('counts an array as a level and names the index on the path', () => {
    expect(findJsonBoundsBreach({ a: [{ b: {} }] }, TIGHT)).toEqual({
      path: ['a', '0', 'b'],
      message: 'is nested deeper than 2 levels',
    });
    expect(findJsonBoundsBreach({ a: [{ b: 1 }] }, TIGHT)).toBeNull();
  });

  it('counts keys across every nested object, not per object', () => {
    expect(findJsonBoundsBreach(keyed(500))).toBeNull();
    expect(findJsonBoundsBreach(keyed(501))).toEqual({
      path: [],
      message: 'holds more than 500 keys in total',
    });
    expect(
      findJsonBoundsBreach({ x: keyed(251, 'a'), y: keyed(251, 'b') }),
    ).toEqual({ path: [], message: 'holds more than 500 keys in total' });
  });

  it('measures the serialised UTF-8 bytes, not the character count', () => {
    // `{"a":"xxxxxxxxxx"}` is 18 bytes; `{"a":"é"}` is 9 characters, 10 bytes.
    expect(findJsonBoundsBreach({ a: 'x'.repeat(10) }, TIGHT)).toBeNull();
    expect(findJsonBoundsBreach({ a: 'x'.repeat(11) }, TIGHT)).toEqual({
      path: [],
      message: 'exceeds 0 KiB of JSON (19 bytes)',
    });
    expect(findJsonBoundsBreach({ a: 'é' }, { ...TIGHT, maxBytes: 9 })).toEqual(
      { path: [], message: 'exceeds 0 KiB of JSON (10 bytes)' },
    );
    expect(findJsonBoundsBreach({ blob: 'x'.repeat(65_536) })).toMatchObject({
      message: expect.stringContaining('exceeds 64 KiB of JSON'),
    });
  });

  it('refuses a nesting JSON.stringify could not walk, without touching it', () => {
    const hostile = nest(100_000);
    expect(() => JSON.stringify(hostile)).toThrow(RangeError);
    expect(findJsonBoundsBreach(hostile)).toEqual({
      path: Array.from({ length: 9 }, () => 'a'),
      message: 'is nested deeper than 8 levels',
    });
  });
});

describe('boundedJsonObject', () => {
  it('is the record schema with the breach reported at the offending path', () => {
    const schema = boundedJsonObject();
    expect(schema.safeParse({ a: { b: 1 } })).toMatchObject({
      success: true,
      data: { a: { b: 1 } },
    });
    const deep = schema.safeParse(nest(9));
    expect(deep.success).toBe(false);
    expect(deep.error?.issues[0]).toMatchObject({
      path: Array.from({ length: 9 }, () => 'a'),
      message: 'is nested deeper than 8 levels',
    });
    const big = schema.safeParse({ blob: 'x'.repeat(65_536) });
    expect(big.error?.issues[0]).toMatchObject({
      path: [],
      message: expect.stringContaining('exceeds 64 KiB'),
    });
  });

  it('composes with nullable and optional like any field schema', () => {
    const field = boundedJsonObject().nullable().optional();
    expect(field.safeParse(null)).toMatchObject({ success: true, data: null });
    expect(field.safeParse(undefined).success).toBe(true);
    expect(field.safeParse([1]).success).toBe(false);
  });

  it('uses the shared bound by default', () => {
    expect(FREE_FORM_JSON_BOUNDS).toEqual({
      maxBytes: 65_536,
      maxDepth: 8,
      maxKeys: 500,
    });
  });
});
