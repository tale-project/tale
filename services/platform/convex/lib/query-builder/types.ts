/**
 * Types for the unified query builder
 */

import type { GenericDocument } from 'convex/server';

/**
 * Index configuration for smart index selection
 */
export interface IndexConfig {
  /** Index name as defined in schema */
  name: string;
  /** Fields covered by this index (in order) */
  fields: string[];
  /**
   * Priority for index selection (higher = preferred)
   * Use this to prefer more selective indexes
   */
  priority?: number;
}

/**
 * Filter configuration for query building
 */
export interface QueryFilters {
  /** Field -> value mapping for equality filters */
  [field: string]: unknown;
}

/**
 * Search configuration for text search across multiple fields
 */
export interface SearchConfig {
  /** Fields to search in */
  fields: string[];
  /** Search term (case-insensitive contains match) */
  term: string;
}

/**
 * Sort configuration
 */
export interface SortConfig {
  /** Field to sort by */
  field: string;
  /** Sort order */
  order: 'asc' | 'desc';
}

/**
 * Offset pagination options
 */
export interface OffsetPaginationOptions {
  page: number;
  pageSize: number;
}

/**
 * Cursor pagination options
 */
export interface CursorPaginationOptions {
  numItems: number;
  cursor: string | null;
}

/**
 * Result from smart index selection
 */
export interface IndexSelectionResult {
  /** Selected index name */
  indexName: string;
  /** Fields that will be filtered by the index */
  indexedFields: string[];
  /** Fields that need in-memory filtering */
  remainingFilters: string[];
}

/**
 * Offset paginated result
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
 * Cursor paginated result
 */
export interface CursorPaginatedResult<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string;
}

/**
 * Generic filter function type
 */
export type FilterFn<T extends GenericDocument> = (item: T) => boolean;
