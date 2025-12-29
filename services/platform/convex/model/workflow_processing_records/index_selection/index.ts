/**
 * Index Selection
 *
 * Automatically selects the best database index based on:
 * 1. Filter conditions extracted from filter expression (equality and comparisons)
 * 2. Available indexes for the table
 * 3. Scoring based on how many conditions each index can satisfy
 *
 * Supports all comparison operators: ==, !=, >, <, >=, <=
 *
 * Each function is in its own file following the one-function-per-file principle.
 */

// Export types
export type { IndexSelectionResult, ScoringResult } from './types';

// Export functions
export { groupConditionsByField } from './group_conditions_by_field';
export { scoreIndex } from './score_index';
export { selectOptimalIndex } from './select_optimal_index';
