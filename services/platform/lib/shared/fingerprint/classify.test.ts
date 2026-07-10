/**
 * Parity corpus for the shared shape-drift classifier.
 *
 * Every row runs a (baseline, current) shape pair through the two PUBLIC
 * facades — `classifyType` (Convex validator JSON) and `classifyJsonSchema`
 * (Zod → JSON Schema) — and pins the verdict the legacy per-side classifiers
 * defined. The corpus was executed against the pre-refactor implementations
 * first; these expectations ARE the old behaviour, including its documented
 * quirks. A row carrying both sides with different verdicts is a deliberate
 * rule-table divergence (see `convex_validator.ts` / `json_schema.ts`).
 */

import { describe, expect, it } from 'vitest';

import {
  classifyType,
  diffFingerprints,
  type FieldType,
  type SchemaFingerprint,
} from '../../../convex/migrations/framework/schema_fingerprint';
import {
  classifyJsonSchema,
  diffConfigFingerprints,
  type ConfigFingerprint,
  type JsonSchema,
} from '../config/config_fingerprint';

// --- Convex validator-JSON builders (as `schema.export()` emits them) -------
const cStr: FieldType = { type: 'string' };
const cNum: FieldType = { type: 'number' };
const cBool: FieldType = { type: 'boolean' };
const cAny: FieldType = { type: 'any' };
const cLit = (...vals: unknown[]): FieldType =>
  vals.length === 1
    ? { type: 'literal', value: vals[0] }
    : {
        type: 'union',
        value: vals.map((v) => ({ type: 'literal', value: v })),
      };
const cUnion = (...members: FieldType[]): FieldType => ({
  type: 'union',
  value: members,
});
const cArr = (el: FieldType): FieldType => ({ type: 'array', value: el });
const cId = (tableName: string): FieldType => ({ type: 'id', tableName });
const cObj = (
  fields: Record<string, { fieldType: FieldType; optional: boolean }>,
): FieldType => ({ type: 'object', value: fields });
const cRec = (keys: FieldType, values: FieldType): FieldType => ({
  type: 'record',
  keys,
  values: { fieldType: values, optional: false },
});

