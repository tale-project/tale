/**
 * Build a JSON skeleton from a workflow start node's inputSchema. Used to
 * pre-fill the test panel and the schedule create dialog so users see expected
 * fields instead of an empty object.
 *
 * Required fields get a type-appropriate default (`""`, `0`, `false`, `[]`,
 * `{}`). Optional scalars (string/number/boolean) emit as `null` so they're
 * visibly distinct from required fields. Optional arrays/objects still emit
 * as `[]` / `{}` — the JSON tree editor's in-place `+` button only works on
 * existing arrays/objects, so giving collections their concrete shape upfront
 * lets users add items without switching to source mode.
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
 * Returns a stringified JSON object whose keys mirror the inputSchema. See
 * file-level docstring for the per-type default rules.
 * Returns `'{}'` when the schema is missing or has no properties.
 */
export function buildInputTemplateFromSchema(
  schema: InputSchema | undefined,
): string {
  if (!schema || !schema.properties) return '{}';

  const required = new Set(schema.required ?? []);
  const template: Record<string, unknown> = {};

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (required.has(key)) {
      template[key] = defaultForProperty(prop);
    } else if (prop.type === 'array' || prop.type === 'object') {
      // Concrete shape so the JSON tree editor's `+` button can add items.
      template[key] = defaultForProperty(prop);
    } else {
      // Scalars stay null to distinguish optional from required visually.
      template[key] = null;
    }
  }

  return JSON.stringify(template, null, 2);
}
