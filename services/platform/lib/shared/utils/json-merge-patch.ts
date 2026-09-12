import { isRecord } from '../../utils/type-utils.ts';

/**
 * RFC 7396 JSON Merge Patch — the rule a `PATCH` applies to a free-form
 * object field (a contact's or a product's `metadata`): a key the patch
 * carries is set, a key sent as `null` is removed, an object on both sides
 * merges recursively, and a key the patch omits stays. Arrays and scalars
 * replace whole. One rule for every family, so an integrator adding
 * `last_synced_at` no longer wipes every other custom attribute (the
 * fields used to be replaced whole, in silence).
 *
 * Recursion follows the PATCH's nesting only — the stored side never
 * drives it — and every door bounds a patch to `FREE_FORM_JSON_BOUNDS`,
 * so the stack stays shallow whatever a legacy row holds. Keys are set as
 * own data properties (`__proto__` included) so a patch can never rewrite
 * the result's prototype.
 */
export type JsonObject = Record<string, unknown>;

function mergeValue(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  const result: JsonObject = isRecord(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      delete result[key];
      continue;
    }
    Object.defineProperty(result, key, {
      value: mergeValue(result[key], value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

/**
 * `target` with `patch` applied per RFC 7396; a `null` (unset) target
 * merges as an empty object. Neither argument is mutated.
 */
export function applyJsonMergePatch(
  target: JsonObject | null,
  patch: JsonObject,
): JsonObject {
  const merged = mergeValue(target ?? {}, patch);
  return isRecord(merged) ? merged : {};
}
