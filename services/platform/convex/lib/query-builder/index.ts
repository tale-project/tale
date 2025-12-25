/**
 * Unified query builder for Convex
 *
 * Provides smart index selection and pagination utilities
 */

// Types
export type {
  IndexConfig,
  QueryFilters,
  SearchConfig,
  SortConfig,
  OffsetPaginationOptions,
  CursorPaginationOptions,
  IndexSelectionResult,
  OffsetPaginatedResult,
  CursorPaginatedResult,
  FilterFn,
} from './types';

// Index selection utilities
export {
  selectOptimalIndex,
  createInMemoryFilter,
  createSearchFilter,
  combineFilters,
} from './select-index';

// Query builders
export {
  buildOffsetPaginatedQuery,
  buildCursorPaginatedQuery,
  createIndexConfigs,
  type BuildPaginatedQueryOptions,
} from './build-query';
