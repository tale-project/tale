// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  assignable,
  elementOf,
  isArrayLike,
  isClosed,
  lookup,
  MAX_UNION_MEMBERS,
  NULL_SHAPE,
  nullability,
  NUMBER_SHAPE,
  shapeOfValue,
  STRING_SHAPE,
  toTs,
  union,
  UNKNOWN,
  walkPath,
  widen,
  withNull,
  withoutNull,
  type Shape,
} from './shape';

const obj = (
  properties: Record<string, Shape>,
  extra: Partial<Shape> = {},
): Shape => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  ...extra,
});

const signature = (properties: Record<string, Shape>): Shape =>
  obj(properties, { 'x-origin': 'signature' });

describe('lookup', () => {
  const issue = signature({ number: NUMBER_SHAPE, title: STRING_SHAPE });

  it('finds a declared property, optional unless required', () => {
    expect(lookup(issue, 'title')).toEqual({
      kind: 'found',
      shape: STRING_SHAPE,
      optional: false,
    });
    const partial: Shape = { ...issue, required: ['number'] };
    expect(lookup(partial, 'title')).toMatchObject({ optional: true });
  });

  it('calls a key of an exact object missing and closed', () => {
    expect(lookup(issue, 'body')).toEqual({
      kind: 'missing',
      closed: true,
      known: ['number', 'title'],
    });
  });

  it('calls a key of an open schema that declares others missing but open', () => {
    const declared = obj({ a: STRING_SHAPE }, { 'x-origin': 'declared' });
    expect(lookup(declared, 'b')).toEqual({
      kind: 'missing',
      closed: false,
      known: ['a'],
    });
    expect(
      lookup({ ...declared, additionalProperties: false }, 'b'),
    ).toMatchObject({ kind: 'missing', closed: true });
  });

  it('knows nothing about an open object that declares nothing', () => {
    expect(
      lookup(
        { type: 'object', additionalProperties: true, 'x-origin': 'signature' },
        'x',
      ),
    ).toEqual({ kind: 'unknown' });
    expect(lookup({ type: 'object' }, 'x')).toEqual({ kind: 'unknown' });
    expect(lookup(UNKNOWN, 'x')).toEqual({ kind: 'unknown' });
  });

  it('reads record values as optional', () => {
    const headers: Shape = {
      type: 'object',
      additionalProperties: STRING_SHAPE,
    };
    expect(lookup(headers, 'etag')).toEqual({
      kind: 'found',
      shape: STRING_SHAPE,
      optional: true,
    });
  });

  it('reads list elements, length and methods, and refuses a field of a list', () => {
    const list: Shape = { type: 'array', items: issue };
    expect(lookup(list, 0)).toEqual({
      kind: 'found',
      shape: issue,
      optional: false,
    });
    expect(lookup(list, '3')).toMatchObject({ kind: 'found', shape: issue });
    expect(lookup(list, 'length')).toMatchObject({ shape: NUMBER_SHAPE });
    expect(lookup(list, 'map')).toMatchObject({ kind: 'found' });
    expect(lookup(list, 'title')).toEqual({
      kind: 'missing',
      closed: true,
      known: [],
    });
  });

  it('reads string length and characters, and refuses a field of a string', () => {
    expect(lookup(STRING_SHAPE, 'length')).toMatchObject({
      shape: NUMBER_SHAPE,
    });
    expect(lookup(STRING_SHAPE, 0)).toMatchObject({ shape: STRING_SHAPE });
    expect(lookup(STRING_SHAPE, 'trim')).toMatchObject({ kind: 'found' });
    expect(lookup(STRING_SHAPE, 'summary')).toMatchObject({
      kind: 'missing',
      closed: true,
    });
  });

  it('reads a union through its non-null members', () => {
    const maybe = withNull(issue);
    expect(lookup(maybe, 'title')).toMatchObject({
      kind: 'found',
      shape: STRING_SHAPE,
      optional: false,
    });
    const either = union(issue, signature({ id: STRING_SHAPE }));
    expect(lookup(either, 'title')).toMatchObject({
      kind: 'found',
      optional: true,
    });
    expect(lookup(either, 'nope')).toEqual({
      kind: 'missing',
      closed: true,
      known: ['number', 'title', 'id'],
    });
    expect(lookup(NULL_SHAPE, 'x')).toEqual({ kind: 'unknown' });
  });
});

