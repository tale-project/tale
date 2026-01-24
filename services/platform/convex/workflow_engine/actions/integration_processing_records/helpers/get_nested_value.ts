/**
 * Get a nested value from an object using dot notation
 *
 * @param obj - The object to extract value from
 * @param path - Dot-notation path (e.g., 'a.b.c')
 * @returns The value at the path, or undefined if not found
 *
 * @example
 * getNestedValue({ a: { b: 1 } }, 'a.b') // => 1
 * getNestedValue({ data: { id: 'abc' } }, 'data.id') // => 'abc'
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
