/**
 * Create a filter function that evaluates a JEXL expression against each document.
 *
 * This is used for post-filtering when the expression contains conditions
 * that can't be satisfied by index queries (e.g., function calls, complex logic).
 *
 * @param expression - The JEXL expression to evaluate
 * @returns Filter function that returns true if document matches
 *
 * @example
 * const filter = createExpressionFilter('daysAgo(createdAt) > 30');
 * const matches = await filter(document);
 */

import { jexlInstance } from '../../../lib/variables/jexl_instance';

export function createExpressionFilter(
  expression: string,
): (doc: Record<string, unknown>) => Promise<boolean> {
  return async (doc: Record<string, unknown>): Promise<boolean> => {
    try {
      // Build context with document fields and time utilities
      const context = {
        ...doc,
        now: new Date().toISOString(),
        nowMs: Date.now(),
      };

      // Evaluate the expression synchronously
      // Note: Using evalSync is intentional - all registered JEXL transforms are synchronous
      // (daysAgo, hoursAgo, etc.) and this runs in a Convex function context
      const result = jexlInstance.evalSync(expression, context);

      // Ensure boolean result
      return Boolean(result);
    } catch (error) {
      // Log error but don't fail - treat as non-matching
      console.error('Filter expression evaluation error:', {
        expression,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };
}
