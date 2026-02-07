import type { QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import type { ProductItem } from './types';

export async function getProduct(
  ctx: QueryCtx,
  productId: Id<'products'>,
): Promise<ProductItem> {
  const product = await ctx.db.get(productId);
  if (!product) {
    throw new Error('Product not found');
  }

  return {
    id: product._id,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    stock: product.stock,
    price: product.price,
    currency: product.currency,
    category: product.category,
    tags: product.tags,
    status: product.status,
    lastUpdated: product.lastUpdated || product._creationTime,
    createdAt: product._creationTime,
    translations: product.translations,
    metadata: product.metadata,
  };
}
