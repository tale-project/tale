/**
 * Score an index based on how well it matches the filter conditions.
 *
 * Enhanced scoring rules:
 * - Each consecutive field from the start that can be satisfied = +1 point
 * - Equality conditions (==) score higher: +10 points per field
 * - Comparison conditions (>, <, >=, <=) score medium: +5 points
 * - Inequality conditions (!=) score low: +1 point (requires post-filter)
 * - organizationId is always satisfied (from context)
 * - Fields must be satisfied in order (Convex index requirement)
 * - Once we hit a comparison operator, we can't use subsequent index fields
 *
 * @example
 * // For index ['organizationId', 'status', 'priority']:
 * // - conditions: { status: == 'open' } => score: 11 (orgId=1 + status=10)
 * // - conditions: { priority: > 5 } => score: 1 (only orgId, can't skip status)
 * // - conditions: { status: == 'open', priority: > 5 } => score: 16 (orgId=1 + status=10 + priority=5)
 *
 * @param index - The index to score
 * @param organizationId - The organization ID value
 * @param conditionsByField - Conditions grouped by field name
 * @returns Score and values to use for this index
 */

import type { IndexConfig } from '../index_registry';
import type { FilterCondition } from '../ast_helpers';
import type { ScoringResult } from './types';

export function scoreIndex(
  index: IndexConfig,
  organizationId: string,
  conditionsByField: Map<string, FilterCondition[]>,
): ScoringResult {
  const values: Record<string, unknown> = {};
  const indexableConditions: FilterCondition[] = [];
  const postFilterConditions: FilterCondition[] = [];
  let score = 0;
  let hitComparison = false; // Once we hit a comparison, can't use more index fields

  for (const field of index.fields) {
    if (field === 'organizationId') {
      // Always have organizationId
      values[field] = organizationId;
      score += 1;
      continue;
    }

    const fieldConditions = conditionsByField.get(field);
    if (!fieldConditions || fieldConditions.length === 0) {
      // No condition for this field - can't continue with index
      break;
    }

    // Prioritize equality conditions for index use
    const equalityCondition = fieldConditions.find((c) => c.operator === '==');
    if (equalityCondition && !hitComparison) {
      // Use equality condition in index
      values[field] = equalityCondition.value;
      indexableConditions.push(equalityCondition);
      score += 10; // High score for equality
      // Add other conditions on same field to post-filter
      fieldConditions
        .filter((c) => c !== equalityCondition)
        .forEach((c) => postFilterConditions.push(c));
      continue;
    }

    // If we already hit a comparison, remaining conditions need post-filtering
    if (hitComparison) {
      fieldConditions.forEach((c) => postFilterConditions.push(c));
      break;
    }

    // Try to use comparison conditions
    const comparisonCondition = fieldConditions.find((c) =>
      ['>', '<', '>=', '<='].includes(c.operator),
    );
    if (comparisonCondition) {
      // Comparison operators can use index but stop further index usage
      indexableConditions.push(comparisonCondition);
      score += 5; // Medium score for comparison
      hitComparison = true;
      // Add other conditions on same field to post-filter
      fieldConditions
        .filter((c) => c !== comparisonCondition)
        .forEach((c) => postFilterConditions.push(c));
      break; // Can't use more index fields after comparison
    }

    // Inequality (!=) requires post-filtering
    fieldConditions.forEach((c) => postFilterConditions.push(c));
    score += 1; // Low score for inequality
    break; // Can't continue with index
  }

  // Any remaining conditions not satisfied by the index go to post-filter
  // This includes:
  // 1. Fields not in the index at all
  // 2. Index fields that weren't processed (e.g., we broke early due to missing intermediate fields)
  const usedFields = new Set(Object.keys(values));
  for (const [field, fieldConditions] of conditionsByField.entries()) {
    // Skip organizationId (always satisfied) and fields we already added to indexableConditions
    if (field === 'organizationId' || usedFields.has(field)) {
      continue;
    }
    // Check if all conditions for this field are already in postFilterConditions
    const alreadyInPostFilter = fieldConditions.every((c) =>
      postFilterConditions.includes(c)
    );
    if (!alreadyInPostFilter) {
      fieldConditions.forEach((c) => {
        if (!postFilterConditions.includes(c) && !indexableConditions.includes(c)) {
          postFilterConditions.push(c);
        }
      });
    }
  }

  return { score, values, indexableConditions, postFilterConditions };
}
