/**
 * Recursively sanitize values for Convex compatibility.
 *
 * Convex rejects `undefined` anywhere in a value graph. This helper
 * converts `undefined` → `null` so that missing template variables
 * don't crash the workflow engine during serialization.
 */
export function sanitizeConvexValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(sanitizeConvexValue);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = sanitizeConvexValue(v);
    }
    return result;
  }
  return value;
}
