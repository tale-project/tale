/**
 * Robust structural (deep) equality for dirty-state detection.
 *
 * Why not `JSON.stringify(a) === JSON.stringify(b)`? That comparison is the
 * source of two whole classes of dirty-state bugs that this module exists to
 * kill:
 *
 *  1. **Key order matters.** `{a:1,b:2}` and `{b:2,a:1}` stringify to
 *     different strings. The server can return config keys in a different
 *     order than the client builds them, so a freshly-loaded form reads as
 *     "dirty" even though nothing changed (Save enabled + navigation blocker
 *     firing on a page the user only opened).
 *  2. **`undefined` is asymmetric.** `JSON.stringify({a:undefined})` drops the
 *     key (`"{}"`) while `JSON.stringify({a:null})` keeps it. Worse, building
 *     a patch with `{ ...prev, field: undefined }` is meant to mean "no value"
 *     but only stringifies equal when the baseline also literally omitted the
 *     key in the same position.
 *
 * `structuralEqual` is key-order-insensitive for plain objects and treats a
 * key whose value is `undefined` as absent, so `{a:1,b:undefined}` equals
 * `{a:1}`. Arrays remain order-sensitive (order is meaningful for lists).
 * `NaN` equals `NaN` (unlike `===`) so a half-typed number field doesn't
 * latch dirty forever.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  // `Object.getPrototypeOf` is typed `any` in lib.d.ts; cast to `unknown` to
  // avoid leaking `any` into the comparison below.
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Own enumerable keys whose value is not `undefined`. */
function definedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => obj[k] !== undefined);
}

/**
 * Deep structural equality tuned for config/form dirty-state comparison.
 * Handles primitives, `NaN`, `Date`, arrays (order-sensitive), and plain
 * objects (key-order- and `undefined`-key-insensitive). Class instances,
 * `Map`/`Set`, and functions fall back to reference identity.
 */
export function structuralEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true; // covers identical refs + NaN === NaN

  // Primitives that aren't reference-equal can't be structurally equal.
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  ) {
    return false;
  }

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date
      ? a.getTime() === b.getTime()
      : false;
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray || bIsArray) {
    if (!aIsArray || !bIsArray || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!structuralEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (!isPlainObject(a) || !isPlainObject(b)) {
    // Non-plain objects (Map, Set, class instances) — only the reference
    // check above can prove equality; anything else is treated as different.
    return false;
  }

  const aKeys = definedKeys(a);
  const bKeys = definedKeys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!structuralEqual(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Top-level keys whose values diverge between two records, using
 * {@link structuralEqual} per key. Feeds the per-tab "unsaved" dots: a tab
 * lights up when its owned keys intersect this set. Keys present in only one
 * side (with a defined value) count as changed.
 */
export function changedKeys(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): ReadonlySet<string> {
  const keys = new Set<string>();
  if (!a || !b) return keys;
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    if (!structuralEqual(a[key], b[key])) keys.add(key);
  }
  return keys;
}