describe('walkPath', () => {
  const doc = signature({
    issues: { type: 'array', items: signature({ title: STRING_SHAPE }) },
  });

  it('follows a chain to its end', () => {
    expect(
      walkPath(doc, [{ key: 'issues' }, { key: 0 }, { key: 'title' }]),
    ).toEqual({
      kind: 'found',
      shape: STRING_SHAPE,
      optional: false,
    });
  });

  it('stops at the first missing step', () => {
    expect(
      walkPath(doc, [{ key: 'issues' }, { key: 0 }, { key: 'body' }]),
    ).toMatchObject({
      kind: 'missing',
      at: 2,
      closed: true,
      known: ['title'],
    });
  });

  it('stops at the first step it cannot see into', () => {
    expect(walkPath(UNKNOWN, [{ key: 'a' }])).toEqual({
      kind: 'unknown',
      at: 0,
    });
  });
});

describe('union', () => {
  it('flattens, de-duplicates and collapses a single member', () => {
    expect(union(STRING_SHAPE, union(STRING_SHAPE, NUMBER_SHAPE))).toEqual({
      anyOf: [STRING_SHAPE, NUMBER_SHAPE],
    });
    expect(union(STRING_SHAPE, STRING_SHAPE)).toEqual(STRING_SHAPE);
  });

  it('is unknown when any member is', () => {
    expect(union(STRING_SHAPE, UNKNOWN)).toBe(UNKNOWN);
  });

  it('merges literals of one type and lets the plain type absorb them', () => {
    expect(
      union({ type: 'string', const: 'a' }, { type: 'string', const: 'b' }),
    ).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect(union({ type: 'string', const: 'a' }, STRING_SHAPE)).toEqual(
      STRING_SHAPE,
    );
    expect(union({ type: 'integer' }, NUMBER_SHAPE)).toEqual(NUMBER_SHAPE);
  });

  it('collapses past the member cap', () => {
    const many = Array.from({ length: MAX_UNION_MEMBERS + 1 }, (_, i) =>
      signature({ [`k${i}`]: STRING_SHAPE }),
    );
    expect(union(...many)).toBe(UNKNOWN);
  });
});

describe('null', () => {
  it('reads nullability', () => {
    expect(nullability(STRING_SHAPE)).toBe('never');
    expect(nullability(withNull(STRING_SHAPE))).toBe('maybe');
    expect(nullability(NULL_SHAPE)).toBe('always');
    expect(nullability(UNKNOWN)).toBe('never');
  });

  it('drops null members', () => {
    expect(withoutNull(withNull(STRING_SHAPE))).toEqual(STRING_SHAPE);
    expect(withoutNull(NULL_SHAPE)).toBeNull();
    expect(withoutNull(UNKNOWN)).toBe(UNKNOWN);
  });
});

describe('elementOf and isArrayLike', () => {
  const list: Shape = { type: 'array', items: STRING_SHAPE };

  it('reads the items of a list, through null', () => {
    expect(elementOf(list)).toEqual(STRING_SHAPE);
    expect(elementOf(withNull(list))).toEqual(STRING_SHAPE);
    expect(elementOf(STRING_SHAPE)).toBe(UNKNOWN);
  });

  it('says yes, no or unknown', () => {
    expect(isArrayLike(list)).toBe('yes');
    expect(isArrayLike(STRING_SHAPE)).toBe('no');
    expect(isArrayLike(signature({}))).toBe('no');
    expect(isArrayLike(withNull(list))).toBe('unknown');
    expect(isArrayLike(UNKNOWN)).toBe('unknown');
  });
});

describe('isClosed', () => {
  it('closes exact origins and additionalProperties: false only', () => {
    expect(isClosed(signature({}))).toBe(true);
    expect(isClosed(obj({}, { 'x-origin': 'inferred' }))).toBe(true);
    expect(isClosed(obj({}, { 'x-origin': 'declared' }))).toBe(false);
    expect(isClosed(obj({}, { additionalProperties: false }))).toBe(true);
    expect(
      isClosed(
        obj({}, { 'x-origin': 'signature', additionalProperties: true }),
      ),
    ).toBe(false);
  });
});

