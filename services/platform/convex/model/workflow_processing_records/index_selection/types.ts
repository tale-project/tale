/**
 * Type definitions for index selection
 */

import type { IndexConfig } from '../get_table_indexes';
import type { FilterCondition } from '../ast_helpers';

/**
 * Result of index selection
 */
export interface IndexSelectionResult {
  /** Selected index configuration */
  index: IndexConfig;
  /** Field values to use in the index query (for equality conditions only) */
  indexValues: Record<string, unknown>;
  /** Whether post-filtering is needed (for conditions not covered by index) */
  requiresPostFilter: boolean;
  /** Conditions that can be applied at the query level */
  indexableConditions: FilterCondition[];
  /** Conditions that require post-filtering */
  postFilterConditions: FilterCondition[];
}

/**
 * Internal scoring result for an index
 */
export interface ScoringResult {
  score: number;
  values: Record<string, unknown>;
  indexableConditions: FilterCondition[];
  postFilterConditions: FilterCondition[];
}
