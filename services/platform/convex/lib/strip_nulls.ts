/**
 * Recursively strip null values from a plain object so that Zod `.optional()`
 * fields do not fail validation when the Convex transport converts missing
 * properties to explicit `null`.
 *
 * Arrays are filtered to remove null/undefined elements after recursive
 * processing, preventing [undefined] slots from breaking strict schemas.
 */
export function stripNulls(obj: unknown): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    return obj.map(stripNulls).filter((v) => v !== null && v !== undefined);
  }
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null) {
        out[key] = typeof value === 'object' ? stripNulls(value) : value;
      }
    }
    return out;
  }
  return obj;
}
