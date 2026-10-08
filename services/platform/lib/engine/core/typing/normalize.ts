/**
 * JSON Schema → Shape: the run input (`inputs`), an llm node's
 * `outputSchema`, a child automation's `inputs` — every schema an author
 * declares, read for what KIND of value it describes.
 *
 * Kinds, not values: `format`, `pattern`, `minimum` and the other value
 * keywords are dropped, because Ajv judges literal values and the typing
 * layer judges what an expression can produce. Pure — no Ajv, which cannot
 * compile under the editor's Content-Security-Policy.
 *
 *  - `type: [a, b]` and OpenAPI `nullable: true` become unions;
 *  - `anyOf`/`oneOf` become one flat union (sibling keywords distributed into
 *    each branch); `allOf` merges when every part is an object, else the
 *    shape is unknown;
 *  - local `$ref`s (`#/$defs/x`, `#/definitions/x`) resolve, five deep;
 *    other references are unknown;
 *  - `prefixItems` (and draft-4 tuple `items`) become the union of their
 *    items;
 *  - nesting stops at depth 8 and an object keeps its first 200
 *    properties — the rest leaves it open.
 */

import { isRecord } from '../../../utils/type-utils';
import type { Json } from '../types';
import {
  isUnknown,
  NULL_SHAPE,
  UNKNOWN,
  union,
  withNull,
  type Shape,
  type ShapeOrigin,
  type ShapeType,
} from './shape';

const MAX_DEPTH = 8;
const MAX_REF_DEPTH = 5;
const MAX_PROPERTIES = 200;

const TYPES: ReadonlySet<string> = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

/** Keywords that say what kind of value a schema holds — a branch of
 * `anyOf` that carries none of them only narrows its siblings. */
const STRUCTURAL = [
  'type',
  'properties',
  'additionalProperties',
  'items',
  'prefixItems',
  'enum',
  'const',
  '$ref',
  'required',
  'nullable',
] as const;

interface Cx {
  root: Record<string, unknown>;
  origin: ShapeOrigin;
}

function isJson(v: unknown, depth = 0): v is Json {
  if (depth > 32) return false;
  if (v === null) return true;
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(v);
    case 'object':
      return Array.isArray(v)
        ? v.every((e) => isJson(e, depth + 1))
        : Object.values(v).every((e) => isJson(e, depth + 1));
    default:
      return false;
  }
}

function typeOfJson(v: Json): ShapeType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  switch (typeof v) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

function resolveRef(
  root: Record<string, unknown>,
  ref: string,
): Record<string, unknown> | undefined {
  const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
  if (m === null) return undefined;
  const defs = root[m[1]];
  if (!isRecord(defs)) return undefined;
  const name = m[2].replaceAll('~1', '/').replaceAll('~0', '~');
  if (!Object.hasOwn(defs, name)) return undefined;
  const target = defs[name];
  return isRecord(target) ? target : undefined;
}

function omit(
  s: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(s).filter(([k]) => !keys.includes(k)),
  );
}

/** Two schemas that must both hold, as one: properties merged, `required`
 * concatenated, other keywords from `b` over `a`. */
function mergeSchemas(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a, ...b };
  if (isRecord(a.properties) && isRecord(b.properties)) {
    out.properties = { ...a.properties, ...b.properties };
  }
  const required = [
    ...(Array.isArray(a.required) ? a.required : []),
    ...(Array.isArray(b.required) ? b.required : []),
  ];
  if (required.length > 0) out.required = [...new Set(required)];
  return out;
}

function hasStructure(s: Record<string, unknown>): boolean {
  return STRUCTURAL.some((k) => s[k] !== undefined);
}

function isObjectSchema(s: Record<string, unknown>): boolean {
  return (
    s.type === 'object' ||
    (s.type === undefined &&
      (isRecord(s.properties) || s.additionalProperties !== undefined))
  );
}

function objectShape(
  s: Record<string, unknown>,
  cx: Cx,
  depth: number,
  refDepth: number,
): Shape {
  const props = isRecord(s.properties) ? Object.entries(s.properties) : [];
  const kept = props.slice(0, MAX_PROPERTIES);
  const out: Shape = { type: 'object', 'x-origin': cx.origin };
  if (kept.length > 0) {
    out.properties = Object.fromEntries(
      kept.map(([k, v]) => [k, norm(v, cx, depth + 1, refDepth)]),
    );
  }
  const required = Array.isArray(s.required)
    ? s.required.filter((r): r is string => typeof r === 'string')
    : [];
  if (required.length > 0) out.required = [...new Set(required)];
  const patterned =
    isRecord(s.patternProperties) &&
    Object.keys(s.patternProperties).length > 0;
  if (props.length > MAX_PROPERTIES || patterned) {
    out.additionalProperties = true;
  } else if (s.additionalProperties === false) {
    out.additionalProperties = false;
  } else if (isRecord(s.additionalProperties)) {
    out.additionalProperties = norm(
      s.additionalProperties,
      cx,
      depth + 1,
      refDepth,
    );
  }
  return out;
}

function arrayShape(
  s: Record<string, unknown>,
  cx: Cx,
  depth: number,
  refDepth: number,
): Shape {
  const out: Shape = { type: 'array', 'x-origin': cx.origin };
  const parts: unknown[] = [];
  if (Array.isArray(s.prefixItems)) parts.push(...s.prefixItems);
  if (Array.isArray(s.items)) parts.push(...s.items);
  else if (isRecord(s.items)) parts.push(s.items);
  if (parts.length > 0) {
    out.items = union(...parts.map((p) => norm(p, cx, depth + 1, refDepth)));
  }
  return out;
}

