import { describe, expect, it } from 'vitest';

import {
  classifyType,
  computeFingerprint,
  diffFingerprints,
  type FieldType,
  type SchemaFingerprint,
} from './schema_fingerprint';

// Convex `Validator.json` shapes, as `schema.export()` emits them.
const str: FieldType = { type: 'string' };
const num: FieldType = { type: 'number' };
const any: FieldType = { type: 'any' };
const lit = (...vals: string[]): FieldType =>
  vals.length === 1
    ? { type: 'literal', value: vals[0] }
    : {
        type: 'union',
        value: vals.map((v) => ({ type: 'literal', value: v })),
      };
const arr = (el: FieldType): FieldType => ({ type: 'array', value: el });
const id = (tableName: string): FieldType => ({ type: 'id', tableName });
const obj = (
  fields: Record<string, { fieldType: FieldType; optional: boolean }>,
): FieldType => ({ type: 'object', value: fields });

describe('classifyType', () => {
  it('reports identical types as same', () => {
    expect(classifyType(str, { type: 'string' })).toBe('same');
    expect(classifyType(lit('a', 'b'), lit('a', 'b'))).toBe('same');
  });

  it('treats a grown literal union as a widen', () => {
    expect(classifyType(lit('a', 'b'), lit('a', 'b', 'c'))).toBe('widen');
    expect(classifyType(lit('a'), lit('a', 'b'))).toBe('widen');
  });

  it('treats a shrunk literal union as incompatible', () => {
    expect(classifyType(lit('a', 'b', 'c'), lit('a', 'b'))).toBe(
      'incompatible',
    );
    // The exact case from the v0.2.48 audit: dropping a literal a row may hold.
    expect(
      classifyType(
        lit('retention_policy', 'audit_retention', 'login_policy'),
        lit('retention_policy', 'login_policy', 'two_factor_policy'),
      ),
    ).toBe('incompatible');
  });

  it('treats literal-union → open string as a widen, and the reverse as incompatible', () => {
    expect(classifyType(lit('a', 'b'), str)).toBe('widen');
    expect(classifyType(str, lit('a', 'b'))).toBe('incompatible');
  });

  it('treats → any as widen and any → narrower as incompatible', () => {
    expect(classifyType(str, any)).toBe('widen');
    expect(classifyType(any, str)).toBe('incompatible');
  });

  it('flags primitive retypes and id retargets as incompatible', () => {
    expect(classifyType(str, num)).toBe('incompatible');
    expect(classifyType(id('projects'), id('threads'))).toBe('incompatible');
    expect(classifyType(id('projects'), id('projects'))).toBe('same');
  });

  it('recurses into arrays', () => {
    expect(classifyType(arr(lit('a')), arr(lit('a', 'b')))).toBe('widen');
    expect(classifyType(arr(str), arr(num))).toBe('incompatible');
  });

  it('recurses into objects (nested add/drop/tighten)', () => {
    const base = obj({ a: { fieldType: str, optional: false } });
    const addedOptional = obj({
      a: { fieldType: str, optional: false },
      b: { fieldType: num, optional: true },
    });
    const addedRequired = obj({
      a: { fieldType: str, optional: false },
      b: { fieldType: num, optional: false },
    });
    expect(classifyType(base, addedOptional)).toBe('widen');
    expect(classifyType(base, addedRequired)).toBe('incompatible');
    expect(classifyType(addedOptional, base)).toBe('incompatible'); // nested drop
  });

  it('treats a grown non-literal union as a widen', () => {
    const a: FieldType = { type: 'union', value: [str, num] };
    const b: FieldType = {
      type: 'union',
      value: [str, num, { type: 'boolean' }],
    };
    expect(classifyType(a, b)).toBe('widen');
    expect(classifyType(b, a)).toBe('incompatible');
  });
});

function fp(tables: SchemaFingerprint['tables']): SchemaFingerprint {
  return { schemaValidation: true, tables };
}

describe('diffFingerprints', () => {
  it('returns no changes for an identical fingerprint', () => {
    const f = fp({ t: { a: { ft: str, optional: false } } });
    expect(diffFingerprints(f, f)).toEqual([]);
  });

  it('classifies a new table as safe and a dropped table as incompatible', () => {
    const base = fp({ t: { a: { ft: str, optional: false } } });
    const added = fp({
      t: { a: { ft: str, optional: false } },
      t2: { b: { ft: num, optional: false } },
    });
    expect(diffFingerprints(base, added)).toEqual([
      { table: 't2', kind: 'safe', detail: 'new table' },
    ]);
    expect(diffFingerprints(added, base)).toEqual([
      { table: 't2', kind: 'incompatible', detail: 'table dropped' },
    ]);
  });

  it('classifies field add/drop/tighten/widen', () => {
    const base = fp({
      t: {
        keep: { ft: str, optional: false },
        loosen: { ft: str, optional: false },
        tighten: { ft: str, optional: true },
        drop: { ft: str, optional: false },
        narrow: { ft: lit('a', 'b'), optional: false },
      },
    });
    const next = fp({
      t: {
        keep: { ft: str, optional: false },
        loosen: { ft: str, optional: true },
        tighten: { ft: str, optional: false },
        narrow: { ft: lit('a'), optional: false },
        addOpt: { ft: num, optional: true },
        addReq: { ft: num, optional: false },
      },
    });
    const byField = Object.fromEntries(
      diffFingerprints(base, next).map((c) => [c.field, c.kind]),
    );
    expect(byField).toEqual({
      addOpt: 'safe',
      addReq: 'incompatible',
      drop: 'incompatible',
      loosen: 'safe',
      narrow: 'incompatible',
      tighten: 'incompatible',
    });
  });
});

describe('computeFingerprint', () => {
  it('parses schema.export() JSON into per-field shapes', () => {
    const exported = JSON.stringify({
      schemaValidation: true,
      tables: [
        {
          tableName: 'docs',
          documentType: {
            type: 'object',
            value: {
              org: { fieldType: { type: 'string' }, optional: false },
              note: { fieldType: { type: 'string' }, optional: true },
            },
          },
        },
      ],
    });
    expect(computeFingerprint(exported)).toEqual({
      schemaValidation: true,
      tables: {
        docs: {
          org: { ft: { type: 'string' }, optional: false },
          note: { ft: { type: 'string' }, optional: true },
        },
      },
    });
  });
});
