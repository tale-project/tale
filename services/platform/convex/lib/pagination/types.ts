/**
 * Unified pagination types for Convex queries
 *
 * Two pagination patterns:
 * 1. Cursor-based: For infinite scroll / load more patterns
 * 2. Offset-based: For traditional page navigation
 */

import type { GenericValidator } from 'convex/values';
import { v } from 'convex/values';

// ============================================================================
// CURSOR-BASED PAGINATION (for infinite scroll)
// ============================================================================

/**
 * Input options for cursor-based pagination.
 * Uses Convex's native pagination format.
 */
export interface CursorPaginationOptions {
  numItems: number;
  cursor: string | null;
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
});

/**
 * Creates a validator for cursor paginated results.
 * Generic preserves the concrete validator type for proper Infer<> inference.
 */
export function cursorPaginatedResultValidator<V extends GenericValidator>(itemValidator: V) {
  return v.object({
    page: v.array(itemValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  });
}

// ============================================================================
// OFFSET-BASED PAGINATION (for traditional page navigation)
// ============================================================================

/**
 * Input options for offset-based pagination
 */
export interface OffsetPaginationOptions {
  page: number;
  pageSize: number;
}

/**
 * Result type for offset-based pagination
 */
export interface OffsetPaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Validator for offset pagination options input
 */
export const offsetPaginationOptsValidator = v.object({
  page: v.optional(v.number()),
  pageSize: v.optional(v.number()),
});

/**
 * Creates a validator for offset paginated results.
 * Generic preserves the concrete validator type for proper Infer<> inference.
 */
export function offsetPaginatedResultValidator<V extends GenericValidator>(itemValidator: V) {
  return v.object({
    items: v.array(itemValidator),
    total: v.number(),
    page: v.number(),
    pageSize: v.number(),
    totalPages: v.number(),
    hasNextPage: v.boolean(),
    hasPreviousPage: v.boolean(),
  });
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
