/**
 * Shared runtime type utilities: type guards for narrowing `unknown`, and typed
 * wrappers for inherently untyped JS built-ins.
 *
 * Prefer these over `as` casts when a runtime check can prove the type.
 */

/**
 * Narrows `unknown` to `Record<string, unknown>` after verifying
 * the value is a non-null, non-array object.
 */
export function isRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Type-safe key lookup. Use after an `in` check to avoid the TS limitation
 * where the `in` operator does not narrow the left operand.
 */
export function isKeyOf<T extends Record<string, unknown>>(
  key: string | number | symbol | null | undefined,
  obj: T,
): key is keyof T {
  return key != null && key in obj;
}

/** Safely extract a string from a record. Returns `undefined` when missing or wrong type. */
export function getString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = obj[key];
  return typeof val === 'string' ? val : undefined;
}

/** Safely extract a number from a record. Returns `undefined` when missing or wrong type. */
export function getNumber(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const val = obj[key];
  return typeof val === 'number' ? val : undefined;
}

/** Safely extract a boolean from a record. Returns `undefined` when missing or wrong type. */
export function getBoolean(
  obj: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const val = obj[key];
  return typeof val === 'boolean' ? val : undefined;
}

/**
 * Display string for a primitive value: the string itself, or `String()` on a
 * number/boolean/bigint. Returns `undefined` for objects, arrays, `null`, and
 * `undefined` — callers render nothing instead of "[object Object]".
 */
export function primitiveString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return undefined;
}

/**
 * Runtime-validate that a string belongs to a known set of values.
 * Returns `undefined` if the value is not in the set.
 */
export function narrowStringUnion<T extends string>(
  value: string,
  validValues: readonly T[],
): T | undefined {
  return validValues.find((v) => v === value);
}

/**
 * Build a `Record<K, V>` from an array of keys and a value factory.
 *
 * Replaces the common `keys.reduce((acc, k) => ({ ...acc, [k]: fn(k) }), {} as Record<K, V>)`
 * pattern which requires an unsafe type assertion on the empty initial value.
 */
export function buildRecord<K extends string, V>(
  keys: readonly K[],
  valueFn: (key: K) => V,
): Record<K, V> {
  const result: Partial<Record<K, V>> = {};
  for (const k of keys) {
    result[k] = valueFn(k);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Partial→full is safe since every key is assigned in the loop above
  return result as Record<K, V>;
}

/** Parse a `Response` body as typed JSON. */
export async function fetchJson<T>(response: Response): Promise<T> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Response.json() is inherently `any`
  return (await response.json()) as T;
}

/** Parse a JSON string to a typed value. */
export function parseJson<T>(json: string): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse() is inherently `any`
  return JSON.parse(json) as T;
}
