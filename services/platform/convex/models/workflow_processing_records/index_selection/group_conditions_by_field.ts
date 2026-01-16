/**
 * Group conditions by field name.
 *
 * Groups all filter conditions by their field name, keeping multiple
 * conditions for the same field together (e.g., `field > 5 && field < 10`).
 *
 * @param conditions - Array of filter conditions to group
 * @returns Map of field name to array of conditions
 */

import type { FilterCondition } from '../ast_helpers';

export function groupConditionsByField(
  conditions: FilterCondition[],
): Map<string, FilterCondition[]> {
  const grouped = new Map<string, FilterCondition[]>();

  for (const condition of conditions) {
    const existing = grouped.get(condition.field) || [];
    existing.push(condition);
    grouped.set(condition.field, existing);
  }

  return grouped;
}
