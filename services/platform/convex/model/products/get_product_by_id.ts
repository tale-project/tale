/**
 * Get a product by ID (internal operation)
 */

import { QueryCtx } from '../../_generated/server';
import { Doc, Id } from '../../_generated/dataModel';

export async function getProductById(
  ctx: QueryCtx,
  productId: Id<'products'>,
): Promise<Doc<'products'> | null> {
  return await ctx.db.get(productId);
}

