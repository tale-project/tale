/**
 * Shapes: what the analysis knows about a value an automation computes — a
 * node's output, the run input, an expression's result.
 *
 * A shape is a normalized subset of JSON Schema, so it serializes unchanged
 * as the `types` an agent or editor reads: `type`, `properties`/`required`/
 * `additionalProperties`, `items`, a flat `anyOf` for unions, `enum`/`const`
 * for literals. `x-origin` says where it came from (a declared schema, a
 * connector's output signature, inference over code, an engine envelope, a
 * child automation).
 *
 * The empty shape `{}` is UNKNOWN: anything at all. Every question asked of
 * an unknown shape answers "cannot tell", and the rules built on these
 * answers stay silent — an analysis that guesses would warn about correct
 * documents.
 *
 * Shapes are immutable: every function here returns new objects and never
 * edits its arguments.
 */

import { stableStringify } from '../../../shared/utils/stable-stringify';
import type { Json } from '../types';

export type ShapeType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null';

export type ShapeOrigin =
  | 'declared'
  | 'signature'
  | 'inferred'
  | 'fixed'
  | 'child';

export interface Shape {
  type?: ShapeType;
  properties?: Record<string, Shape>;
  required?: string[];
  /** `false`: closed. A shape: the value of every other key (a record).
   * `true` or absent: open — except that an object from a signature, from
   * inference or from an engine envelope is exact (see `isClosed`). */
  additionalProperties?: boolean | Shape;
  items?: Shape;
  /** A union: flat (never nested) and never beside `type`. */
  anyOf?: Shape[];
  enum?: Json[];
  const?: Json;
  description?: string;
  /** Where the shape came from — it words a finding, it never decides one. */
  'x-origin'?: ShapeOrigin;
}

/** Anything at all; suppresses every diagnostic. */
export const UNKNOWN: Shape = Object.freeze({});

export const NULL_SHAPE: Shape = Object.freeze({ type: 'null' });
export const STRING_SHAPE: Shape = Object.freeze({ type: 'string' });
export const NUMBER_SHAPE: Shape = Object.freeze({ type: 'number' });
export const BOOLEAN_SHAPE: Shape = Object.freeze({ type: 'boolean' });

export type Nullability = 'never' | 'maybe' | 'always';

/** The JSON kinds a value can have; `integer` reads as `number`. */
export type Kind =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null';

/** Unions wider than this say nothing useful; they collapse to UNKNOWN. */
export const MAX_UNION_MEMBERS = 12;

/** Origins whose objects list every key they can have. */
const CLOSED_ORIGINS: ReadonlySet<ShapeOrigin | undefined> = new Set([
  'signature',
  'inferred',
  'fixed',
]);

/** Members of every array, string, number or object a chain may read or
 * call without naming a field of the data. */
const ARRAY_MEMBERS: ReadonlySet<string> = new Set([
  'at',
  'concat',
  'copyWithin',
  'entries',
  'every',
  'fill',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flat',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'keys',
  'lastIndexOf',
  'map',
  'pop',
  'push',
  'reduce',
  'reduceRight',
  'reverse',
  'shift',
  'slice',
  'some',
  'sort',
  'splice',
  'toLocaleString',
  'toReversed',
  'toSorted',
  'toSpliced',
  'toString',
  'unshift',
  'values',
  'with',
]);

const STRING_MEMBERS: ReadonlySet<string> = new Set([
  'at',
  'charAt',
  'charCodeAt',
  'codePointAt',
  'concat',
  'endsWith',
  'includes',
  'indexOf',
  'lastIndexOf',
  'localeCompare',
  'match',
  'matchAll',
  'normalize',
  'padEnd',
  'padStart',
  'repeat',
  'replace',
  'replaceAll',
  'search',
  'slice',
  'split',
  'startsWith',
  'substring',
  'substr',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
  'toLowerCase',
  'toString',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimStart',
  'valueOf',
]);

const PRIMITIVE_MEMBERS: ReadonlySet<string> = new Set([
  'toExponential',
  'toFixed',
  'toLocaleString',
  'toPrecision',
  'toString',
  'valueOf',
]);

const OBJECT_MEMBERS: ReadonlySet<string> = new Set([
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
]);

export type Lookup =
  | {
      kind: 'found';
      shape: Shape;
      /** The member may be absent (an optional property, a record entry). */
      optional: boolean;
    }
  | {
      kind: 'missing';
      /** The base lists every key it can have, so the member cannot exist;
       * otherwise it is merely not declared. */
      closed: boolean;
      /** The keys the base declares. */
      known: string[];
    }
  | { kind: 'unknown' };

