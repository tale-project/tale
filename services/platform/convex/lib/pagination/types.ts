/**
 * Pagination types for Convex queries (cursor-based)
 */

import type { GenericValidator } from 'convex/values';

import { v } from 'convex/values';

export const DEFAULT_PAGE_SIZE = 20;

/**
 * Input options for cursor-based pagination.
 * Uses Convex's native pagination format.
 */
export interface CursorPaginationOptions {
  numItems: number;
  cursor: string | null;
  id?: number;
}

/**
 * Result type for cursor-based pagination.
 * Matches Convex's native PaginationResult format.
 */
export interface CursorPaginatedResult<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string;
}

/**
 * Validator for cursor pagination options input
 */
export const cursorPaginationOptsValidator = v.object({
  numItems: v.number(),
  cursor: v.union(v.string(), v.null()),
  id: v.optional(v.number()),
});

/**
 * Creates a validator for cursor paginated results.
 * Generic preserves the concrete validator type for proper Infer<> inference.
 */
export function cursorPaginatedResultValidator<V extends GenericValidator>(
  itemValidator: V,
) {
  return v.object({
    page: v.array(itemValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  });
}
