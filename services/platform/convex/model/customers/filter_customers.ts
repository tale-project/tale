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
 * Uses cursor-based iteration for efficient processing of large datasets.
 *
 * @param ctx - Query context
 * @param args.organizationId - Organization ID to filter customers
 * @param args.expression - JEXL expression to evaluate against each customer
 * @returns Object containing matched customers array and count
 */

import type { QueryCtx } from '../../_generated/server';
import { evaluateExpression } from '../../lib/variables/evaluate_expression';

export async function filterCustomers(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    expression: string;
  },
): Promise<{ customers: unknown[]; count: number }> {
  const { organizationId, expression } = args;

  const matchedCustomers: unknown[] = [];
  let lastCreationTime = 0;

  // Loop through all customers using cursor-based iteration
  while (true) {
    // Fetch the next document after the last processed one
    // Use .gt() in the index query for better performance since _creationTime is part of the index
    const customer = await ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q
          .eq('organizationId', organizationId)
          .gt('_creationTime', lastCreationTime),
      )
      .order('asc')
      .first();

    if (!customer) break; // No more documents

    // Evaluate the expression with the customer as context (must return boolean)
    const passed = evaluateExpression(expression, customer);

    if (passed) {
      matchedCustomers.push(customer);
    }

    // Update the cursor
    lastCreationTime = customer._creationTime;
  }

  return {
    customers: matchedCustomers,
    count: matchedCustomers.length,
  };
}
