/**
 * The one Ajv instance the validation passes compile author schemas with:
 * `allErrors` so authors get complete feedback in a single round, non-strict
 * so unknown keywords in author-written schemas never crash validation.
 */

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

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

/** How many compiled schemas one process keeps — a bound, not a budget:
 * the hot set is the deployed automations of the organizations a replica
 * serves, and a miss only costs the compile it used to pay every time. */
const COMPILED_CACHE_MAX = 256;

/** Compiled checks by the caller's key, in insertion order (the oldest
 * entry goes when the bound is reached). */
const compiledByKey = new Map<string, ValidateFunction>();

/**
 * `compileSchema` behind a cache keyed by an IMMUTABLE identity of the
 * schema — a saved automation version (`org/name@version:createdAt`), which
 * never changes once written. Every run start used to recompile the
 * deployed version's `inputs` schema from scratch; the compile, not the
 * check, was the cost. The key must change whenever the schema can: a
 * version number alone is not enough, because a deleted and recreated
 * automation counts from 1 again.
 */
export function compileSchemaCached(
  key: string,
  schema: Record<string, unknown>,
): ValidateFunction {
  const cached = compiledByKey.get(key);
  if (cached !== undefined) return cached;
  const check = compileSchema(schema);
  if (compiledByKey.size >= COMPILED_CACHE_MAX) {
    const oldest = compiledByKey.keys().next().value;
    if (oldest !== undefined) compiledByKey.delete(oldest);
  }
  compiledByKey.set(key, check);
  return check;
}

/** Test seam: forget every compiled schema. */
export function resetCompiledSchemaCacheForTests(): void {
  compiledByKey.clear();
}

/** How many problems one refusal names — enough to fix an input in one
 * round trip, bounded so a hostile input cannot echo itself back at length. */
const MAX_DESCRIBED_ERRORS = 20;

/** A JSON pointer (`/orders/2/amount`) as the dotted path the REST envelope
 * names fields by (`orders.2.amount`); the root is the empty string. */
function pointerToPath(pointer: string): string {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .join('.');
}

/**
 * Ajv's problems as the `{path, message}` list a refusal answers under
 * `data.issues` — the shape a refused request body gets, so a client reads
 * a refused run input the same way. A missing required property is named
 * as its own problem ("is required"), so is a property the schema does not
 * take; anything else keeps Ajv's own reason (`must be string`).
 */
export function describeSchemaErrors(
  errors: ErrorObject[] | null | undefined,
): { path: string; message: string }[] {
  return (errors ?? []).slice(0, MAX_DESCRIBED_ERRORS).map((error) => {
    const base = pointerToPath(error.instancePath);
    const under = (leaf: string) => (base === '' ? leaf : `${base}.${leaf}`);
    const missing: unknown = Reflect.get(error.params, 'missingProperty');
    if (error.keyword === 'required' && typeof missing === 'string') {
      return { path: under(missing), message: 'is required' };
    }
    const extra: unknown = Reflect.get(error.params, 'additionalProperty');
    if (error.keyword === 'additionalProperties' && typeof extra === 'string') {
      return {
        path: under(extra),
        message: 'is not a field the inputs schema takes',
      };
    }
    return { path: base, message: error.message ?? 'is invalid' };
  });
}
