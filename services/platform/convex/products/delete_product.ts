import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export async function deleteProduct(
  ctx: MutationCtx,
  productId: Id<'products'>,
): Promise<Id<'products'>> {
  const product = await ctx.db.get(productId);
  if (!product) {
    throw new Error('Product not found');
  }

  await ctx.db.delete(productId);
  return productId;
}
