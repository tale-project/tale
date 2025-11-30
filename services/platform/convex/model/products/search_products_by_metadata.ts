/**
 * Search products by metadata (internal operation)
 *
 * Simple search: if metadata is a string, check if it includes the target.
 * Uses cursor-based iteration for efficient processing.
 *
 * @param ctx - Query context
 * @param args.organizationId - Organization ID to filter products
 * @param args.target - Target string to search for in metadata
 * @returns Object containing matched products array and count
 */

import type { QueryCtx } from '../../_generated/server';

export async function searchProductsByMetadata(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    target: string;
  },
): Promise<{ products: unknown[]; count: number }> {
  const { organizationId, target } = args;

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

    // Check if metadata is a string and includes the target
    // If not a string, convert to JSON string and then search
    if (typeof product.metadata === 'string') {
      if (product.metadata.includes(target)) {
        matchedProducts.push(product);
      }
    } else if (product.metadata !== undefined && product.metadata !== null) {
      const metadataString = JSON.stringify(product.metadata);
      if (metadataString.includes(target)) {
        matchedProducts.push(product);
      }
    }

    // Update the cursor
    lastCreationTime = product._creationTime;
  }

  return {
    products: matchedProducts,
    count: matchedProducts.length,
  };
}
