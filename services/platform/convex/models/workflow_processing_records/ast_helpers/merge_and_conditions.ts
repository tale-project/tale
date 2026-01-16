/**
 * Merge two AND conditions into a single result.
 *
 * Combines the conditions from both sides of an AND expression,
 * preserving complexity flags from either side.
 *
 * @param left - Conditions from left side of AND
 * @param right - Conditions from right side of AND
 * @returns Merged conditions and complexity flag
 */

import type { ParsedFilterExpression } from './types';

export function mergeAndConditions(
  left: Omit<ParsedFilterExpression, 'equalityConditions'>,
  right: Omit<ParsedFilterExpression, 'equalityConditions'>,
): Omit<ParsedFilterExpression, 'equalityConditions'> {
  return {
    conditions: [...left.conditions, ...right.conditions],
    hasComplexConditions:
      left.hasComplexConditions || right.hasComplexConditions,
  };
}
