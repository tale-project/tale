/**
 * Get a product by ID (internal operation)
 */

import { Doc, Id } from '../_generated/dataModel';
import { QueryCtx } from '../_generated/server';

export async function getProductById(
  ctx: QueryCtx,
  productId: Id<'products'>,
): Promise<Doc<'products'> | null> {
  return await ctx.db.get(productId);
}
