import type { SchemaTreeSchema } from '../../../data/infer-schema';

/**
 * A value's shape held against the shape it should have — a step's output
 * against the type the analysis expects, a run's input against its inputs
 * schema: which fields the expected shape does not name, which required
 * ones are not there, which hold another kind of value, which are not
 * always there. Fields the expected shape leaves undeclared are not judged:
 * a shape of "anything" never reads as a difference.
 */

export type ShapeMark = 'added' | 'removed' | 'type-changed' | 'optional';

export interface ShapeComparison {
  /** The shape to draw: the actual one, with the required fields it lacks
   *  added from the expected shape (marked `removed`). */
  schema: SchemaTreeSchema;
  /** Marks by field path (property names from the top; a list's items are
   *  transparent, as `SchemaTree` lists them), keyed by `shapePathKey`. */
  marks: ReadonlyMap<string, ShapeMark>;
  /** How many fields differ from the expected shape. */
  differing: number;
}

/** The key of a field path in `ShapeComparison.marks`. */
export function shapePathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

function typesOf(schema: SchemaTreeSchema): string[] {
  if (schema.type === undefined) {
    if (schema.properties !== undefined) return ['object'];
    if (schema.items !== undefined) return ['array'];
    return [];
  }
  return typeof schema.type === 'string' ? [schema.type] : [...schema.type];
}

function enumType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

/** Whether a value of JSON type `type` fits `expected`. */
function accepts(expected: SchemaTreeSchema, type: string): boolean {
  if (expected.anyOf !== undefined && expected.anyOf.length > 0) {
    return expected.anyOf.some((option) => accepts(option, type));
  }
  if (expected.enum !== undefined && expected.enum.length > 0) {
    return expected.enum.some((value) => {
      const kind = enumType(value);
      return kind === type || (kind === 'integer' && type === 'number');
    });
  }
  const types = typesOf(expected);
  if (types.length === 0) return true;
  return (
    types.includes(type) || (type === 'integer' && types.includes('number'))
  );
}

/** Whether every kind `actual` was seen holding fits `expected`. */
function fits(expected: SchemaTreeSchema, actual: SchemaTreeSchema): boolean {
  return typesOf(actual).every((type) => accepts(expected, type));
}

/** The fields under a shape: its own, or those of its items. */
function fieldsOf(schema: SchemaTreeSchema): {
  properties: Readonly<Record<string, SchemaTreeSchema>>;
  required: readonly string[];
  inItems: boolean;
} | null {
  if (schema.properties !== undefined) {
    return {
      properties: schema.properties,
      required: schema.required ?? [],
      inItems: false,
    };
  }
  if (schema.items?.properties !== undefined) {
    return {
      properties: schema.items.properties,
      required: schema.items.required ?? [],
      inItems: true,
    };
  }
  return null;
}

/** Set `key` on `target` as its own field, `__proto__` included. */
function setOwn(
  target: Record<string, SchemaTreeSchema>,
  key: string,
  value: SchemaTreeSchema,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export function compareShape(
  expected: SchemaTreeSchema,
  actual: SchemaTreeSchema,
): ShapeComparison {
  const marks = new Map<string, ShapeMark>();
  const mark = (path: readonly string[], kind: ShapeMark) => {
    marks.set(shapePathKey(path), kind);
  };

  const walk = (
    want: SchemaTreeSchema,
    have: SchemaTreeSchema,
    path: readonly string[],
  ): SchemaTreeSchema => {
    if (!fits(want, have)) {
      mark(path, 'type-changed');
      return have;
    }
    const wanted = fieldsOf(want);
    const held = fieldsOf(have);
    if (
      wanted === null ||
      held === null ||
      Object.keys(wanted.properties).length === 0
    ) {
      return have;
    }
    const properties: Record<string, SchemaTreeSchema> = {};
    const required = [...held.required];
    for (const [name, field] of Object.entries(held.properties)) {
      const fieldPath = [...path, name];
      const wantedField = Object.hasOwn(wanted.properties, name)
        ? wanted.properties[name]
        : undefined;
      if (wantedField === undefined) {
        mark(fieldPath, 'added');
        setOwn(properties, name, field);
        continue;
      }
      if (wanted.required.includes(name) && field['x-count'] !== undefined) {
        mark(fieldPath, 'optional');
      }
      setOwn(properties, name, walk(wantedField, field, fieldPath));
    }
    for (const [name, wantedField] of Object.entries(wanted.properties)) {
      if (
        Object.hasOwn(held.properties, name) ||
        !wanted.required.includes(name)
      ) {
        continue;
      }
      mark([...path, name], 'removed');
      setOwn(properties, name, wantedField);
      required.push(name);
    }
    if (!held.inItems) return { ...have, properties, required };
    return { ...have, items: { ...have.items, properties, required } };
  };

  const schema = walk(expected, actual, []);
  return { schema, marks, differing: marks.size };
}
