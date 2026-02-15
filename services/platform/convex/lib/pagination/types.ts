/**
 * Pagination types for Convex queries (cursor-based)
 */

import type { GenericValidator } from 'convex/values';

import { zodToConvex } from 'convex-helpers/server/zod4';
import { v } from 'convex/values';

import {
  cursorPaginationOptsSchema,
  DEFAULT_PAGE_SIZE,
} from '../../../lib/shared/schemas/pagination';

export * from '../../../lib/shared/schemas/pagination';

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
export const cursorPaginationOptsValidator = zodToConvex(
  cursorPaginationOptsSchema,
);

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

export { DEFAULT_PAGE_SIZE };
