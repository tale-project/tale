import { describe, expect, it } from 'vitest';

import {
  buildInputTemplateFromSchema,
  getMissingRequiredFields,
  type InputSchema,
} from './input-schema-template';

const schema: InputSchema = {
  properties: {
    sourceId: { type: 'string' },
    limit: { type: 'number' },
    enabled: { type: 'boolean' },
    tags: { type: 'array' },
    note: { type: 'string' },
  },
  required: ['sourceId', 'limit', 'enabled', 'tags'],
};

describe('getMissingRequiredFields', () => {
  it('returns [] when the schema has no required fields', () => {
    expect(getMissingRequiredFields(undefined, {})).toEqual([]);
    expect(
      getMissingRequiredFields({ properties: {}, required: [] }, {}),
    ).toEqual([]);
  });

  it('treats every required field as missing when input is not an object', () => {
    expect(getMissingRequiredFields(schema, null)).toEqual([
      'sourceId',
      'limit',
      'enabled',
      'tags',
    ]);
    expect(getMissingRequiredFields(schema, 'oops')).toEqual([
      'sourceId',
      'limit',
      'enabled',
      'tags',
    ]);
    expect(getMissingRequiredFields(schema, [1, 2])).toEqual([
      'sourceId',
      'limit',
      'enabled',
      'tags',
    ]);
  });

  it('flags absent, null, blank-string, and empty-array required fields', () => {
    expect(
      getMissingRequiredFields(schema, {
        sourceId: '',
        limit: null,
        // enabled absent
        tags: [],
      }),
    ).toEqual(['sourceId', 'limit', 'enabled', 'tags']);
  });

  it('accepts 0 and false as configured values', () => {
    expect(
      getMissingRequiredFields(schema, {
        sourceId: 'abc',
        limit: 0,
        enabled: false,
        tags: ['x'],
      }),
    ).toEqual([]);
  });

  it('ignores whitespace-only strings', () => {
    expect(
      getMissingRequiredFields(schema, {
        sourceId: '   ',
        limit: 5,
        enabled: true,
        tags: ['x'],
      }),
    ).toEqual(['sourceId']);
  });

  it('flags an empty required object', () => {
    const objSchema: InputSchema = {
      properties: { payload: { type: 'object' } },
      required: ['payload'],
    };
    expect(getMissingRequiredFields(objSchema, { payload: {} })).toEqual([
      'payload',
    ]);
    expect(getMissingRequiredFields(objSchema, { payload: { a: 1 } })).toEqual(
      [],
    );
  });

  it('matches the pre-filled template (required strings start blank → flagged)', () => {
    const template = JSON.parse(
      buildInputTemplateFromSchema(schema),
    ) as unknown;
    // Required string `sourceId` defaults to "" and required array `tags`
    // defaults to [] in the template, so a freshly-opened tester is gated.
    expect(getMissingRequiredFields(schema, template)).toContain('sourceId');
    expect(getMissingRequiredFields(schema, template)).toContain('tags');
  });
});
