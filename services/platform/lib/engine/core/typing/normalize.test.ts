// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { normalizeSchema } from './normalize';
import {
  isUnknown,
  lookup,
  NULL_SHAPE,
  NUMBER_SHAPE,
  STRING_SHAPE,
  toTs,
  UNKNOWN,
} from './shape';

describe('normalizeSchema', () => {
  it('reads an object schema, keeping required keys and closedness', () => {
    const shape = normalizeSchema({
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        limit: { type: 'number', minimum: 1 },
      },
      required: ['owner'],
      additionalProperties: false,
    });
    expect(shape).toEqual({
      type: 'object',
      'x-origin': 'declared',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        limit: NUMBER_SHAPE,
      },
      required: ['owner'],
      additionalProperties: false,
    });
    expect(toTs(shape)).toBe('{ owner: string, limit?: number }');
  });

  it('turns a list of types and nullable into unions', () => {
    expect(normalizeSchema({ type: ['string', 'null'] })).toEqual({
      anyOf: [STRING_SHAPE, NULL_SHAPE],
    });
    expect(normalizeSchema({ type: 'number', nullable: true })).toEqual({
      anyOf: [NUMBER_SHAPE, NULL_SHAPE],
    });
  });

  it('flattens anyOf and oneOf, distributing sibling keywords', () => {
    expect(
      toTs(
        normalizeSchema({
          oneOf: [
            { type: 'string' },
            { anyOf: [{ type: 'number' }, { type: 'null' }] },
          ],
        }),
      ),
    ).toBe('string | number | null');
    const distributed = normalizeSchema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      anyOf: [{ required: ['a'] }, { required: ['b'] }],
    });
    expect(lookup(distributed, 'a')).toMatchObject({
      kind: 'found',
      optional: true,
    });
  });

  it('merges allOf parts that are objects, and gives up on anything else', () => {
    const merged = normalizeSchema({
      allOf: [
        {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a'],
        },
        {
          type: 'object',
          properties: { b: { type: 'number' } },
          required: ['b'],
        },
      ],
    });
    expect(toTs(merged)).toBe('{ a: string, b: number }');
    expect(
      normalizeSchema({ allOf: [{ type: 'string' }, { minLength: 2 }] }),
    ).toBe(UNKNOWN);
  });

  it('resolves local references and leaves remote ones unknown', () => {
    const shape = normalizeSchema({
      type: 'object',
      properties: {
        author: { $ref: '#/$defs/person' },
        reviewer: { $ref: '#/definitions/person' },
        remote: { $ref: 'https://example.com/schema.json' },
      },
      $defs: {
        person: { type: 'object', properties: { name: { type: 'string' } } },
      },
      definitions: {
        person: { type: 'object', properties: { name: { type: 'string' } } },
      },
    });
    expect(toTs(shape)).toBe(
      '{ author?: { name?: string }, reviewer?: { name?: string }, remote?: unknown }',
    );
  });

  it('stops a self-referencing schema instead of looping', () => {
    const shape = normalizeSchema({
      $defs: {
        node: {
          type: 'object',
          properties: { child: { $ref: '#/$defs/node' } },
        },
      },
      $ref: '#/$defs/node',
    });
    expect(shape.type).toBe('object');
  });

  it('reads tuples as the union of their items', () => {
    expect(
      normalizeSchema({
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }],
      }),
    ).toEqual({
      type: 'array',
      'x-origin': 'declared',
      items: { anyOf: [STRING_SHAPE, NUMBER_SHAPE] },
    });
  });

  it('infers the type a schema implies, and keeps literals', () => {
    expect(
      normalizeSchema({ properties: { a: { const: 'x' } } }),
    ).toMatchObject({
      type: 'object',
      properties: { a: { type: 'string', const: 'x' } },
    });
    expect(normalizeSchema({ enum: ['p0', 'p1'] })).toEqual({
      type: 'string',
      enum: ['p0', 'p1'],
    });
    expect(normalizeSchema({ type: 'string', enum: ['a', 1] })).toEqual({
      type: 'string',
      enum: ['a'],
    });
  });

  it('opens an object past 200 properties or with pattern properties', () => {
    const properties = Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [`k${i}`, { type: 'string' }]),
    );
    const wide = normalizeSchema({ type: 'object', properties });
    expect(Object.keys(wide.properties ?? {})).toHaveLength(200);
    expect(wide.additionalProperties).toBe(true);
    expect(
      normalizeSchema({
        type: 'object',
        patternProperties: { '^x-': { type: 'string' } },
        additionalProperties: false,
      }).additionalProperties,
    ).toBe(true);
  });

  it('is unknown for what it cannot read', () => {
    expect(normalizeSchema(undefined)).toBe(UNKNOWN);
    expect(normalizeSchema(true)).toBe(UNKNOWN);
    expect(isUnknown(normalizeSchema({ description: 'anything' }))).toBe(true);
    expect(normalizeSchema({ type: 'date' })).toBe(UNKNOWN);
  });

  it('caps nesting depth', () => {
    let schema: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 12; i++) {
      schema = { type: 'object', properties: { x: schema } };
    }
    expect(toTs(normalizeSchema(schema), 20)).toContain('unknown');
  });

  it('tags objects with the origin it is given', () => {
    expect(normalizeSchema({ type: 'object' }, 'child')['x-origin']).toBe(
      'child',
    );
  });
});