describe('assignable — definite incompatibilities only', () => {
  it.each<[string, Shape, Shape, boolean]>([
    ['string → number', STRING_SHAPE, NUMBER_SHAPE, true],
    ['number → string', NUMBER_SHAPE, STRING_SHAPE, true],
    ['integer → number', { type: 'integer' }, NUMBER_SHAPE, false],
    ['number → integer', NUMBER_SHAPE, { type: 'integer' }, false],
    ['string | null → string', withNull(STRING_SHAPE), STRING_SHAPE, false],
    ['unknown → string', UNKNOWN, STRING_SHAPE, false],
    ['string → unknown', STRING_SHAPE, UNKNOWN, false],
    ['list → string', { type: 'array' }, STRING_SHAPE, true],
    [
      '"x" → enum [a, b]',
      { type: 'string', const: 'x' },
      { type: 'string', enum: ['a', 'b'] },
      true,
    ],
    [
      '"a" → enum [a, b]',
      { type: 'string', const: 'a' },
      { type: 'string', enum: ['a', 'b'] },
      false,
    ],
    [
      'string → string | number',
      STRING_SHAPE,
      union(STRING_SHAPE, NUMBER_SHAPE),
      false,
    ],
  ])('%s', (_, src, target, definite) => {
    expect(assignable(src, target) !== null).toBe(definite);
  });

  it('names the property where two objects differ', () => {
    const src = signature({ count: STRING_SHAPE });
    const target = obj({ count: NUMBER_SHAPE }, { 'x-origin': 'declared' });
    expect(assignable(src, target)).toEqual({
      expected: 'number',
      actual: 'string',
      path: ['count'],
    });
  });

  it('refuses an exact object lacking a required property', () => {
    const src = signature({ a: STRING_SHAPE });
    const target = obj({ a: STRING_SHAPE, b: STRING_SHAPE });
    expect(assignable(src, target)).toEqual({
      expected: 'string',
      actual: 'undefined',
      path: ['b'],
    });
    // An open source may still carry it.
    expect(assignable(obj({ a: STRING_SHAPE }), target)).toBeNull();
  });

  it('compares list items', () => {
    expect(
      assignable(
        { type: 'array', items: STRING_SHAPE },
        { type: 'array', items: NUMBER_SHAPE },
      ),
    ).toMatchObject({ path: ['*'] });
  });
});

describe('shapeOfValue and widen', () => {
  it('reads a literal value, widened and exact', () => {
    expect(shapeOfValue({ n: 1, tags: ['a'], none: null })).toEqual({
      type: 'object',
      properties: {
        n: NUMBER_SHAPE,
        tags: { type: 'array', items: STRING_SHAPE, 'x-origin': 'inferred' },
        none: NULL_SHAPE,
      },
      required: ['n', 'tags', 'none'],
      'x-origin': 'inferred',
    });
  });

  it('widens literals to their type', () => {
    expect(widen({ type: 'string', const: 'a' })).toEqual(STRING_SHAPE);
    expect(widen(union({ type: 'number', const: 1 }, NULL_SHAPE))).toEqual(
      withNull(NUMBER_SHAPE),
    );
  });
});

describe('toTs', () => {
  it('writes the TypeScript a reader expects', () => {
    const shape = signature({
      count: NUMBER_SHAPE,
      issues: {
        type: 'array',
        items: signature({ title: STRING_SHAPE, body: withNull(STRING_SHAPE) }),
      },
    });
    expect(toTs(shape)).toBe(
      '{ count: number, issues: Array<{ title: string, body: string | null }> }',
    );
    expect(toTs(shape, 1)).toBe('{ count: number, issues: Array<{…}> }');
  });

  it('marks optional keys, quotes odd keys and writes records and literals', () => {
    expect(
      toTs({
        type: 'object',
        properties: { 'a-b': STRING_SHAPE, c: NUMBER_SHAPE },
        required: ['c'],
      }),
    ).toBe('{ "a-b"?: string, c: number }');
    expect(toTs({ type: 'object', additionalProperties: NUMBER_SHAPE })).toBe(
      'Record<string, number>',
    );
    expect(toTs({ type: 'string', enum: ['p0', 'p1'] })).toBe('"p0" | "p1"');
    expect(toTs({ type: 'object' })).toBe('object');
    expect(toTs(UNKNOWN)).toBe('unknown');
  });
});
