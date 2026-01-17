/**
 * Select the optimal index for a query based on filter expression.
 *
 * Enhanced algorithm:
 * 1. Parse the filter expression to extract all conditions (equality + comparisons)
 * 2. For each available index, calculate a score based on:
 *    - How many consecutive fields from the index start can be satisfied
 *    - organizationId is always satisfied (provided separately)
 *    - Equality conditions score higher than range conditions
 * 3. Select the index with the highest score
 * 4. Separate conditions into indexable (can use DB index) vs post-filter (need evaluation)
 * 5. Return the index, values, and condition categorization
 *
 * Index usage strategy:
 * - Equality (==): Can use index directly with .eq()
 * - Comparisons (>, <, >=, <=): Can use index partially (stop at first comparison)
 * - Inequality (!=): Requires post-filtering (can't efficiently use index)
 * - Multiple comparisons on same field: Keep the most restrictive
 *
 * @param tableName - The table to query
 * @param organizationId - The organization ID (always used in index)
 * @param filterExpression - Optional filter expression to parse
 * @returns The selected index and condition categorization
 */

import type { TableName } from '../types';
import type { IndexConfig } from '../get_table_indexes';
import { getTableIndexes } from '../get_table_indexes';
import { parseFilterExpression } from '../parse_filter_expression';
import type { IndexSelectionResult, ScoringResult } from './types';
import { groupConditionsByField } from './group_conditions_by_field';
import { scoreIndex } from './score_index';

export function selectOptimalIndex(
  tableName: TableName,
  organizationId: string,
  filterExpression?: string,
): IndexSelectionResult {
  const indexes = getTableIndexes(tableName);

  // Always start with organizationId
  const baseValues: Record<string, unknown> = { organizationId };

  // If no filter expression, use the basic organizationId index
  // Note: index_registry.ts guarantees by_organizationId is always last in each table's index list
  if (!filterExpression || filterExpression.trim() === '') {
    const basicIndex =
      indexes.find(
        (idx) => idx.fields.length === 1 && idx.fields[0] === 'organizationId',
      ) || indexes[indexes.length - 1];

    return {
      index: basicIndex,
      indexValues: baseValues,
      requiresPostFilter: false,
      indexableConditions: [],
      postFilterConditions: [],
    };
  }

  // Parse the filter expression
  const { conditions, hasComplexConditions } =
    parseFilterExpression(filterExpression);

  // Fast path: Direct _id lookup is always optimal
  const idCondition = conditions.find(
    (c) => c.field === '_id' && c.operator === '==',
  );
  if (idCondition) {
    return {
      index: { name: 'by_id', fields: ['_id'], isBuiltIn: true },
      indexValues: { _id: idCondition.value },
      requiresPostFilter: conditions.length > 1 || hasComplexConditions,
      indexableConditions: [idCondition],
      postFilterConditions: conditions.filter((c) => c !== idCondition),
    };
  }

  // Group conditions by field
  const conditionsByField = groupConditionsByField(conditions);

  // Score each index
  // Default to basic organizationId index (always last per index_registry.ts)
  let bestIndex: IndexConfig = indexes[indexes.length - 1];
  let bestScore = 0;
  let bestResult: ScoringResult = {
    score: 0,
    values: baseValues,
    indexableConditions: [],
    postFilterConditions: conditions,
  };

  for (const index of indexes) {
    const result = scoreIndex(index, organizationId, conditionsByField);

    // Prefer higher scores; on tie, prefer more specific indexes (more fields)
    if (
      result.score > bestScore ||
      (result.score === bestScore &&
        index.fields.length > bestIndex.fields.length)
    ) {
      bestScore = result.score;
      bestIndex = index;
      bestResult = result;
    }
  }

  // Determine if post-filtering is needed
  const requiresPostFilter =
    hasComplexConditions || bestResult.postFilterConditions.length > 0;

  return {
    index: bestIndex,
    indexValues: bestResult.values,
    requiresPostFilter,
    indexableConditions: bestResult.indexableConditions,
    postFilterConditions: bestResult.postFilterConditions,
  };
}
