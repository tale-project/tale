/**
 * Pagination utilities for Convex queries
 *
 * @example Cursor-based pagination (infinite scroll)
 * ```ts
 * import { paginateWithFilter } from './lib/pagination';
 *
 * const query = ctx.db.query('items').withIndex('by_org', q => q.eq('orgId', orgId)).order('desc');
 * const result = await paginateWithFilter(query, {
 *   numItems: 20,
 *   cursor: args.cursor,
 *   filter: item => item.status === 'active'
 * });
 * ```
 *
 * @example Offset-based pagination (traditional pages)
 * ```ts
 * import { offsetPaginate } from './lib/pagination';
 *
 * const allItems = await ctx.db.query('items').withIndex('by_org', q => q.eq('orgId', orgId)).collect();
 * const result = offsetPaginate(allItems, { page: 1, pageSize: 20 });
 * ```
 */

export {
  // Types
  type CursorPaginationOptions,
  type CursorPaginatedResult,
  type OffsetPaginationOptions,
  type OffsetPaginatedResult,
  // Validators
  cursorPaginationOptsValidator,
  cursorPaginatedResultValidator,
  offsetPaginationOptsValidator,
  offsetPaginatedResultValidator,
  // Constants
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './types';

export {
  paginateWithFilter,
  offsetPaginate,
  normalizePaginationOptions,
  calculatePaginationMeta,
} from './helpers';
