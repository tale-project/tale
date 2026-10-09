import { describe, expect, it } from 'vitest';

import { inferSchema, type SchemaTreeSchema } from './infer-schema';
import { randomJson, seeded } from './random-json';

/** Whether `value` fits `schema` (the subset inferSchema writes). */
function fits(schema: SchemaTreeSchema, value: unknown): boolean {
  const types =
    schema.type === undefined
      ? null
      : typeof schema.type === 'string'
        ? [schema.type]
        : schema.type;
  if (types !== null && !types.some((type) => isType(type, value))) {
    return false;
  }
  if (Array.isArray(value)) {
    return schema.items === undefined
      ? true
      : value.every((item) => fits(schema.items ?? {}, item));
  }
  if (typeof value === 'object' && value !== null) {
    const record: Record<string, unknown> = { ...value };
    for (const key of schema.required ?? []) {
      if (!(key in record)) return false;
    }
    for (const [key, entry] of Object.entries(record)) {
      const property = schema.properties?.[key];
      if (property !== undefined && !fits(property, entry)) return false;
    }
  }
  return true;
}

function isType(type: string, value: unknown): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    default:
      return typeof value === type;
  }
}

describe('inferSchema', () => {
  it('reads primitives, telling whole numbers from the rest', () => {
    expect(inferSchema('a')).toEqual({ type: 'string' });
    expect(inferSchema(3)).toEqual({ type: 'integer' });
    expect(inferSchema(3.5)).toEqual({ type: 'number' });
    expect(inferSchema(true)).toEqual({ type: 'boolean' });
    expect(inferSchema(null)).toEqual({ type: 'null' });
    expect(inferSchema(undefined)).toEqual({});
  });

  it('reads an object’s fields, each one required', () => {
    expect(inferSchema({ id: 1, name: 'Ada' })).toEqual({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
      required: ['id', 'name'],
    });
  });

  it('merges a list’s items and counts the fields only some carry', () => {
    const schema = inferSchema([
      { id: 1, note: 'x' },
      { id: 2 },
      { id: 3, note: null },
    ]);
    expect(schema).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          note: {
            type: ['string', 'null'],
            'x-count': { present: 2, of: 3 },
          },
        },
        required: ['id'],
      },
    });
  });

  it('widens whole numbers mixed with fractions to number', () => {
    expect(inferSchema([1, 2.5]).items).toEqual({ type: 'number' });
  });

  it('says nothing about the items of an empty list', () => {
    expect(inferSchema([])).toEqual({ type: 'array' });
  });

  it('stops at maxDepth and reads only the first sampleItems items', () => {
    expect(inferSchema({ a: { b: { c: 1 } } }, { maxDepth: 1 })).toEqual({
      type: 'object',
      properties: {
        a: { type: 'object', properties: { b: {} }, required: ['b'] },
      },
      required: ['a'],
    });
    expect(inferSchema([1, 'two'], { sampleItems: 1 }).items).toEqual({
      type: 'integer',
    });
  });

  it('describes every value it reads (2 000 seeded values)', () => {
    const random = seeded(20261009);
    for (let index = 0; index < 2000; index += 1) {
      const value = randomJson(random, 4);
      expect(fits(inferSchema(value), value), JSON.stringify(value)).toBe(true);
    }
  });
});
