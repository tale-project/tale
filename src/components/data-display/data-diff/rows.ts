import type { SchemaTreeSchema } from '../../../data/infer-schema';
import { isWithin, pointerOf } from '../../../data/json-pointer';
import type { DiffChange } from '../../../data/value-diff';
import { kindOf } from '../../../data/value-summary';
import { childKeys, valueAt } from '../value-tree/model';

/**
 * How a diff reads as a list: its changes in the order the value is
 * written, the fields that did not change (folded into one row), and
 * whether two values share enough structure to compare field by field.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The keys under a place, in the order a reader meets them. */
export type KeysAt = (
  prefix: readonly (string | number)[],
) => readonly (string | number)[];

/** Keys of two values: `after`'s in its order, then those only `before`
 *  had, in `before`'s order. */
export function valueKeysAt(before: unknown, after: unknown): KeysAt {
  return (prefix) => [
    ...childKeys(valueAt(after, prefix)),
    ...childKeys(valueAt(before, prefix)),
  ];
}

/** The fields of two shapes, the same way: a number in a path steps into a
 *  list's items. */
export function shapeKeysAt(
  before: SchemaTreeSchema,
  after: SchemaTreeSchema,
): KeysAt {
  const at = (
    schema: SchemaTreeSchema,
    prefix: readonly (string | number)[],
  ) => {
    let node: SchemaTreeSchema | undefined = schema;
    for (const segment of prefix) {
      if (node === undefined) return undefined;
      node =
        typeof segment === 'number'
          ? node.items
          : node.properties !== undefined &&
              Object.hasOwn(node.properties, segment)
            ? node.properties[segment]
            : undefined;
    }
    return node;
  };
  return (prefix) => [
    ...Object.keys(at(after, prefix)?.properties ?? {}),
    ...Object.keys(at(before, prefix)?.properties ?? {}),
  ];
}

/**
 * The changes in reading order: by position for list items, and for object
 * keys by where `keysAt` puts them (for values, `after`'s order, then the
 * keys only `before` had). A container comes before the changes inside it.
 */
export function orderChanges(
  changes: readonly DiffChange[],
  keysAt: KeysAt,
): DiffChange[] {
  const ranks = new Map<string, Map<string, number>>();
  const rankOf = (prefix: readonly (string | number)[], key: string) => {
    const pointer = pointerOf(prefix);
    let order = ranks.get(pointer);
    if (order === undefined) {
      order = new Map();
      for (const each of keysAt(prefix)) {
        if (!order.has(String(each))) order.set(String(each), order.size);
      }
      ranks.set(pointer, order);
    }
    return order.get(key) ?? Number.MAX_SAFE_INTEGER;
  };
  const compare = (a: DiffChange, b: DiffChange): number => {
    const length = Math.min(a.path.length, b.path.length);
    for (let index = 0; index < length; index++) {
      const left = a.path[index];
      const right = b.path[index];
      if (left === right) continue;
      if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
      }
      if (typeof left === 'number') return -1;
      if (typeof right === 'number') return 1;
      const prefix = a.path.slice(0, index);
      return rankOf(prefix, left) - rankOf(prefix, right);
    }
    return a.path.length - b.path.length;
  };
  return changes.toSorted(compare);
}

export interface UnchangedField {
  path: readonly (string | number)[];
  value: unknown;
}

/**
 * The places in `after` no change touches, as large as they come: an
 * unchanged object is one entry, not one per field. Walks only into what
 * changed; at most `limit` entries, `total` counts them all.
 */
export function unchangedFields(
  after: unknown,
  changes: readonly DiffChange[],
  limit = 500,
): { fields: UnchangedField[]; total: number } {
  const pointers = changes.map((change) => change.pointer);
  const fields: UnchangedField[] = [];
  let total = 0;
  const walk = (node: unknown, path: (string | number)[]) => {
    const pointer = pointerOf(path);
    const touched = pointers.some((each) => isWithin(each, pointer));
    if (!touched) {
      if (path.length === 0) return;
      total += 1;
      if (fields.length < limit) fields.push({ path, value: node });
      return;
    }
    // A change on the place itself, other than a new order of its items,
    // says all there is to say about it.
    const own = changes.find((change) => change.pointer === pointer);
    if (own !== undefined && own.kind !== 'reordered') return;
    for (const key of childKeys(node)) {
      walk(
        Array.isArray(node) && typeof key === 'number'
          ? node[key]
          : isRecord(node)
            ? node[String(key)]
            : undefined,
        [...path, key],
      );
    }
  };
  walk(after, []);
  return { fields, total };
}

/**
 * Whether two values can be compared field by field: two lists, two
 * objects that share a key, two plain values, or a side that is empty or
 * missing. An object against a list, or a container against plain text,
 * shares nothing to compare.
 */
export function sharesStructure(before: unknown, after: unknown): boolean {
  if (
    before === undefined ||
    after === undefined ||
    before === null ||
    after === null
  ) {
    return true;
  }
  const beforeKind = kindOf(before);
  const afterKind = kindOf(after);
  const container = (kind: string) => kind === 'object' || kind === 'array';
  if (!container(beforeKind) && !container(afterKind)) return true;
  if (beforeKind !== afterKind) return false;
  if (!isRecord(before) || !isRecord(after)) return true;
  const keys = Object.keys(after);
  if (keys.length === 0 || Object.keys(before).length === 0) return true;
  return keys.some((key) => Object.hasOwn(before, key));
}
