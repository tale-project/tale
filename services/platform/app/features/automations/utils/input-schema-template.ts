/**
 * Build a JSON skeleton from a workflow start node's inputSchema. Used to
 * pre-fill the test panel so users see expected fields instead of an empty
 * object. Required fields are emitted with empty/zero defaults; optional
 * fields are emitted as `null` to make their existence visible without
 * implying a value.
 */

type SchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object';

interface NestedProperty {
  type: SchemaType;
  description?: string;
}

interface InputSchemaProperty {
  type: SchemaType;
  description?: string;
  items?: {
    type: SchemaType;
    properties?: Record<string, NestedProperty>;
    required?: string[];
  };
  properties?: Record<string, NestedProperty>;
  required?: string[];
}

interface InputSchema {
  properties: Record<string, InputSchemaProperty>;
  required?: string[];
}

function defaultForType(type: SchemaType): unknown {
  if (type === 'string') return '';
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;
  if (type === 'array') return [];
  return {};
}

function defaultForProperty(prop: InputSchemaProperty): unknown {
  if (prop.type === 'object' && prop.properties) {
    const obj: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(prop.properties)) {
      obj[key] = defaultForType(nested.type);
    }
    return obj;
  }
  return defaultForType(prop.type);
}

/**
 * Returns a stringified JSON object whose keys mirror the inputSchema:
 * required fields get type-appropriate defaults, optional fields get `null`.
 * Returns `'{}'` when the schema is missing or has no properties.
 */
export function buildInputTemplateFromSchema(
  schema: InputSchema | undefined,
): string {
  if (!schema || !schema.properties) return '{}';

  const required = new Set(schema.required ?? []);
  const template: Record<string, unknown> = {};

  for (const [key, prop] of Object.entries(schema.properties)) {
    template[key] = required.has(key) ? defaultForProperty(prop) : null;
  }

  return JSON.stringify(template, null, 2);
}
