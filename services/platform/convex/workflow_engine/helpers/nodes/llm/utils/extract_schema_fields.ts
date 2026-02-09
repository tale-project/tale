/**
 * Extract Schema Fields
 *
 * Utility to extract field names from JSON Schema definitions.
 * Used to inform LLM which fields must appear in text output
 * for accurate structured data extraction.
 */

import type {
  JsonSchemaDefinition,
  JsonSchemaProperty,
} from '../../../../types/nodes';

/**
 * Recursively extracts all property names from a JSON Schema definition.
 * Returns a flat list of field names found in nested objects and arrays.
 *
 * @example
 * // Given schema:
 * // { type: 'object', properties: {
 * //   recommendations: { type: 'array', items: {
 * //     type: 'object', properties: {
 * //       productId: { type: 'string' },
 * //       productName: { type: 'string' }
 * //     }
 * //   }}
 * // }}
 * // Returns: ['productId', 'productName']
 */
export function extractSchemaFields(schema: JsonSchemaDefinition): string[] {
  const fields = new Set<string>();

  function extractFromProperty(prop: JsonSchemaProperty): void {
    if (prop.type === 'object' && prop.properties) {
      for (const [name, subProp] of Object.entries(prop.properties)) {
        fields.add(name);
        extractFromProperty(subProp);
      }
    } else if (prop.type === 'array' && prop.items) {
      extractFromProperty(prop.items);
    }
  }

  if (schema.properties) {
    for (const [name, prop] of Object.entries(schema.properties)) {
      fields.add(name);
      extractFromProperty(prop);
    }
  }

  return Array.from(fields);
}
