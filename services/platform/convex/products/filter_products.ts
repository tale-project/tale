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
 * Uses async iteration for efficient streaming of large datasets.
 *
 * @param ctx - Query context
 * @param args.organizationId - Organization ID to filter products
 * @param args.expression - JEXL expression to evaluate against each product
 * @returns Object containing matched products array and count
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { evaluateExpression } from '../lib/variables/evaluate_expression';

export async function filterProducts(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    expression: string;
  },
): Promise<{ products: Doc<'products'>[]; count: number }> {
  const { organizationId, expression } = args;

  const matchedProducts: Doc<'products'>[] = [];

  // Use async iteration for efficient streaming (better than fetching one at a time)
  const query = ctx.db
    .query('products')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .order('asc');

  for await (const product of query) {
    // Evaluate the expression with the product as context (must return boolean)
    const passed = evaluateExpression(expression, product);

    if (passed) {
      matchedProducts.push(product);
    }
  }

  return {
    products: matchedProducts,
    count: matchedProducts.length,
  };
}
