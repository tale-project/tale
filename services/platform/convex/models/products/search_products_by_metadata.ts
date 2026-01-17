/**
 * Search products by metadata (internal operation)
 *
 * Simple search: if metadata is a string, check if it includes the target.
 * Uses async iteration for efficient streaming and memory usage.
 *
 * @param ctx - Query context
 * @param args.organizationId - Organization ID to filter products
 * @param args.target - Target string to search for in metadata
 * @param args.limit - Optional limit on number of results (default: unlimited)
 * @returns Object containing matched products array and count
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';

export async function searchProductsByMetadata(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    target: string;
    limit?: number;
  },
): Promise<{ products: Doc<'products'>[]; count: number }> {
  const { organizationId, target, limit } = args;
  const targetLower = target.toLowerCase();

  const matchedProducts: Doc<'products'>[] = [];

  // Use async iteration for efficient streaming
  const query = ctx.db
    .query('products')
    .withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId));

  for await (const product of query) {
    // Check if metadata contains the target string
    let matches = false;

    if (typeof product.metadata === 'string') {
      matches = product.metadata.toLowerCase().includes(targetLower);
    } else if (product.metadata !== undefined && product.metadata !== null) {
      // Convert object to JSON string for search
      const metadataString = JSON.stringify(product.metadata).toLowerCase();
      matches = metadataString.includes(targetLower);
    }

    if (matches) {
      matchedProducts.push(product);

      // Early termination if limit is reached
      if (limit !== undefined && matchedProducts.length >= limit) {
        break;
      }
    }
  }

  return {
    products: matchedProducts,
    count: matchedProducts.length,
  };
}