const UNKNOWN_LOOKUP: Lookup = Object.freeze({ kind: 'unknown' });

/** Whether `s` says nothing about the value. */
export function isUnknown(s: Shape): boolean {
  return (
    s.type === undefined &&
    s.anyOf === undefined &&
    s.enum === undefined &&
    s.const === undefined &&
    s.properties === undefined &&
    s.items === undefined &&
    s.additionalProperties === undefined
  );
}

/** The members of a union, or the shape itself. */
export function membersOf(s: Shape): readonly Shape[] {
  return s.anyOf ?? [s];
}

function jsonKind(v: unknown): Kind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  switch (typeof v) {
    case 'string':
      return 'string';
    case 'number':
    case 'bigint':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

/** The JSON kinds `s` admits; `null` when it admits anything. */
export function kindsOf(s: Shape): ReadonlySet<Kind> | null {
  if (s.anyOf !== undefined) {
    const out = new Set<Kind>();
    for (const m of s.anyOf) {
      const k = kindsOf(m);
      if (k === null) return null;
      for (const x of k) out.add(x);
    }
    return out;
  }
  if (s.type !== undefined) {
    return new Set([s.type === 'integer' ? 'number' : s.type]);
  }
  if (s.const !== undefined) return new Set([jsonKind(s.const)]);
  if (s.enum !== undefined) return new Set(s.enum.map(jsonKind));
  if (s.properties !== undefined || s.additionalProperties !== undefined) {
    return new Set(['object']);
  }
  if (s.items !== undefined) return new Set(['array']);
  return null;
}

function isNullOnly(s: Shape): boolean {
  if (s.anyOf !== undefined) return s.anyOf.every(isNullOnly);
  if (s.type === 'null' || s.const === null) return true;
  return s.enum !== undefined && s.enum.every((v) => v === null);
}

/**
 * Whether an object shape lists every key it can have: `additionalProperties:
 * false`, or no word on extra keys from a source that is exact (a TS object
 * type, a return literal, an engine envelope).
 */
export function isClosed(s: Shape): boolean {
  if (s.additionalProperties === false) return true;
  return (
    s.additionalProperties === undefined && CLOSED_ORIGINS.has(s['x-origin'])
  );
}

function isIndexKey(key: string | number): boolean {
  return typeof key === 'number' || /^(?:0|[1-9]\d*)$/.test(key);
}

function lookupObject(s: Shape, key: string): Lookup {
  const props = s.properties ?? {};
  if (Object.hasOwn(props, key)) {
    return {
      kind: 'found',
      shape: props[key],
      optional: !(s.required ?? []).includes(key),
    };
  }
  if (typeof s.additionalProperties === 'object') {
    return { kind: 'found', shape: s.additionalProperties, optional: true };
  }
  if (OBJECT_MEMBERS.has(key)) {
    return { kind: 'found', shape: UNKNOWN, optional: false };
  }
  const known = Object.keys(props);
  const closed = isClosed(s);
  // An open object that declares nothing (`object`, `{type: object}`) is a
  // bag of anything — no key of it is a finding.
  if (!closed && known.length === 0) return UNKNOWN_LOOKUP;
  return { kind: 'missing', closed, known };
}

/**
 * Read member `key` of a value of shape `s`.
 *
 * A union answers for the members that can hold a value: `null` members are
 * left out (reading through a value that may be null is the flow rules'
 * concern, not a missing field), a key some members have is found and
 * optional, and a key no member has is missing.
 */
export function lookup(s: Shape, key: string | number): Lookup {
  if (s.anyOf !== undefined) {
    const results = s.anyOf
      .filter((m) => !isNullOnly(m))
      .map((m) => lookup(m, key));
    if (results.length === 0) return UNKNOWN_LOOKUP;
    const found: Shape[] = [];
    let optional = false;
    let closed = true;
    const known = new Set<string>();
    for (const r of results) {
      if (r.kind === 'unknown') return UNKNOWN_LOOKUP;
      if (r.kind === 'found') {
        found.push(r.shape);
        optional ||= r.optional;
      } else {
        optional = true;
        closed &&= r.closed;
        for (const k of r.known) known.add(k);
      }
    }
    if (found.length === 0)
      return { kind: 'missing', closed, known: [...known] };
    return { kind: 'found', shape: union(...found), optional };
  }
  if (s.type === undefined && s.const !== undefined) {
    return lookup(shapeOfValue(s.const), key);
  }
  const kinds = kindsOf(s);
  if (kinds === null || kinds.size !== 1) return UNKNOWN_LOOKUP;
  const [kind] = kinds;
  const k = String(key);
  switch (kind) {
    case 'object':
      return lookupObject(s, k);
    case 'array':
      if (isIndexKey(key)) {
        return { kind: 'found', shape: elementOf(s), optional: false };
      }
      if (k === 'length') {
        return { kind: 'found', shape: NUMBER_SHAPE, optional: false };
      }
      if (ARRAY_MEMBERS.has(k)) {
        return { kind: 'found', shape: UNKNOWN, optional: false };
      }
      return { kind: 'missing', closed: true, known: [] };
    case 'string':
      if (isIndexKey(key)) {
        return { kind: 'found', shape: STRING_SHAPE, optional: false };
      }
      if (k === 'length') {
        return { kind: 'found', shape: NUMBER_SHAPE, optional: false };
      }
      if (STRING_MEMBERS.has(k)) {
        return { kind: 'found', shape: UNKNOWN, optional: false };
      }
      return { kind: 'missing', closed: true, known: [] };
    case 'number':
    case 'boolean':
      if (PRIMITIVE_MEMBERS.has(k)) {
        return { kind: 'found', shape: UNKNOWN, optional: false };
      }
      return { kind: 'missing', closed: true, known: [] };
    default:
      return UNKNOWN_LOOKUP;
  }
}

export type PathWalk =
  | {
      kind: 'found';
      shape: Shape;
      /** Some step read a member that may be absent. */
      optional: boolean;
    }
  | {
      kind: 'missing';
      /** The index of the step that names a member the base lacks. */
      at: number;
      /** The shape of the value that step reads from. */
      base: Shape;
      closed: boolean;
      known: string[];
    }
  | {
      kind: 'unknown';
      /** The first step whose base says nothing. */
      at: number;
    };

/** Follow a member chain (`items`, `0`, `title`) from `root`, stopping at
 * the first step that is missing or unknowable. */
export function walkPath(
  root: Shape,
  steps: ReadonlyArray<{ key: string | number }>,
): PathWalk {
  let shape = root;
  let optional = false;
  for (const [at, step] of steps.entries()) {
    if (isUnknown(shape)) return { kind: 'unknown', at };
    const r = lookup(shape, step.key);
    if (r.kind === 'unknown') return { kind: 'unknown', at };
    if (r.kind === 'missing') {
      return {
        kind: 'missing',
        at,
        base: shape,
        closed: r.closed,
        known: r.known,
      };
    }
    optional ||= r.optional;
    shape = r.shape;
  }
  return { kind: 'found', shape, optional };
}

/** The shape of one element of a list (`forEach` items, `arr[i]`). */
export function elementOf(s: Shape): Shape {
  if (s.anyOf !== undefined) {
    const parts: Shape[] = [];
    for (const m of s.anyOf) {
      if (isNullOnly(m)) continue;
      if (isUnknown(m)) return UNKNOWN;
      parts.push(elementOf(m));
    }
    return parts.length === 0 ? UNKNOWN : union(...parts);
  }
  if (s.type === 'array') return s.items ?? UNKNOWN;
  return UNKNOWN;
}

function isLiteral(s: Shape): boolean {
  return s.const !== undefined || s.enum !== undefined;
}

/** A primitive member that carries nothing but its type. */
function isPlain(s: Shape): boolean {
  return (
    s.type !== undefined &&
    s.type !== 'object' &&
    s.type !== 'array' &&
    !isLiteral(s)
  );
}

function literalValues(s: Shape): Json[] | undefined {
  if (s.const !== undefined) return [s.const];
  return s.enum;
}

/** The identity of a member for de-duplication: its structure and origin,
 * not its description. */
function memberKey(s: Shape): string {
  const { description: _description, ...rest } = s;
  return stableStringify(rest);
}

/**
 * The union of shapes: flattened, de-duplicated, literals of one type merged
 * into an `enum` (and absorbed by the plain type when it is present),
 * `integer` absorbed by `number`. Any unknown member makes the whole union
 * unknown, and so does a union wider than {@link MAX_UNION_MEMBERS}.
 */
export function union(...xs: Shape[]): Shape {
  const flat: Shape[] = [];
  for (const x of xs) {
    if (isUnknown(x)) return UNKNOWN;
    flat.push(...membersOf(x));
  }
  const plainTypes = new Set(flat.filter(isPlain).map((m) => m.type));
  if (plainTypes.has('number')) plainTypes.add('integer');
  const literals = new Map<ShapeType | undefined, Json[]>();
  const seen = new Set<string>();
  const out: Shape[] = [];
  for (const m of flat) {
    if (m.type === 'integer' && plainTypes.has('number') && !isLiteral(m)) {
      continue;
    }
    if (isLiteral(m) && m.type !== undefined && m.type !== 'null') {
      if (plainTypes.has(m.type)) continue;
      if (m.type !== 'object' && m.type !== 'array') {
        const values = literals.get(m.type);
        if (values === undefined) {
          literals.set(m.type, [...(literalValues(m) ?? [])]);
          out.push(m);
        } else {
          values.push(...(literalValues(m) ?? []));
        }
        continue;
      }
    }
    const key = memberKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  const merged: Shape[] = [];
  for (const m of out) {
    const values =
      isLiteral(m) && m.type !== undefined ? literals.get(m.type) : undefined;
    if (values === undefined) {
      merged.push(m);
      continue;
    }
    const unique: Json[] = [];
    const keys = new Set<string>();
    for (const v of values) {
      const k = stableStringify(v);
      if (keys.has(k)) continue;
      keys.add(k);
      unique.push(v);
    }
    const { const: _const, enum: _enum, ...rest } = m;
    merged.push(
      unique.length === 1
        ? { ...rest, const: unique[0] }
        : { ...rest, enum: unique },
    );
  }
  if (merged.length === 0) return UNKNOWN;
  if (merged.length === 1) return merged[0];
  if (merged.length > MAX_UNION_MEMBERS) return UNKNOWN;
  return { anyOf: merged };
}

/** `s`, or null. */
export function withNull(s: Shape): Shape {
  return union(s, NULL_SHAPE);
}

/** `s` without its null members; `null` when nothing else is left. */
export function withoutNull(s: Shape): Shape | null {
  if (isUnknown(s)) return s;
  const rest = membersOf(s).filter((m) => !isNullOnly(m));
  if (rest.length === 0) return null;
  return rest.length === 1 ? rest[0] : union(...rest);
}

/**
 * Whether a value of shape `s` can be null (or absent). An unknown shape
 * answers `never`: no finding is built on what the analysis does not know.
 */
export function nullability(s: Shape): Nullability {
  if (isUnknown(s)) return 'never';
  const ms = membersOf(s);
  const nulls = ms.filter(isNullOnly).length;
  if (nulls === 0) return 'never';
  return nulls === ms.length ? 'always' : 'maybe';
}

/** Drop the literal value of primitive members: `"open"` → `string`. */
export function widen(s: Shape): Shape {
  if (s.anyOf !== undefined) return union(...s.anyOf.map(widen));
  if (!isLiteral(s) || s.type === undefined) return s;
  if (s.type === 'object' || s.type === 'array' || s.type === 'null') {
    return s;
  }
  const { const: _const, enum: _enum, ...rest } = s;
  return rest;
}

/**
 * The shape of a literal JSON value, widened: `"open"` is `string`, an
 * object lists exactly its keys (all required), an array's items are the
 * union of its elements.
 */
export function shapeOfValue(v: unknown, depth = 0): Shape {
  if (depth > 16) return UNKNOWN;
  if (v === null) return NULL_SHAPE;
  switch (typeof v) {
    case 'string':
      return STRING_SHAPE;
    case 'number':
      return NUMBER_SHAPE;
    case 'boolean':
      return BOOLEAN_SHAPE;
    case 'object':
      break;
    default:
      return UNKNOWN;
  }
  if (Array.isArray(v)) {
    return v.length === 0
      ? { type: 'array', 'x-origin': 'inferred' }
      : {
          type: 'array',
          items: union(...v.map((e: unknown) => shapeOfValue(e, depth + 1))),
          'x-origin': 'inferred',
        };
  }
  const entries = Object.entries(v);
  return {
    type: 'object',
    properties: Object.fromEntries(
      entries.map(([k, e]) => [k, shapeOfValue(e, depth + 1)]),
    ),
    required: entries.map(([k]) => k),
    'x-origin': 'inferred',
  };
}

/** A definite incompatibility, and where inside the value it is. */
export interface Mismatch {
  expected: string;
  actual: string;
  /** The member chain from the compared value to the mismatch; an array's
   * items are `'*'`. Empty when the values themselves differ. */
  path: Array<string | number>;
}

function disjoint(a: ReadonlySet<Kind>, b: ReadonlySet<Kind>): boolean {
  for (const k of a) if (b.has(k)) return false;
  return true;
}

function memberMismatch(
  src: Shape,
  target: Shape,
  path: Array<string | number>,
  depth: number,
): Mismatch | null {
  const ks = kindsOf(src);
  const kt = kindsOf(target);
  if (ks === null || kt === null) return null;
  if (disjoint(ks, kt)) {
    return { expected: toTs(target), actual: toTs(src), path };
  }
  const sv = literalValues(src);
  const tv = literalValues(target);
  if (sv !== undefined && tv !== undefined) {
    const allowed = new Set(tv.map((v) => stableStringify(v)));
    if (!sv.some((v) => allowed.has(stableStringify(v)))) {
      return { expected: toTs(target), actual: toTs(src), path };
    }
  }
  if (ks.size !== 1 || kt.size !== 1) return null;
  if (ks.has('object') && kt.has('object')) {
    for (const [key, want] of Object.entries(target.properties ?? {})) {
      const got = lookup(src, key);
      const at = [...path, key];
      if (got.kind === 'missing' && got.closed) {
        if ((target.required ?? []).includes(key)) {
          return { expected: toTs(want), actual: 'undefined', path: at };
        }
        continue;
      }
      if (got.kind === 'found' && !got.optional) {
        const inner = mismatchAt(got.shape, want, at, depth + 1);
        if (inner !== null) return inner;
      }
    }
    if (target.additionalProperties === false && isClosed(src)) {
      const declared = target.properties ?? {};
      const extra = Object.keys(src.properties ?? {}).find(
        (k) => !Object.hasOwn(declared, k),
      );
      if (extra !== undefined) {
        return {
          expected: 'undefined',
          actual: toTs((src.properties ?? {})[extra] ?? UNKNOWN),
          path: [...path, extra],
        };
      }
    }
    return null;
  }
  if (ks.has('array') && kt.has('array')) {
    if (src.items === undefined || target.items === undefined) return null;
    return mismatchAt(src.items, target.items, [...path, '*'], depth + 1);
  }
  return null;
}

function mismatchAt(
  src: Shape,
  target: Shape,
  path: Array<string | number>,
  depth: number,
): Mismatch | null {
  if (depth > 8 || isUnknown(src) || isUnknown(target)) return null;
  const sources = membersOf(src);
  const targets = membersOf(target);
  let first: Mismatch | null = null;
  for (const s of sources) {
    for (const t of targets) {
      const m = memberMismatch(s, t, path, depth);
      if (m === null) return null;
      first ??= m;
    }
  }
  if (sources.length === 1 && targets.length === 1) return first;
  return { expected: toTs(target), actual: toTs(src), path };
}

/**
 * A DEFINITE incompatibility between a value of shape `src` and the shape
 * `target` a consumer wants — every form `src` can take is refused. Anything
 * unknown, open or overlapping answers `null`: a warning is only worth
 * raising when the run is sure to go wrong.
 */
export function assignable(src: Shape, target: Shape): Mismatch | null {
  return mismatchAt(src, target, [], 0);
}

/** `'yes'` when every form of `s` is a list, `'no'` when none is, else
 * `'unknown'`. */
export function isArrayLike(s: Shape): 'yes' | 'no' | 'unknown' {
  const kinds = kindsOf(s);
  if (kinds === null) return 'unknown';
  if (!kinds.has('array')) return 'no';
  return kinds.size === 1 ? 'yes' : 'unknown';
}

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const MAX_TS_PROPERTIES = 12;

/**
 * A shape as a TypeScript type, the notation authors and agents already
 * read: `{ count: number, issues: Array<{ title: string }> }`. Objects nest
 * `depth` levels deep, then read `{…}`.
 */
export function toTs(s: Shape, depth = 3): string {
  if (isUnknown(s)) return 'unknown';
  if (s.anyOf !== undefined) {
    return s.anyOf.map((m) => toTs(m, depth)).join(' | ');
  }
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum !== undefined) {
    return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  }
  switch (s.type) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
      return s.type;
    case 'integer':
      return 'number';
    case 'array':
      return `Array<${s.items === undefined ? 'unknown' : toTs(s.items, depth)}>`;
    case undefined:
    case 'object':
      break;
  }
  const entries = Object.entries(s.properties ?? {});
  if (entries.length === 0) {
    return typeof s.additionalProperties === 'object'
      ? `Record<string, ${toTs(s.additionalProperties, depth - 1)}>`
      : 'object';
  }
  if (depth <= 0) return '{…}';
  const required = new Set(s.required ?? []);
  const shown = entries.slice(0, MAX_TS_PROPERTIES).map(([k, v]) => {
    const name = IDENTIFIER_RE.test(k) ? k : JSON.stringify(k);
    return `${name}${required.has(k) ? '' : '?'}: ${toTs(v, depth - 1)}`;
  });
  if (entries.length > MAX_TS_PROPERTIES) shown.push('…');
  return `{ ${shown.join(', ')} }`;
}
