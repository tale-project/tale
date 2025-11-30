/**
 * Filter products using JEXL expression evaluation
 *
 * ⚠️ WARNING: This function loops through ALL products in the organization.
 * Use with caution on large datasets as it can be expensive.
 * For simple queries (status, category, externalId), prefer the `query` operation
 * which uses Convex indexes for better performance.
 *
 * This function evaluates a JEXL expression against each product.
 * Products that match the expression (expression evaluates to true) are returned.
 *
 * Uses cursor-based iteration for efficient processing of large datasets.
 *
 * @param ctx - Query context
 * @param args.organizationId - Organization ID to filter products
 * @param args.expression - JEXL expression to evaluate against each product
 * @returns Object containing matched products array and count
 */

import type { QueryCtx } from '../../_generated/server';
import { evaluateExpression } from '../../lib/variables/evaluate_expression';

export async function filterProducts(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    expression: string;
  },
): Promise<{ products: unknown[]; count: number }> {
  const { organizationId, expression } = args;

  const matchedProducts: unknown[] = [];
  let lastCreationTime = 0;

  // Loop through all products using cursor-based iteration
  while (true) {
    // Fetch the next document after the last processed one
    // Use .gt() in the index query for better performance since _creationTime is part of the index
    const product = await ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q
          .eq('organizationId', organizationId)
          .gt('_creationTime', lastCreationTime),
      )
      .order('asc')
      .first();

    if (!product) break; // No more documents

    // Evaluate the expression with the product as context (must return boolean)
    const passed = evaluateExpression(expression, product);

    if (passed) {
      matchedProducts.push(product);
    }

    // Update the cursor
    lastCreationTime = product._creationTime;
  }

  return {
    products: matchedProducts,
    count: matchedProducts.length,
  };
}
