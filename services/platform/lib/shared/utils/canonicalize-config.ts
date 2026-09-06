/**
 * Canonical-form helper for JSON config files.
 *
 * Sorting object keys is *always* safe (JSON key order is never semantic) and
 * makes on-disk diffs deterministic. Arrays are never sorted: their order is
 * frequently semantic (a model fallback chain, the display order of
 * conversation starters), so element order is preserved and only the objects
 * *inside* arrays are recursed.
 *
 * Used by `serializeJson` (`backend/core/lib/file_io.ts`) so every JSON config
 * file the backend writes is canonical.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively return a copy of `value` with every plain object's keys sorted
 * lexicographically. Arrays keep their element order (their *contents* are
 * recursed so nested objects inside arrays are sorted too). Non-plain values
 * (primitives, `Date`, class instances) pass through untouched.
 */
export function sortObjectKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- structural recursion preserves T
    return value.map((item) => sortObjectKeysDeep(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortObjectKeysDeep(value[key]);
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rebuilt with same keys/values
    return sorted as T;
  }
  return value;
}
