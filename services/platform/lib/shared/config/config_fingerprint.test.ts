import { describe, expect, it } from 'vitest';

import {
  classifyJsonSchema,
  computeConfigFingerprint,
  diffConfigFingerprints,
  type ConfigFingerprint,
  type JsonSchema,
} from './config_fingerprint';

// JSON Schema node builders (mirror `z.toJSONSchema` output).
const str: JsonSchema = { type: 'string' };
const numS: JsonSchema = { type: 'number' };
const any: JsonSchema = {};
const enumOf = (...v: string[]): JsonSchema => ({ type: 'string', enum: v });
const arrOf = (items: JsonSchema): JsonSchema => ({ type: 'array', items });
const anyOf = (...m: JsonSchema[]): JsonSchema => ({ anyOf: m });
const objOf = (
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

describe('classifyJsonSchema', () => {
  it('reports identical schemas as same', () => {
    expect(classifyJsonSchema(str, { type: 'string' })).toBe('same');
    expect(classifyJsonSchema(enumOf('a', 'b'), enumOf('a', 'b'))).toBe('same');
  });

  it('enum WIDEN is safe, enum NARROW is breaking', () => {
    expect(classifyJsonSchema(enumOf('a', 'b'), enumOf('a', 'b', 'c'))).toBe(
      'safe',
    );
    expect(classifyJsonSchema(enumOf('a', 'b', 'c'), enumOf('a', 'b'))).toBe(
      'breaking',
    );
  });

  it('enum→open string is safe; string→enum narrows', () => {
    expect(classifyJsonSchema(enumOf('a', 'b'), str)).toBe('safe');
    expect(classifyJsonSchema(str, enumOf('a', 'b'))).toBe('breaking');
  });

  it('→any is safe; any→constrained is breaking', () => {
    expect(classifyJsonSchema(str, any)).toBe('safe');
    expect(classifyJsonSchema(any, str)).toBe('breaking');
  });

  it('a real retype is breaking', () => {
    expect(classifyJsonSchema(str, numS)).toBe('breaking');
  });

  it('tightening a string constraint breaks; loosening is safe', () => {
    expect(
      classifyJsonSchema({ type: 'string' }, { type: 'string', minLength: 3 }),
    ).toBe('breaking');
    expect(
      classifyJsonSchema({ type: 'string', maxLength: 10 }, { type: 'string' }),
    ).toBe('safe');
    expect(
      classifyJsonSchema({ type: 'string' }, { type: 'string', pattern: '^x' }),
    ).toBe('breaking');
  });

  it('tightening a number range breaks; widening is safe', () => {
    expect(
      classifyJsonSchema({ type: 'number' }, { type: 'number', minimum: 0 }),
    ).toBe('breaking');
    expect(
      classifyJsonSchema({ type: 'number', maximum: 5 }, { type: 'number' }),
    ).toBe('safe');
  });

  it('recurses into arrays and unions', () => {
    expect(
      classifyJsonSchema(arrOf(enumOf('a')), arrOf(enumOf('a', 'b'))),
    ).toBe('safe');
    expect(classifyJsonSchema(arrOf(str), arrOf(numS))).toBe('breaking');
    expect(classifyJsonSchema(anyOf(str), anyOf(str, numS))).toBe('safe');
    expect(classifyJsonSchema(anyOf(str, numS), anyOf(str))).toBe('breaking');
  });

  it('recurses into objects with INVERTED Zod rules', () => {
    const base = objOf({ a: str }, ['a']);
    const addedOptional = objOf({ a: str, b: numS }, ['a']);
    const addedRequired = objOf({ a: str, b: numS }, ['a', 'b']);
    // Zod strips unknown keys → a REMOVED field is SAFE (unlike Convex).
    expect(classifyJsonSchema(addedOptional, base)).toBe('safe');
    expect(classifyJsonSchema(base, addedOptional)).toBe('safe');
    expect(classifyJsonSchema(base, addedRequired)).toBe('breaking');
    // optional → required breaks.
    expect(
      classifyJsonSchema(objOf({ a: str }, []), objOf({ a: str }, ['a'])),
    ).toBe('breaking');
    // required → optional is safe.
    expect(
      classifyJsonSchema(objOf({ a: str }, ['a']), objOf({ a: str }, [])),
    ).toBe('safe');
  });
});

function fp(schemas: ConfigFingerprint['schemas']): ConfigFingerprint {
  return { schemas };
}

describe('diffConfigFingerprints', () => {
  it('no changes for an identical fingerprint', () => {
    const f = fp({ a: objOf({ x: str }, ['x']) });
    expect(diffConfigFingerprints(f, f)).toEqual([]);
  });

  it('new schema is safe, removed schema is safe', () => {
    const base = fp({ a: objOf({ x: str }, ['x']) });
    const added = fp({ a: objOf({ x: str }, ['x']), b: enumOf('y') });
    expect(diffConfigFingerprints(base, added)).toEqual([
      { schema: 'b', kind: 'safe', detail: 'new schema' },
    ]);
    expect(diffConfigFingerprints(added, base)).toEqual([
      { schema: 'b', kind: 'safe', detail: 'schema removed' },
    ]);
  });

  it('classifies field add/remove/tighten with config rules', () => {
    const base = fp({
      s: objOf(
        {
          keep: str,
          loosen: str,
          tighten: str,
          drop: str,
          narrow: enumOf('a', 'b'),
        },
        ['keep', 'loosen', 'drop', 'narrow'], // 'tighten' optional here
      ),
    });
    const next = fp({
      s: objOf(
        {
          keep: str,
          loosen: str,
          tighten: str,
          narrow: enumOf('a'),
          addOpt: numS,
          addReq: numS,
        },
        ['keep', 'tighten', 'narrow', 'addReq'],
      ),
    });
    const byField = Object.fromEntries(
      diffConfigFingerprints(base, next).map((c) => [
        c.path ?? c.schema,
        c.kind,
      ]),
    );
    expect(byField).toEqual({
      addOpt: 'safe', // new optional field
      addReq: 'breaking', // new required field
      drop: 'safe', // removed field — Zod strips
      loosen: 'safe', // required → optional
      narrow: 'breaking', // enum narrowed
      tighten: 'breaking', // optional → required
    });
  });
});

describe('computeConfigFingerprint', () => {
  it('strips annotation-only keywords so doc edits are not drift', () => {
    const withDocs = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      description: 'a thing',
      properties: {
        a: { type: 'string', description: 'the a', default: 'x' },
      },
      required: ['a'],
      additionalProperties: false,
    };
    const fpd = computeConfigFingerprint({ s: withDocs });
    expect(fpd.schemas.s).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });
  });

  it('never strips PROPERTIES that happen to share an annotation keyword name', () => {
    // A config field may be called `description`, `default`, `title`, or
    // `id` — inside a properties/$defs map those are data, not keywords.
    // Dropping them blinded the drift gate to their changes (real bug caught
    // by the version-checkpoint suite).
    const schema = {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'doc text (annotation)' },
        default: { type: 'boolean' },
        id: { type: 'string' },
      },
      required: ['description'],
      additionalProperties: false,
      $defs: {
        title: { type: 'number' },
      },
    };
    const fp = computeConfigFingerprint({ s: schema });
    expect(fp.schemas.s).toEqual({
      type: 'object',
      properties: {
        description: { type: 'string' }, // kept as a property, doc stripped
        default: { type: 'boolean' },
        id: { type: 'string' },
      },
      required: ['description'],
      additionalProperties: false,
      $defs: {
        title: { type: 'number' },
      },
    });
  });
});
