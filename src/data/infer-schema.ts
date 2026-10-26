/**
 * The shape of a value as a JSON Schema subset: what a reader needs to see
 * the fields a step received or returned, without the values. Lists are
 * read from their first items; objects read in several items merge, and a
 * field some of them lack is optional, with how often it was there.
 */

import { jsonNormalize } from './stable-stringify';

/** A JSON Schema subset: what describes the fields of a value. */
export interface SchemaTreeSchema {
  type?:
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'object'
    | 'array'
    | 'null'
    | ReadonlyArray<string>;
  properties?: Readonly<Record<string, SchemaTreeSchema>>;
  required?: readonly string[];
  items?: SchemaTreeSchema;
  enum?: readonly unknown[];
  anyOf?: readonly SchemaTreeSchema[];
  /** Written by the author; shown as is (document content, not translated). */
  description?: string;
  /** Inferred from several objects: in how many of them the field was
   *  present. Set only when it was missing from some. */
  'x-count'?: { present: number; of: number };
  /** Inferred: how many fields were left out of `properties` because the
   *  object had more than the reader keeps. */
  'x-omitted'?: number;
}

export interface InferSchemaOptions {
  /** How many items of a list are read: 100. */
  sampleItems?: number;
  /** How deep the shape goes; deeper values read as any value: 8. */
  maxDepth?: number;
  /** Fields kept per object, in the order they were first seen; the rest
   *  are counted in `x-omitted`: unlimited. */
  maxProperties?: number;
  /** Shapes kept in the whole tree; past it, values read as any value:
   *  unlimited. */
  maxNodes?: number;
}

/**
 * The shape of `value`, read as JSON: `undefined` has no shape (`{}`),
 * whole numbers are `integer`, a list's items merge into one shape. The
 * result describes the value: every value it was read from validates
 * against it, given lists no longer than `sampleItems`.
 */
export function inferSchema(
  value: unknown,
  options: InferSchemaOptions = {},
): SchemaTreeSchema {
  const limits = {
    sampleItems: options.sampleItems ?? 100,
    maxDepth: options.maxDepth ?? 8,
    maxProperties: options.maxProperties ?? Number.POSITIVE_INFINITY,
    nodesLeft: options.maxNodes ?? Number.POSITIVE_INFINITY,
  };
  return inferMany([jsonNormalize(value)], 0, limits);
}

interface Limits {
  sampleItems: number;
  maxDepth: number;
  maxProperties: number;
  /** Spent as shapes are made. */
  nodesLeft: number;
}

type SingleType = Exclude<SchemaTreeSchema['type'], ReadonlyArray<string>>;

/** The order a `type` list is written in. */
const TYPE_ORDER: readonly string[] = [
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return undefined;
  }
}

/**
 * One shape every value in `values` fits, read from the values themselves:
 * an object field is required when every object holds it, else it carries
 * how many did; a list's items are read together from every list.
 */
function inferMany(
  values: readonly unknown[],
  depth: number,
  limits: Limits,
): SchemaTreeSchema {
  const present = values.filter((value) => value !== undefined);
  if (
    depth > limits.maxDepth ||
    present.length === 0 ||
    limits.nodesLeft <= 0
  ) {
    return {};
  }
  limits.nodesLeft--;
  const types = new Set<string>();
  for (const value of present) {
    const type = typeOf(value);
    if (type !== undefined) types.add(type);
  }
  // A whole number also passes as a number; one type says both.
  if (types.has('number')) types.delete('integer');
  const ordered = TYPE_ORDER.filter((type) => types.has(type));
  const schema: {
    type?: SchemaTreeSchema['type'];
    properties?: Record<string, SchemaTreeSchema>;
    required?: string[];
    items?: SchemaTreeSchema;
    'x-omitted'?: number;
  } = { type: ordered.length === 1 ? singleType(ordered[0]) : ordered };
  const objects = present.filter(isRecord);
  if (objects.length > 0) {
    const keys = new Set<string>();
    for (const object of objects) {
      for (const key of Object.keys(object)) keys.add(key);
    }
    const properties: Record<string, SchemaTreeSchema> = {};
    const required: string[] = [];
    let kept = 0;
    for (const key of keys) {
      if (kept >= limits.maxProperties) break;
      kept++;
      const holders = objects.filter((object) => Object.hasOwn(object, key));
      const property = inferMany(
        holders.map((object) => object[key]),
        depth + 1,
        limits,
      );
      if (holders.length === objects.length) {
        required.push(key);
        setOwn(properties, key, property);
      } else {
        setOwn(properties, key, {
          ...property,
          'x-count': { present: holders.length, of: objects.length },
        });
      }
    }
    schema.properties = properties;
    schema.required = required;
    if (keys.size > kept) schema['x-omitted'] = keys.size - kept;
  }
  const items = present
    .filter((value): value is unknown[] => Array.isArray(value))
    .flatMap((list) => list.slice(0, limits.sampleItems));
  // A list read empty says nothing about its items.
  if (items.length > 0) schema.items = inferMany(items, depth + 1, limits);
  return schema;
}

function singleType(type: string | undefined): SingleType {
  switch (type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'object':
    case 'array':
    case 'null':
      return type;
    default:
      return undefined;
  }
}

/** Set `key` on `target` as its own field, `__proto__` included. */
function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
