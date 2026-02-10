/**
 * Shared type guard utilities for runtime type narrowing.
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

/** Safely extract an array from a record. Returns `undefined` when missing or wrong type. */
export function getArray(
  obj: Record<string, unknown>,
  key: string,
): unknown[] | undefined {
  const val = obj[key];
  return Array.isArray(val) ? val : undefined;
}

/** Safely extract a nested record from a record. Returns `undefined` when missing or wrong type. */
export function getRecord(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const val = obj[key];
  return isRecord(val) ? val : undefined;
}

/**
 * Converts a route-param string to a typed Convex document Id.
 * Convex validates the Id server-side via `v.id()`; this bridges the type gap.
 */
export function toId<T extends string>(id: string) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Route params are string-typed Convex document Ids; validated server-side by v.id()
  return id as import('convex/values').GenericId<T>;
}
