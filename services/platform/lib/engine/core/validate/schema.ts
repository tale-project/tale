/**
 * The one Ajv instance the validation passes compile author schemas with:
 * `allErrors` so authors get complete feedback in a single round, non-strict
 * so unknown keywords in author-written schemas never crash validation.
 */

import { Ajv, type ValidateFunction } from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Compile a JSON Schema for one check; throws on an invalid schema (the
 * caller renders the message). The instance cache is cleared after every
 * compile: authors reuse `$id`s across documents and across repeated
 * validations of the same document, and a cached `$id` would make the
 * second compile throw "schema already exists".
 */
export function compileSchema(
  schema: Record<string, unknown>,
): ValidateFunction {
  try {
    return ajv.compile(structuredClone(schema));
  } finally {
    ajv.removeSchema();
  }
}
