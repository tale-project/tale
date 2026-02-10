/* oxlint-disable typescript/no-unsafe-type-assertion -- Centralized cast helpers for Convex branded types */

/**
 * Centralized type cast helpers for Convex branded types.
 *
 * Convex uses branded types (`Id<T>`, `ConvexJsonRecord`, `ConvexJsonValue`)
 * that require casts from plain strings / objects. These helpers concentrate
 * the unavoidable `as` casts into a single file so the rest of the codebase
 * stays cast-free.
 */

import type { GenericId } from 'convex/values';

import type {
  ConvexJsonRecord,
  ConvexJsonValue,
} from '../../lib/shared/schemas/utils/json-value';

/** Cast a plain string to a typed Convex document ID. */
export function toId<T extends string>(s: string): GenericId<T> {
  return s as GenericId<T>;
}

/** Cast an array of strings to typed Convex document IDs. */
export function toIds<T extends string>(arr: string[]): GenericId<T>[] {
  return arr as GenericId<T>[];
}

/** Cast a record-like value to `ConvexJsonRecord` for Convex storage. */
export function toConvexJsonRecord(obj: unknown): ConvexJsonRecord {
  return obj as ConvexJsonRecord;
}

/** Cast any value to `ConvexJsonValue` for Convex storage. */
export function toConvexJsonValue(val: unknown): ConvexJsonValue {
  return val as ConvexJsonValue;
}

/** Cast an array to `ConvexJsonValue[]` for Convex storage. */
export function toConvexJsonValues(arr: unknown[]): ConvexJsonValue[] {
  return arr as ConvexJsonValue[];
}
