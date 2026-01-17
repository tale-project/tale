/**
 * Filter customers using JEXL expression evaluation
 *
 * ⚠️ WARNING: This function loops through ALL customers in the organization.
 * Use with caution on large datasets as it can be expensive.
 * For simple queries (status, source, externalId), prefer the `query` operation
 * which uses Convex indexes for better performance.
 *
 * This function evaluates a JEXL expression against each customer.
 * Customers that match the expression (expression evaluates to true) are returned.
 *
 * Uses async iteration for efficient streaming of large datasets.
 *
 * @param ctx - Query context
 * @param args.organizationId - Organization ID to filter customers
 * @param args.expression - JEXL expression to evaluate against each customer
 * @returns Object containing matched customers array and count
 */

import type { QueryCtx } from '../_generated/server';
import { evaluateExpression } from '../lib/variables/evaluate_expression';

export async function filterCustomers(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    expression: string;
  },
): Promise<{ customers: unknown[]; count: number }> {
  const { organizationId, expression } = args;

  const matchedCustomers: unknown[] = [];

  // Use async iteration for efficient streaming (better than fetching one at a time)
  const query = ctx.db
    .query('customers')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .order('asc');

  for await (const customer of query) {
    // Evaluate the expression with the customer as context (must return boolean)
    const passed = evaluateExpression(expression, customer);

    if (passed) {
      matchedCustomers.push(customer);
    }
  }

  return {
    customers: matchedCustomers,
    count: matchedCustomers.length,
  };
}