// --- JSON-Schema builders (as `z.toJSONSchema` emits them) ------------------
const jStr: JsonSchema = { type: 'string' };
const jNum: JsonSchema = { type: 'number' };
const jBool: JsonSchema = { type: 'boolean' };
const jAny: JsonSchema = {};
const jEnum = (...v: string[]): JsonSchema => ({ type: 'string', enum: v });
const jConst = (v: unknown): JsonSchema => ({ const: v });
const jArr = (items: JsonSchema): JsonSchema => ({ type: 'array', items });
const jUnion = (...m: JsonSchema[]): JsonSchema => ({ anyOf: m });
const jObj = (
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

type ConvexVerdict = 'same' | 'widen' | 'incompatible';
type ConfigVerdict = 'same' | 'safe' | 'breaking';

interface ParityRow {
  readonly name: string;
  readonly convex?: readonly [FieldType, FieldType, ConvexVerdict];
  readonly config?: readonly [JsonSchema, JsonSchema, ConfigVerdict];
}

const corpus: readonly ParityRow[] = [
  // --- identity ---------------------------------------------------------
  {
    name: 'identical scalars are same',
    convex: [cStr, { type: 'string' }, 'same'],
    config: [jStr, { type: 'string' }, 'same'],
  },
  {
    name: 'reordered literal set of equal membership is same',
    convex: [cLit('a', 'b'), cLit('b', 'a'), 'same'],
    config: [jEnum('a', 'b'), jEnum('b', 'a'), 'same'],
  },
  // --- literal sets -------------------------------------------------------
  {
    name: 'widened literal set is safe',
    convex: [cLit('a', 'b'), cLit('a', 'b', 'c'), 'widen'],
    config: [jEnum('a', 'b'), jEnum('a', 'b', 'c'), 'safe'],
  },
  {
    name: 'narrowed literal set breaks',
    convex: [cLit('a', 'b', 'c'), cLit('a', 'b'), 'incompatible'],
    config: [jEnum('a', 'b', 'c'), jEnum('a', 'b'), 'breaking'],
  },
  {
    name: 'literal set → open string is safe',
    convex: [cLit('a', 'b'), cStr, 'widen'],
    config: [jEnum('a', 'b'), jStr, 'safe'],
  },
  {
    name: 'open string → literal set breaks',
    convex: [cStr, cLit('a', 'b'), 'incompatible'],
    config: [jStr, jEnum('a', 'b'), 'breaking'],
  },
  {
    // DIVERGENCE: Convex falls through to the union member-subset check, the
    // JSON-Schema value-set branch decides first (legacy branch order).
    name: 'single literal → mixed union containing it: Convex widens, config breaks',
    convex: [cLit('a'), cUnion({ type: 'literal', value: 'a' }, cNum), 'widen'],
    config: [jConst('a'), jUnion(jConst('a'), jNum), 'breaking'],
  },
  {
    // Config quirk (legacy): a numeric-only target passes the widen check even
    // for a STRING enum baseline (`numLike` catch-all).
    name: 'config quirk: string enum → open number is safe; convex breaks',
    convex: [cLit('a', 'b'), cNum, 'incompatible'],
    config: [jEnum('a', 'b'), jNum, 'safe'],
  },
  {
    name: 'numeric const → open number of its base is safe (config)',
    config: [jConst(5), jNum, 'safe'],
  },
  {
    name: 'const → open boolean breaks (config)',
    config: [jConst('a'), jBool, 'breaking'],
  },
  // --- any ----------------------------------------------------------------
  {
    name: 'anything → any is safe',
    convex: [cStr, cAny, 'widen'],
    config: [jStr, jAny, 'safe'],
  },
  {
    name: 'any → constrained breaks',
    convex: [cAny, cStr, 'incompatible'],
    config: [jAny, jStr, 'breaking'],
  },
  // --- retypes --------------------------------------------------------------
  {
    name: 'scalar retype breaks',
    convex: [cStr, cNum, 'incompatible'],
    config: [jStr, jNum, 'breaking'],
  },
  {
    name: 'kind retype (array → object) breaks',
    convex: [cArr(cStr), cObj({}), 'incompatible'],
    config: [jArr(jStr), jObj({}, []), 'breaking'],
  },
  // --- unions ---------------------------------------------------------------
  {
    name: 'union grown by a member is safe',
    convex: [cUnion(cStr, cNum), cUnion(cStr, cNum, cBool), 'widen'],
    config: [jUnion(jStr, jNum), jUnion(jStr, jNum, jBool), 'safe'],
  },
  {
    name: 'union shrunk by a member breaks',
    convex: [cUnion(cStr, cNum, cBool), cUnion(cStr, cNum), 'incompatible'],
    config: [jUnion(jStr, jNum, jBool), jUnion(jStr, jNum), 'breaking'],
  },
  {
    // Members compare as signature SETS, so equal membership in a different
    // order is a subset — legacy reports the widen verdict, not `same`.
    name: 'union reordered with equal membership reports safe (legacy)',
    convex: [cUnion(cStr, cNum), cUnion(cNum, cStr), 'widen'],
    config: [jUnion(jStr, jNum), jUnion(jNum, jStr), 'safe'],
  },
  {
    name: 'single shape → union containing it is safe (non-literal)',
    convex: [cStr, cUnion(cStr, cNum), 'widen'],
    config: [jStr, jUnion(jStr, jNum), 'safe'],
  },
  // --- arrays -----------------------------------------------------------------
  {
    name: 'array element widened is safe',
    convex: [cArr(cLit('a')), cArr(cLit('a', 'b')), 'widen'],
    config: [jArr(jEnum('a')), jArr(jEnum('a', 'b')), 'safe'],
  },
  {
    name: 'array element retyped breaks',
    convex: [cArr(cStr), cArr(cNum), 'incompatible'],
    config: [jArr(jStr), jArr(jNum), 'breaking'],
  },
  // --- objects ------------------------------------------------------------------
  {
    name: 'added optional property is safe',
    convex: [
      cObj({ a: { fieldType: cStr, optional: false } }),
      cObj({
        a: { fieldType: cStr, optional: false },
        b: { fieldType: cNum, optional: true },
      }),
      'widen',
    ],
    config: [
      jObj({ a: jStr }, ['a']),
      jObj({ a: jStr, b: jNum }, ['a']),
      'safe',
    ],
  },
  {
    name: 'added required property breaks',
    convex: [
      cObj({ a: { fieldType: cStr, optional: false } }),
      cObj({
        a: { fieldType: cStr, optional: false },
        b: { fieldType: cNum, optional: false },
      }),
      'incompatible',
    ],
    config: [
      jObj({ a: jStr }, ['a']),
      jObj({ a: jStr, b: jNum }, ['a', 'b']),
      'breaking',
    ],
  },
  {
    // THE rule-table divergence: stored Convex rows still carry a dropped
    // property (push-time revalidation fails); Zod strips unknown keys.
    name: 'removed property: Convex breaks, config is safe',
    convex: [
      cObj({
        a: { fieldType: cStr, optional: false },
        b: { fieldType: cNum, optional: true },
      }),
      cObj({ a: { fieldType: cStr, optional: false } }),
      'incompatible',
    ],
    config: [
      jObj({ a: jStr, b: jNum }, ['a']),
      jObj({ a: jStr }, ['a']),
      'safe',
    ],
  },
  {
    name: 'property optional → required breaks',
    convex: [
      cObj({ a: { fieldType: cStr, optional: true } }),
      cObj({ a: { fieldType: cStr, optional: false } }),
      'incompatible',
    ],
    config: [jObj({ a: jStr }, []), jObj({ a: jStr }, ['a']), 'breaking'],
  },
  {
    name: 'property required → optional is safe',
    convex: [
      cObj({ a: { fieldType: cStr, optional: false } }),
      cObj({ a: { fieldType: cStr, optional: true } }),
      'widen',
    ],
    config: [jObj({ a: jStr }, ['a']), jObj({ a: jStr }, []), 'safe'],
  },
  {
    name: 'nested object property narrowed breaks',
    convex: [
      cObj({
        outer: {
          fieldType: cObj({
            inner: { fieldType: cLit('a', 'b'), optional: false },
          }),
          optional: false,
        },
      }),
      cObj({
        outer: {
          fieldType: cObj({ inner: { fieldType: cLit('a'), optional: false } }),
          optional: false,
        },
      }),
      'incompatible',
    ],
    config: [
      jObj({ outer: jObj({ inner: jEnum('a', 'b') }, ['inner']) }, ['outer']),
      jObj({ outer: jObj({ inner: jEnum('a') }, ['inner']) }, ['outer']),
      'breaking',
    ],
  },
  // --- id refs (Convex only — JSON Schema has no id nodes) ---------------------
  {
    name: 'id retargeted to another table breaks',
    convex: [cId('projects'), cId('threads'), 'incompatible'],
  },
  {
    name: 'id keeping its table is same',
    convex: [cId('projects'), cId('projects'), 'same'],
  },
  {
    name: 'id → string retype breaks',
    convex: [cId('projects'), cStr, 'incompatible'],
  },
  // --- records (Convex: conservative, never recursed) ---------------------------
  {
    name: 'record value retype breaks (no structural recursion)',
    convex: [cRec(cStr, cStr), cRec(cStr, cNum), 'incompatible'],
  },
  {
    name: 'identical record is same',
    convex: [cRec(cStr, cStr), cRec(cStr, cStr), 'same'],
  },
  // --- scalar constraints (config only — Convex validators carry none) ---------
  {
    name: 'minLength added breaks; maxLength dropped is safe',
    config: [jStr, { type: 'string', minLength: 3 }, 'breaking'],
  },
  {
    name: 'maxLength dropped is safe',
    config: [{ type: 'string', maxLength: 10 }, jStr, 'safe'],
  },
  {
    name: 'pattern added breaks',
    config: [jStr, { type: 'string', pattern: '^x' }, 'breaking'],
  },
  {
    name: 'pattern dropped is safe',
    config: [{ type: 'string', pattern: '^x' }, jStr, 'safe'],
  },
  {
    name: 'format added breaks',
    config: [jStr, { type: 'string', format: 'email' }, 'breaking'],
  },
  {
    name: 'format dropped is safe',
    config: [{ type: 'string', format: 'email' }, jStr, 'safe'],
  },
  {
    name: 'minimum added breaks',
    config: [jNum, { type: 'number', minimum: 0 }, 'breaking'],
  },
  {
    name: 'maximum dropped is safe',
    config: [{ type: 'number', maximum: 5 }, jNum, 'safe'],
  },
  {
    name: 'multipleOf added breaks; dropped is safe',
    config: [jNum, { type: 'number', multipleOf: 2 }, 'breaking'],
  },
  {
    name: 'multipleOf dropped is safe',
    config: [{ type: 'number', multipleOf: 2 }, jNum, 'safe'],
  },
  {
    name: 'minItems added breaks',
    config: [
      jArr(jStr),
      { type: 'array', items: jStr, minItems: 1 },
      'breaking',
    ],
  },
  {
    name: 'maxItems dropped is safe',
    config: [{ type: 'array', items: jStr, maxItems: 4 }, jArr(jStr), 'safe'],
  },
  // --- JSON-Schema type sets (config only — Convex types are single) -----------
  {
    name: 'type set widened (string → string|null) is safe',
    config: [jStr, { type: ['string', 'null'] }, 'safe'],
  },
  {
    name: 'type set narrowed (string|null → string) breaks',
    config: [{ type: ['string', 'null'] }, jStr, 'breaking'],
  },
  {
    // Legacy quirk: the type-set compare treats integer → number as a retype,
    // not a widen ('integer' ∉ {'number'}).
    name: 'config quirk: integer → number breaks',
    config: [{ type: 'integer' }, jNum, 'breaking'],
  },
];

describe('classifier parity corpus (facades reproduce the legacy verdicts)', () => {
  it.each(corpus)('$name', (row) => {
    if (row.convex) {
      const [a, b, expected] = row.convex;
      expect(classifyType(a, b), 'convex verdict').toBe(expected);
    }
    if (row.config) {
      const [a, b, expected] = row.config;
      expect(classifyJsonSchema(a, b), 'config verdict').toBe(expected);
    }
  });
});

// --- diff-level parity: exact change objects and detail strings --------------

function schemaFp(tables: SchemaFingerprint['tables']): SchemaFingerprint {
  return { schemaValidation: true, tables };
}
function configFp(schemas: ConfigFingerprint['schemas']): ConfigFingerprint {
  return { schemas };
}

describe('diff-level parity (exact change shapes + detail strings)', () => {
  it('dropped field: Convex incompatible, config safe — verbatim details', () => {
    const convexBase = schemaFp({
      t: {
        keep: { ft: cStr, optional: false },
        gone: { ft: cNum, optional: true },
      },
    });
    const convexNext = schemaFp({ t: { keep: { ft: cStr, optional: false } } });
    expect(diffFingerprints(convexBase, convexNext)).toEqual([
      {
        table: 't',
        field: 'gone',
        kind: 'incompatible',
        detail: 'field dropped (rows still carry it → push fails)',
      },
    ]);

    const configBase = configFp({
      s: jObj({ keep: jStr, gone: jNum }, ['keep']),
    });
    const configNext = configFp({ s: jObj({ keep: jStr }, ['keep']) });
    expect(diffConfigFingerprints(configBase, configNext)).toEqual([
      {
        schema: 's',
        path: 'gone',
        kind: 'safe',
        detail: 'field removed (Zod strips unknown keys by default)',
      },
    ]);
  });

  it('container removed: Convex table dropped breaks, config schema removed is safe', () => {
    const convexBase = schemaFp({ t: { a: { ft: cStr, optional: false } } });
    expect(diffFingerprints(convexBase, schemaFp({}))).toEqual([
      { table: 't', kind: 'incompatible', detail: 'table dropped' },
    ]);

    const configBase = configFp({ s: jObj({ a: jStr }, ['a']) });
    expect(diffConfigFingerprints(configBase, configFp({}))).toEqual([
      { schema: 's', kind: 'safe', detail: 'schema removed' },
    ]);
  });

  it('required → optional plus a widened type: Convex reports one change, config two', () => {
    const convexBase = schemaFp({
      t: { f: { ft: cLit('a'), optional: false } },
    });
    const convexNext = schemaFp({
      t: { f: { ft: cLit('a', 'b'), optional: true } },
    });
    expect(diffFingerprints(convexBase, convexNext)).toEqual([
      { table: 't', field: 'f', kind: 'safe', detail: 'type widened' },
    ]);

    const configBase = configFp({ s: jObj({ f: jEnum('a') }, ['f']) });
    const configNext = configFp({ s: jObj({ f: jEnum('a', 'b') }, []) });
    expect(diffConfigFingerprints(configBase, configNext)).toEqual([
      { schema: 's', path: 'f', kind: 'safe', detail: 'required → optional' },
      { schema: 's', path: 'f', kind: 'safe', detail: 'type widened' },
    ]);
  });

  it('optional → required wins over the type verdict on the Convex side', () => {
    const base = schemaFp({ t: { f: { ft: cLit('a'), optional: true } } });
    const next = schemaFp({
      t: { f: { ft: cLit('a', 'b'), optional: false } },
    });
    expect(diffFingerprints(base, next)).toEqual([
      {
        table: 't',
        field: 'f',
        kind: 'incompatible',
        detail: 'optional → required (old rows missing it → push fails)',
      },
    ]);
  });

  it('non-object config schema diffs as a whole with verbatim details', () => {
    const base = configFp({ s: jEnum('a', 'b') });
    expect(diffConfigFingerprints(base, configFp({ s: jEnum('a') }))).toEqual([
      {
        schema: 's',
        kind: 'breaking',
        detail: 'type narrowed/retyped/constrained',
      },
    ]);
    expect(
      diffConfigFingerprints(base, configFp({ s: jEnum('a', 'b', 'c') })),
    ).toEqual([{ schema: 's', kind: 'safe', detail: 'widened' }]);
  });
});