function typedShape(
  s: Record<string, unknown>,
  type: ShapeType,
  cx: Cx,
  depth: number,
  refDepth: number,
): Shape {
  let out: Shape;
  if (type === 'object') out = objectShape(s, cx, depth, refDepth);
  else if (type === 'array') out = arrayShape(s, cx, depth, refDepth);
  else if (type === 'null') return NULL_SHAPE;
  else out = { type };
  if (isJson(s.const)) {
    out.const = s.const;
  } else if (Array.isArray(s.enum)) {
    const values = s.enum.filter(
      (v): v is Json =>
        isJson(v) && typeOfJson(v) === (type === 'integer' ? 'number' : type),
    );
    if (values.length > 0) out.enum = values;
  }
  if (typeof s.description === 'string') out.description = s.description;
  return out;
}

function inferredType(s: Record<string, unknown>): ShapeType | undefined {
  if (isObjectSchema(s) || Array.isArray(s.required)) return 'object';
  if (s.items !== undefined || Array.isArray(s.prefixItems)) return 'array';
  if (isJson(s.const)) return typeOfJson(s.const);
  if (
    Array.isArray(s.enum) &&
    s.enum.length > 0 &&
    s.enum.every((v) => isJson(v))
  ) {
    const kinds = new Set(s.enum.map((v: Json) => typeOfJson(v)));
    if (kinds.size === 1) {
      const [only] = kinds;
      return only;
    }
  }
  return undefined;
}

function norm(raw: unknown, cx: Cx, depth: number, refDepth: number): Shape {
  if (depth > MAX_DEPTH || !isRecord(raw)) return UNKNOWN;
  if (typeof raw.$ref === 'string') {
    if (refDepth >= MAX_REF_DEPTH) return UNKNOWN;
    const target = resolveRef(cx.root, raw.$ref);
    if (target === undefined) return UNKNOWN;
    const rest = omit(raw, ['$ref', '$defs', 'definitions']);
    const merged = hasStructure(rest) ? mergeSchemas(target, rest) : target;
    return norm(merged, cx, depth + 1, refDepth + 1);
  }
  const variants = Array.isArray(raw.anyOf)
    ? raw.anyOf
    : Array.isArray(raw.oneOf)
      ? raw.oneOf
      : undefined;
  if (variants !== undefined && variants.length > 0) {
    const base = omit(raw, ['anyOf', 'oneOf', 'description']);
    const distribute = hasStructure(base);
    const branches = variants.map((v: unknown) =>
      norm(
        distribute && isRecord(v) ? mergeSchemas(base, v) : v,
        cx,
        depth + 1,
        refDepth,
      ),
    );
    // Branches that only narrow their siblings (`{required: [a]}`) say
    // nothing about the kind; the base alone does.
    if (distribute && branches.every(isUnknown)) {
      return norm(base, cx, depth + 1, refDepth);
    }
    return union(...branches);
  }
  if (Array.isArray(raw.allOf) && raw.allOf.length > 0) {
    const base = omit(raw, ['allOf']);
    const parts: Record<string, unknown>[] = hasStructure(base) ? [base] : [];
    for (const part of raw.allOf) {
      if (!isRecord(part)) return UNKNOWN;
      const resolved =
        typeof part.$ref === 'string' ? resolveRef(cx.root, part.$ref) : part;
      if (resolved === undefined || !isObjectSchema(resolved)) return UNKNOWN;
      parts.push(resolved);
    }
    if (!parts.every(isObjectSchema)) return UNKNOWN;
    const merged = parts.reduce(mergeSchemas);
    return norm(merged, cx, depth + 1, refDepth);
  }

  let shape: Shape;
  if (Array.isArray(raw.type)) {
    const types = raw.type.filter(
      (t): t is ShapeType => typeof t === 'string' && TYPES.has(t),
    );
    if (types.length === 0) return UNKNOWN;
    shape = union(...types.map((t) => typedShape(raw, t, cx, depth, refDepth)));
  } else if (typeof raw.type === 'string') {
    if (!TYPES.has(raw.type)) return UNKNOWN;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TYPES holds exactly the ShapeType names
    shape = typedShape(raw, raw.type as ShapeType, cx, depth, refDepth);
  } else {
    const inferred = inferredType(raw);
    if (inferred === undefined) {
      if (Array.isArray(raw.enum)) {
        const values = raw.enum.filter((v): v is Json => isJson(v));
        shape = values.length > 0 ? { enum: values } : UNKNOWN;
      } else {
        shape = UNKNOWN;
      }
    } else {
      shape = typedShape(raw, inferred, cx, depth, refDepth);
    }
  }
  return raw.nullable === true ? withNull(shape) : shape;
}

/**
 * The shape a JSON Schema describes. Anything the schema leaves open — no
 * `type`, an external `$ref`, a non-object schema — is UNKNOWN, never a
 * guess.
 */
export function normalizeSchema(
  schema: unknown,
  origin: ShapeOrigin = 'declared',
): Shape {
  if (!isRecord(schema)) return UNKNOWN;
  return norm(schema, { root: schema, origin }, 0, 0);
}
