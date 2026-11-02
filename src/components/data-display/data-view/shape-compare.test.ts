import { describe, expect, it } from 'vitest';

import { inferSchema, type SchemaTreeSchema } from '../../../data/infer-schema';
import { compareShape, shapePathKey } from './shape-compare';

const EXPECTED: SchemaTreeSchema = {
  type: 'object',
  required: ['summary', 'score', 'labels'],
  properties: {
    summary: { type: 'string' },
    score: { type: 'number' },
    labels: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, color: { type: 'string' } },
      },
    },
    note: { type: 'string' },
  },
};

function marks(expected: SchemaTreeSchema, value: unknown) {
  const comparison = compareShape(expected, inferSchema(value));
  return Object.fromEntries(
    [...comparison.marks].map(([key, mark]) => [
      (JSON.parse(key) as string[]).join('.'),
      mark,
    ]),
  );
}

describe('compareShape', () => {
  it('reads a value that fits as matching, whole numbers as numbers', () => {
    const comparison = compareShape(
      EXPECTED,
      inferSchema({
        summary: 'ok',
        score: 7,
        labels: [{ name: 'bug' }, { name: 'ui', color: 'red' }],
      }),
    );
    expect(comparison.differing).toBe(0);
    expect(comparison.marks.size).toBe(0);
  });

  it('marks extra fields, missing required ones and the wrong kinds', () => {
    expect(
      marks(EXPECTED, {
        summary: 42,
        labels: [{ name: 'bug', size: 3 }],
        extra: true,
      }),
    ).toEqual({
      summary: 'type-changed',
      'labels.size': 'added',
      extra: 'added',
      score: 'removed',
    });
  });

  it('lists a missing required field in the shape it draws, as required', () => {
    const comparison = compareShape(EXPECTED, inferSchema({ summary: 'ok' }));
    expect(Object.keys(comparison.schema.properties ?? {})).toEqual([
      'summary',
      'score',
      'labels',
    ]);
    expect(comparison.schema.required).toEqual(['summary', 'score', 'labels']);
    expect(comparison.differing).toBe(2);
  });

  it('marks a required field only some items hold as not always there', () => {
    expect(
      marks(EXPECTED, {
        summary: 'ok',
        score: 1,
        labels: [{ name: 'bug' }, { color: 'red' }],
      }),
    ).toEqual({ 'labels.name': 'optional' });
  });

  it('leaves what the expected shape does not declare unjudged', () => {
    expect(
      compareShape({}, inferSchema({ anything: [1, 'a'] })).differing,
    ).toBe(0);
    expect(
      compareShape({ type: 'object' }, inferSchema({ a: 1 })).differing,
    ).toBe(0);
  });

  it('counts a value of another kind at the top as one difference', () => {
    const comparison = compareShape(EXPECTED, inferSchema(['a']));
    expect(comparison.differing).toBe(1);
    expect(comparison.marks.get(shapePathKey([]))).toBe('type-changed');
  });

  it('accepts values an enum or a union allows', () => {
    expect(
      compareShape({ enum: ['draft', 'sent'] }, inferSchema('draft')).differing,
    ).toBe(0);
    expect(
      compareShape(
        { anyOf: [{ type: 'string' }, { type: 'null' }] },
        inferSchema(null),
      ).differing,
    ).toBe(0);
    expect(compareShape({ enum: [1, 2] }, inferSchema('one')).differing).toBe(
      1,
    );
  });
});
