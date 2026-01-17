/**
 * Delete a product (public API)
 */

import { MutationCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';

export async function deleteProduct(
  ctx: MutationCtx,
  productId: Id<'products'>,
): Promise<Id<'products'>> {
  const product = await ctx.db.get(productId);
  if (!product) {
    throw new Error('Product not found');
  }

  // Delete the product
  await ctx.db.delete(productId);
  return productId;
}
