/**
 * Type definitions for query building
 */

import type { TableName } from '../types';

/**
 * Arguments for finding unprocessed documents
 */
export interface FindUnprocessedArgs {
  organizationId: string;
  tableName: TableName;
  wfDefinitionId: string;
  backoffHours: number;
  /**
   * Optional JEXL filter expression for advanced filtering.
   * Simple equality conditions (e.g., 'status == "closed"') will be used
   * for index-based query optimization.
   * Complex conditions (e.g., 'daysAgo(metadata.resolved_at) > 30') will be
   * applied as post-filters.
   *
   * @example 'status == "closed"'
   * @example 'status == "open" && priority == "high"'
   * @example 'status == "closed" && daysAgo(metadata.resolved_at) > 30'
   */
  filterExpression?: string;
}

/**
 * Result of finding unprocessed documents
 */
export interface FindUnprocessedResult {
  document: unknown | null;
}
